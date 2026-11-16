-- Brand pages (/b/<slug>/ and the in-app brand screen), idea from Steve 2026-11-15.
--
-- One row per brand that has a page. A row is created here for every brand with
-- at least one content-bearing model page (description + hero image, the same bar
-- as the /w/<slug>/ snapshots: 30 brands on 2026-11-15). The page appears only once
-- the row has a history: scripts/enrich-brands.py asks identify-watch (mode:brand)
-- for description + history + founded + country and stores them.
--
-- `brands` (name list for the brand picker) is left as it is.
CREATE TABLE IF NOT EXISTS public.brand_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL UNIQUE,                 -- = watch_models.brand
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  history text,
  founded text,                               -- a year, e.g. '1905'
  country text,
  enriched_at timestamptz,
  translations jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {lang: {description, history, extras}}, filled by translate-facts
  translate_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_pages ENABLE ROW LEVEL SECURITY;
-- No policies: pages read through brand_page() below. identify-watch (store) and
-- translate-facts (translations) write with the service role.
GRANT SELECT, INSERT, UPDATE ON public.brand_pages TO service_role;

-- New English → its translations are thrown away and made again (same as watch_models).
CREATE OR REPLACE FUNCTION public.brand_pages_reset_translations()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description OR NEW.history IS DISTINCT FROM OLD.history THEN
    NEW.translations := '{}'::jsonb;
    NEW.translate_attempts := 0;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS brand_pages_reset_translations ON public.brand_pages;
CREATE TRIGGER brand_pages_reset_translations
  BEFORE UPDATE OF description, history ON public.brand_pages
  FOR EACH ROW EXECUTE FUNCTION public.brand_pages_reset_translations();

INSERT INTO public.brand_pages (brand, slug)
SELECT brand, trim(both '-' from regexp_replace(lower(brand), '[^a-z0-9]+', '-', 'g'))
FROM public.watch_models
WHERE merged_into IS NULL AND description IS NOT NULL AND hero_image IS NOT NULL
GROUP BY brand
ON CONFLICT (brand) DO NOTHING;

-- Everything a brand page shows, by slug (public page) or by brand name (the app,
-- from a model page's "All N models"). NULL until the brand has a history.
-- Member data follows model_stats: counts and rates exclude internal accounts;
-- wrist shots are public, unmoderated posts only (gated on post visibility).
CREATE OR REPLACE FUNCTION public.brand_page(p_slug text DEFAULT NULL, p_brand text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare
  v_b public.brand_pages%rowtype;
  v_out json;
begin
  if p_slug is not null then
    select * into v_b from brand_pages where slug = lower(p_slug);
  elsif p_brand is not null then
    select * into v_b from brand_pages where brand = p_brand;
  end if;
  if v_b.id is null or v_b.history is null then return null; end if;

  with bw as (   -- members' watches of this brand (any model of it, curated or not)
    select w.id, w.user_id, w.model_id from watches w join watch_models m on m.id = w.model_id
    where m.brand = v_b.brand
      and not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
  ),
  sess as (
    select bw.model_id, bw.user_id, ms.rate from measurement_sessions ms join bw on bw.id = ms.watch_id
    where ms.converged and ms.rate is not null
  ),
  brand_member as (
    select user_id, percentile_cont(0.5) within group (order by rate) r from sess group by user_id
  ),
  brand_acc as (
    select count(*) n_members, (select count(*) from sess) n_sessions,
           percentile_cont(0.5) within group (order by r) med,
           json_agg(round(r::numeric, 1) order by r) members
    from brand_member
  ),
  model_member as (
    select model_id, user_id, percentile_cont(0.5) within group (order by rate) r from sess group by model_id, user_id
  ),
  model_acc as (
    select model_id, count(*) n, percentile_cont(0.5) within group (order by r) med from model_member group by model_id
  ),
  models as (    -- curated families with an owner or a page of their own
    select m.id, m.name, m.slug, m.hero_image, m.hero_credit,
           (m.description is not null and m.hero_image is not null) has_page,
           count(distinct bw.user_id) owners
    from watch_models m left join bw on bw.model_id = m.id
    where m.brand = v_b.brand and m.merged_into is null and not m.is_auto
    group by m.id
    having count(distinct bw.user_id) > 0 or (m.description is not null and m.hero_image is not null)
  ),
  models_out as (
    select mo.id, mo.name, mo.slug, mo.hero_image, mo.has_page, mo.owners,
           case when ma.n >= 3 then round(ma.med::numeric, 1) end med,
           coalesce(ma.n, 0) n_measured
    from models mo left join model_acc ma on ma.model_id = mo.id
  ),
  hero as (
    select hero_image, hero_credit, name from models where hero_image is not null
    order by owners desc, name limit 1
  ),
  shots_all as (   -- first photo of any public, unmoderated post; videos skipped (as model_stats)
    select l.id, l.created_at,
           case when l.photo_url like '[%' then l.photo_url::jsonb->>0 else l.photo_url end url
    from logs l join watches w on w.id = l.watch_id join watch_models m on m.id = w.model_id and m.brand = v_b.brand
    where l.visibility = 'public' and l.moderation_status is null and l.photo_url is not null
  ),
  shots as (
    select id, url, created_at from shots_all
    where url like 'http%' and url !~* '\.(mp4|mov|webm|m3u8)(\?|$)'
  )
  select json_build_object(
    'brand', json_build_object('id', v_b.id, 'brand', v_b.brand, 'slug', v_b.slug,
                               'description', v_b.description, 'history', v_b.history,
                               'founded', v_b.founded, 'country', v_b.country,
                               'translations', v_b.translations),
    'hero', (select json_build_object('image', hero_image, 'credit', hero_credit, 'model', name) from hero),
    'owners', (select count(distinct user_id) from bw),
    'accuracy', (select case when n_members >= 3 then json_build_object(
                   'n_members', n_members, 'n_sessions', n_sessions,
                   'med', round(med::numeric, 1), 'members', members) end from brand_acc),
    'models', (select coalesce(json_agg(row_to_json(models_out) order by (hero_image is null), owners desc, name), '[]'::json) from models_out),
    'shots', (select coalesce(json_agg(json_build_object('id', id, 'url', url) order by created_at desc), '[]'::json)
                from (select * from shots order by created_at desc limit 9) s9),
    'shots_total', (select count(*) from shots)
  ) into v_out;
  return v_out;
end $$;
GRANT EXECUTE ON FUNCTION public.brand_page(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
