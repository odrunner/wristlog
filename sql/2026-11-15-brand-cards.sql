-- The Watches page's brand card (2026-11-15): one small row per brand that has a
-- page, read once per session. The card shows above the model grid when that
-- brand's chip is selected or the search matches its name, and opens the brand
-- page. Counts follow brand_page(): internal accounts excluded; models = curated
-- families with an owner or a page of their own.
CREATE OR REPLACE FUNCTION public.brand_cards()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  with bw as (
    select m.brand, m.id model_id, w.user_id
    from watches w join watch_models m on m.id = w.model_id
    where not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
  ),
  models as (
    select m.brand, m.id, m.name, m.hero_image, count(distinct bw.user_id) owners
    from watch_models m left join bw on bw.model_id = m.id
    where m.merged_into is null and not m.is_auto
    group by m.id
    having count(distinct bw.user_id) > 0 or (m.description is not null and m.hero_image is not null)
  )
  select coalesce(json_agg(json_build_object(
    'brand', b.brand, 'slug', b.slug, 'founded', b.founded,
    'models', (select count(*) from models mo where mo.brand = b.brand),
    'owners', (select count(distinct user_id) from bw where bw.brand = b.brand),
    'image', (select mo.hero_image from models mo where mo.brand = b.brand and mo.hero_image is not null
              order by mo.owners desc, mo.name limit 1)
  ) order by b.brand), '[]'::json)
  from brand_pages b where b.history is not null
$$;
GRANT EXECUTE ON FUNCTION public.brand_cards() TO authenticated;
NOTIFY pgrst, 'reload schema';
