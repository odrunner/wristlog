-- Calibre inference for the model page (2026-09-26, owner's choice: infer on the
-- page only — members' own watch records are never written).
--
-- 215 active members' watches have no calibre, so the "compare the movement"
-- fallback could not place them. When a watch has no recorded calibre, take it
-- from its model's calibres_by_era (the enrichment write-up): the era whose
-- years cover the watch's production year (year_range), or the model's only
-- calibre when it has just one. Purchase dates are NOT used — a vintage watch
-- bought last year would land on the modern calibre.

-- The calibre key a model's era table gives for a production year; NULL when
-- the year matches no era (or several models' eras disagree and no year is given).
CREATE OR REPLACE FUNCTION public.model_era_caliber(p_model_id uuid, p_year int)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with e as (
    select caliber_key(x->>'caliber') k,
           (regexp_match(coalesce(x->>'years', ''), '(\d{4})'))[1]::int y0,
           coalesce((regexp_match(coalesce(x->>'years', ''), '\d{4}\D+(\d{4})'))[1]::int,
                    case when x->>'years' ~* 'present' then 9999 end,
                    case when x->>'years' ~ '\d{4}s' then (regexp_match(x->>'years', '(\d{4})'))[1]::int + 9 end,
                    (regexp_match(coalesce(x->>'years', ''), '(\d{4})'))[1]::int) y1
    from watch_models m,
         jsonb_array_elements(case when jsonb_typeof(m.calibers_by_era) = 'array' then m.calibers_by_era else '[]'::jsonb end) x
    where m.id = p_model_id
  ), k as (select * from e where k is not null)
  select k from k
  where (select count(distinct k) from k) = 1
     or (p_year is not null and p_year between y0 and y1)
  order by y0 desc nulls last limit 1
$function$;

-- A watch's calibre key: what the member recorded, else the model's era calibre.
CREATE OR REPLACE FUNCTION public.watch_caliber_key(p_caliber text, p_model_id uuid, p_year_range text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(caliber_key(p_caliber),
                  case when p_model_id is not null
                       then model_era_caliber(p_model_id, (substring(coalesce(p_year_range, '') from '\d{4}'))::int) end)
$function$;

CREATE OR REPLACE FUNCTION public.model_stats(p_model_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_viewer uuid := auth.uid();
  v_brand  text;
  v_cal    text;
  v_out    json;
begin
  select brand into v_brand from watch_models where id = p_model_id;
  if v_brand is null then return null; end if;

  -- calibre to fall back on: the viewer's own watch first (recorded, else inferred
  -- from the model's calibres by era), else the model's most common recorded one,
  -- else the model's only calibre.
  select watch_caliber_key(w.caliber, w.model_id, w.year_range) into v_cal from watches w
  where v_viewer is not null and w.user_id = v_viewer and w.model_id = p_model_id
    and watch_caliber_key(w.caliber, w.model_id, w.year_range) is not null
  order by (caliber_key(w.caliber) is null), w.created_at limit 1;
  if v_cal is null then
    select caliber_key(w.caliber) into v_cal from watches w
    where w.model_id = p_model_id and caliber_key(w.caliber) is not null
      and not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
    group by 1 order by count(*) desc, 1 limit 1;
  end if;
  if v_cal is null then v_cal := model_era_caliber(p_model_id, null); end if;
  -- The calibre comparison only shows when the model itself has < 3 measuring
  -- members; skip its (inference-heavy) work otherwise.
  if (select count(distinct ms.user_id) from measurement_sessions ms join watches w on w.id = ms.watch_id
      where w.model_id = p_model_id and ms.converged and ms.rate is not null
        and (w.user_id = v_viewer or not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id))) >= 3 then
    v_cal := null;
  end if;

  with ow as (
    select w.* from watches w
    where w.model_id = p_model_id
      and (w.user_id = v_viewer or not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id))
  ),
  pub as (
    select ow.* from ow join profiles p on p.id = ow.user_id
    where (ow.watch_privacy = 'public' or ow.watch_privacy is null)
      and coalesce(p.collection_visibility, 'followers') = 'public'
      and ow.user_id is distinct from v_viewer
  ),
  sess as (
    select ms.user_id, ms.rate from measurement_sessions ms join ow on ow.id = ms.watch_id
    where ms.converged and ms.rate is not null
  ),
  per_member as (
    select user_id, percentile_cont(0.5) within group (order by rate) r from sess group by user_id
  ),
  acc as (
    select count(*) n_members, (select count(*) from sess) n_sessions,
           percentile_cont(0.5) within group (order by r) med,
           json_agg(round(r::numeric, 1) order by r) members
    from per_member
  ),
  measured as (   -- measured watches, with the recorded calibre key and production year
    select w.id, w.user_id, w.model_id, caliber_key(w.caliber) rk,
           (substring(coalesce(w.year_range, '') from '\d{4}'))::int yr
    from watches w
    where v_cal is not null
      and exists (select 1 from measurement_sessions ms where ms.watch_id = w.id and ms.converged and ms.rate is not null)
      and (w.user_id = v_viewer or not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id))
  ),
  inferred as (   -- era calibre once per (model, year), only for models whose era table mentions v_cal at all
    select d.model_id, d.yr, model_era_caliber(d.model_id, d.yr) k
    from (select distinct model_id, yr from measured where rk is null and model_id is not null) d
    join watch_models m on m.id = d.model_id
    where lower(m.calibers_by_era::text) like '%' || v_cal || '%'
  ),
  cal_watches as (   -- measured watches whose calibre (recorded, else inferred) is v_cal
    select me.id, me.user_id, me.model_id from measured me
    left join inferred i on i.model_id = me.model_id and i.yr is not distinct from me.yr
    where coalesce(me.rk, i.k) = v_cal
  ),
  cal_sess as (
    select cw.user_id, cw.model_id, ms.rate from measurement_sessions ms join cal_watches cw on cw.id = ms.watch_id
    where ms.converged and ms.rate is not null
  ),
  cal_member as (
    select user_id, percentile_cont(0.5) within group (order by rate) r from cal_sess group by user_id
  ),
  cal as (
    select count(*) n_members, (select count(distinct model_id) from cal_sess) n_models,
           percentile_cont(0.5) within group (order by r) med,
           json_agg(round(r::numeric, 1) order by r) members
    from cal_member
  ),
  latest_gen as (   -- the most recent production range members recorded, e.g. '2020-present'
    select year_range from ow
    where year_range ~ '\d{4}'
    order by (substring(year_range from '\d{4}'))::int desc, year_range limit 1
  ),
  gen_watches as (
    select ow.* from ow where exists (select 1 from latest_gen g where lower(trim(ow.year_range)) = lower(trim(g.year_range)))
  ),
  spec_src as (select * from gen_watches union all select * from ow where not exists (select 1 from gen_watches)),
  spec_field as (
    select f.k, lower(trim(f.v)) v, count(*) n,
           row_number() over (partition by f.k order by count(*) desc, lower(trim(f.v))) rn
    from spec_src ow, lateral (values
      ('caliber', ow.caliber), ('case_diameter', ow.case_diameter), ('water_resistance', ow.water_resistance),
      ('movement_type', ow.movement_type), ('case_material', ow.case_material), ('year_range', ow.year_range)) f(k, v)
    where f.v is not null and trim(f.v) <> ''
    group by f.k, lower(trim(f.v))
  ),
  top_ref as (
    select trim(ref) ref, count(*) n from ow where ref is not null and trim(ref) <> '' group by trim(ref) order by n desc, ref limit 1
  ),
  shots_all as (   -- public wrist shots: first photo of a public, unmoderated post; videos skipped
    select l.id, l.created_at,
           case when l.photo_url like '[%' then l.photo_url::jsonb->>0 else l.photo_url end url
    from logs l join pub on pub.id = l.watch_id
    where l.visibility = 'public' and l.moderation_status is null and l.photo_url is not null
  ),
  shots as (
    select id, url, created_at from shots_all
    where url like 'http%' and url !~* '\.(mp4|mov|webm|m3u8)(\?|$)'
  ),
  photos as (   -- hero fallback when the model has no curated image
    select url from (
      select pub.image url, pub.created_at ts from pub where pub.image like 'http%'
      union all
      select url, created_at from shots
    ) x order by ts desc limit 4
  ),
  related as (
    select m.id, m.brand, m.name, m.slug, count(distinct w.user_id) owners
    from watch_models m join watches w on w.model_id = m.id
    where m.brand = v_brand and m.id <> p_model_id and m.merged_into is null
      and not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
    group by m.id order by owners desc limit 6
  ),
  brand_count as (
    select count(distinct m.id) n from watch_models m join watches w on w.model_id = m.id
    where m.brand = v_brand and m.merged_into is null
      and not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
  ),
  mine as (
    select w.id, w.brand, w.name, w.ref, w.caliber, s.rate last_rate, round(s.amplitude::numeric) last_amp, s.created_at last_at
    from watches w
    left join lateral (
      select ms.rate, ms.amplitude, ms.created_at from measurement_sessions ms
      where ms.watch_id = w.id and ms.converged and ms.rate is not null
      order by ms.created_at desc limit 1
    ) s on true
    where w.user_id = v_viewer and w.model_id = p_model_id
    order by s.created_at desc nulls last, w.created_at
  )
  select json_build_object(
    'owners', (select count(distinct user_id) from ow),
    'wishlisted', (select count(distinct user_id) from wishlist wl2
                    where wl2.model_id = p_model_id
                      and not exists (select 1 from internal_accounts ia where ia.user_id = wl2.user_id)),
    'wishlisted_by_me', (v_viewer is not null and exists (select 1 from wishlist wl3 where wl3.model_id = p_model_id and wl3.user_id = v_viewer)),
    'top_ref', (select ref from top_ref),
    'accuracy', (select case when n_members >= 3 then json_build_object(
                   'n_members', n_members, 'n_sessions', n_sessions,
                   'med', round(med::numeric, 1), 'members', members) end from acc),
    'caliber', (select case when n_members >= 3 and (select n_members from acc) < 3 then json_build_object(
                   'key', v_cal, 'n_members', n_members, 'n_models', n_models,
                   'med', round(med::numeric, 1), 'members', members) end from cal),
    'specs_gen', (select year_range from latest_gen),
    'specs_agg', (select coalesce(json_object_agg(k, json_build_object('v', v, 'n', n)), '{}'::json)
                    from spec_field where rn = 1),
    'photos', (select coalesce(json_agg(url), '[]'::json) from photos),
    'shots', (select coalesce(json_agg(json_build_object('id', id, 'url', url) order by created_at desc), '[]'::json)
                from (select * from shots order by created_at desc limit 9) s9),
    'shots_total', (select count(*) from shots),
    'related', (select coalesce(json_agg(row_to_json(related)), '[]'::json) from related),
    'brand_models', (select n from brand_count),
    'mine', (select coalesce(json_agg(row_to_json(mine)), '[]'::json) from mine)
  ) into v_out;
  return v_out;
end $function$;

NOTIFY pgrst, 'reload schema';
