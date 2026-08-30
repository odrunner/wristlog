-- Admin watch-model management: list, merge, rename/curate.
-- Gate pattern matches sql/2026-06-27-featured-post.sql.

create or replace function public.admin_watch_models()
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'forbidden';
  end if;
  return coalesce((select json_agg(row_to_json(t)) from (
    select m.id, m.brand, m.name, m.slug, m.is_auto, m.specs, m.hero_image, m.hero_credit, m.wiki_url, m.ref_prefixes, m.enriched_at,
           (select count(*) from watch_model_aliases a where a.model_id = m.id) aliases,
           count(distinct w.user_id) owners, count(w.id) watches
    from watch_models m
    left join watches w on w.model_id = m.id
      and not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
    where m.merged_into is null
    group by m.id order by owners desc, watches desc, m.brand, m.name) t), '[]'::json);
end $$;

create or replace function public.admin_merge_watch_models(p_src uuid, p_dst uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'forbidden';
  end if;
  if p_src = p_dst then raise exception 'src = dst'; end if;
  if exists (select 1 from watch_models where id = p_dst and merged_into is not null) then
    raise exception 'destination is a tombstone';
  end if;
  update watch_model_aliases set model_id = p_dst where model_id = p_src;
  update watches  set model_id = p_dst where model_id = p_src;
  update wishlist set model_id = p_dst where model_id = p_src;
  update watch_models set ref_prefixes = (
      select coalesce(array_agg(distinct rp), '{}') from (
        select unnest(ref_prefixes) rp from watch_models where id in (p_src, p_dst)) u)
    where id = p_dst;
  update watch_models d set facts_key = s.facts_key
    from watch_models s where d.id = p_dst and s.id = p_src and d.facts_key is null;
  -- Fold the source's fun-fact pool into the destination's (appended positions,
  -- duplicates by text skipped) so a merged family keeps all its facts.
  perform public.merge_fact_pools(p_src, p_dst);
  update watch_models set merged_into = p_dst where id = p_src;
end $$;

create or replace function public.merge_fact_pools(p_src uuid, p_dst uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_dst_key text; v_src_key text; v_next int; v_moved int := 0; r record;
begin
  select facts_key into v_dst_key from watch_models where id = p_dst;
  select facts_key into v_src_key from watch_models where id = p_src;
  if v_dst_key is null or v_src_key is null or v_dst_key = v_src_key then return 0; end if;
  select coalesce(max(position), -1) + 1 into v_next from watch_facts where model_key = v_dst_key;
  for r in select id, fact from watch_facts where model_key = v_src_key order by position loop
    if exists (select 1 from watch_facts d where d.model_key = v_dst_key and d.fact = r.fact) then
      continue;  -- same text already in the destination pool
    end if;
    update watch_facts set model_key = v_dst_key, position = v_next where id = r.id;
    v_next := v_next + 1; v_moved := v_moved + 1;
  end loop;
  return v_moved;
end $$;

create or replace function public.admin_update_watch_model(
  p_id uuid, p_name text default null, p_slug text default null,
  p_specs jsonb default null, p_hero text default null, p_curated boolean default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'forbidden';
  end if;
  update watch_models set
    name       = coalesce(p_name, name),
    slug       = coalesce(p_slug, slug),
    specs      = coalesce(p_specs, specs),
    hero_image = coalesce(p_hero, hero_image),
    is_auto    = coalesce(not p_curated, is_auto)
  where id = p_id;
end $$;

notify pgrst, 'reload schema';
