-- Watch database: canonical era-spanning model families.
-- Spec: docs/superpowers/specs/2026-08-23-watch-database-design.md

create table if not exists public.watch_models (
  id            uuid primary key default gen_random_uuid(),
  brand         text not null,
  name          text not null,
  slug          text not null unique,
  canonical_key text not null unique,
  brand_key     text not null,
  ref_prefixes  text[] not null default '{}',
  specs         jsonb not null default '{}'::jsonb,
  hero_image    text,
  facts_key     text,
  is_auto       boolean not null default true,
  merged_into   uuid references public.watch_models(id),
  created_at    timestamptz not null default now()
);

create table if not exists public.watch_model_aliases (
  alias_key text primary key,
  model_id  uuid not null references public.watch_models(id)
);

alter table public.watches  add column if not exists model_id uuid references public.watch_models(id);
alter table public.wishlist add column if not exists model_id uuid references public.watch_models(id);
create index if not exists watches_model_id_idx  on public.watches(model_id);
create index if not exists wishlist_model_id_idx on public.wishlist(model_id);

-- World-readable (the model page is anonymous); writes only via definer fns / service role.
alter table public.watch_models        enable row level security;
alter table public.watch_model_aliases enable row level security;
drop policy if exists watch_models_read on public.watch_models;
create policy watch_models_read on public.watch_models for select to anon, authenticated using (true);
drop policy if exists watch_model_aliases_read on public.watch_model_aliases;
create policy watch_model_aliases_read on public.watch_model_aliases for select to anon, authenticated using (true);

-- ── Normalisation: MUST stay byte-identical to normalizeModelKey() in wrotate_test.js ──
create or replace function public.normalize_model_key(p_brand text, p_name text)
returns text language plpgsql immutable as $$
declare
  v_b text := trim(regexp_replace(regexp_replace(lower(coalesce(p_brand,'')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'));
  v_n text := trim(regexp_replace(regexp_replace(lower(coalesce(p_name,'')),  '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'));
  v_f text;
begin
  if v_b = '' or v_n = '' then return ''; end if;
  if v_n = v_b or v_n like v_b || ' %' then
    v_n := trim(substr(v_n, length(v_b) + 1));
  end if;
  v_n := ' ' || v_n || ' ';
  v_n := replace(v_n, ' auto ', ' automatic ');
  foreach v_f in array array['oyster perpetual','cosmograph','co axial','master chronometer','automatic'] loop
    v_n := replace(v_n, ' ' || v_f || ' ', ' ');
  end loop;
  v_n := trim(regexp_replace(v_n, '\s+', ' ', 'g'));
  if v_n = '' then return v_b; end if;
  return v_b || ' ' || v_n;
end $$;

-- ── Resolver: alias hit → ref routing → auto-create. Never returns a tombstone. ──
create or replace function public.resolve_watch_model(p_brand text, p_name text, p_ref text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_key    text := public.normalize_model_key(p_brand, p_name);
  v_bkey   text := trim(regexp_replace(regexp_replace(lower(coalesce(p_brand,'')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'));
  v_ref    text := regexp_replace(lower(coalesce(p_ref,'')), '[^a-z0-9]+', '', 'g');
  v_id     uuid;
  v_merged uuid;
  v_n      int;
begin
  if v_key = '' then return null; end if;

  select model_id into v_id from public.watch_model_aliases where alias_key = v_key;

  -- Ref routing when the name found no home — or only an AUTO model: a typed
  -- reference that uniquely matches a CURATED family beats an auto-created
  -- name bucket ("Seamaster 42" + 210.30.42… is the Diver 300M).
  if v_ref <> '' and (v_id is null or exists (select 1 from public.watch_models a where a.id = v_id and a.is_auto)) then
    declare v_ref_id uuid; begin
      select count(distinct m.id), min(m.id::text)::uuid into v_n, v_ref_id
        from public.watch_models m
       where m.merged_into is null and m.brand_key = v_bkey and not m.is_auto
         and exists (select 1 from unnest(m.ref_prefixes) rp where v_ref like rp || '%');
      if v_n = 1 then v_id := v_ref_id; end if;
    end;
  end if;

  if v_id is null then
    insert into public.watch_models (brand, name, slug, canonical_key, brand_key, facts_key, is_auto)
    values (trim(p_brand), trim(p_name), replace(v_key, ' ', '-'), v_key, v_bkey,
            lower(trim(p_brand)) || '|' || lower(trim(p_name)), true)
    on conflict (canonical_key) do update set canonical_key = excluded.canonical_key
    returning id into v_id;
    insert into public.watch_model_aliases (alias_key, model_id)
    values (v_key, v_id) on conflict (alias_key) do nothing;
  end if;

  -- Chase merges to the surviving row (bounded: merge chains are admin-made and short).
  loop
    select merged_into into v_merged from public.watch_models where id = v_id;
    exit when v_merged is null;
    v_id := v_merged;
  end loop;
  return v_id;
end $$;

-- ── Triggers: every insert/edit resolves, covering web adds, photo-identify, admin edits ──
create or replace function public.set_watch_model_id()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.model_id := public.resolve_watch_model(new.brand, new.name, new.ref);
  return new;
end $$;

drop trigger if exists trg_watches_model_id on public.watches;
create trigger trg_watches_model_id before insert or update of brand, name, ref
  on public.watches for each row execute function public.set_watch_model_id();
drop trigger if exists trg_wishlist_model_id on public.wishlist;
create trigger trg_wishlist_model_id before insert or update of brand, name, ref
  on public.wishlist for each row execute function public.set_watch_model_id();

notify pgrst, 'reload schema';
