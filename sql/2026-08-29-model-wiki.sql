-- Wikipedia/Commons grounding + hero credit for watch models.
alter table public.watch_models
  add column if not exists wiki_url     text,
  add column if not exists wiki_extract text,
  add column if not exists hero_credit  text;   -- e.g. "Photo: Jane Doe · CC BY-SA 4.0 (Wikimedia Commons)"

-- admin_update_watch_model: also accept hero credit + wiki fields
create or replace function public.admin_update_watch_model(
  p_id uuid, p_name text default null, p_slug text default null,
  p_specs jsonb default null, p_hero text default null, p_curated boolean default null,
  p_hero_credit text default null, p_wiki_url text default null, p_wiki_extract text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'forbidden';
  end if;
  update watch_models set
    name         = coalesce(p_name, name),
    slug         = coalesce(p_slug, slug),
    specs        = coalesce(p_specs, specs),
    hero_image   = coalesce(p_hero, hero_image),
    hero_credit  = case when p_hero is not null then p_hero_credit else coalesce(p_hero_credit, hero_credit) end,
    wiki_url     = coalesce(p_wiki_url, wiki_url),
    wiki_extract = coalesce(p_wiki_extract, wiki_extract),
    is_auto      = coalesce(not p_curated, is_auto)
  where id = p_id;
end $$;

-- grounding for the LLM write-up now carries the Wikipedia lead paragraph
create or replace function public.admin_model_grounding(p_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'forbidden';
  end if;
  return (
    with ow as (select * from watches where model_id = p_id),
    top as (
      select k, v from (
        select f.k, trim(f.v) v, count(*) n, row_number() over (partition by f.k order by count(*) desc) rn
        from ow, lateral (values ('calibers', ow.caliber), ('years', ow.year_range),
                                 ('diameters', ow.case_diameter), ('water_resistance', ow.water_resistance)) f(k, v)
        where f.v is not null and trim(f.v) <> '' group by f.k, trim(f.v)) x where rn <= 6)
    select json_build_object(
      'brand', m.brand, 'name', m.name,
      'aliases', (select coalesce(json_agg(alias_key), '[]'::json) from watch_model_aliases a where a.model_id = m.id and a.alias_key <> m.canonical_key),
      'refs', (select coalesce(json_agg(distinct trim(ref)), '[]'::json) from ow where ref is not null and trim(ref) <> ''),
      'wiki_extract', m.wiki_extract, 'wiki_url', m.wiki_url,
      'grounding', json_build_object(
        'calibers', (select coalesce(json_agg(v), '[]'::json) from top where k = 'calibers'),
        'years', (select coalesce(json_agg(v), '[]'::json) from top where k = 'years'),
        'diameters', (select coalesce(json_agg(v), '[]'::json) from top where k = 'diameters'),
        'water_resistance', (select coalesce(json_agg(v), '[]'::json) from top where k = 'water_resistance')))
    from watch_models m where m.id = p_id);
end $$;
notify pgrst, 'reload schema';
