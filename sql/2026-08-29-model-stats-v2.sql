-- model_stats v2 — everything the reference-page design (2a) renders:
-- cost per wear, wear share (+brand/type/all benchmarks, retention by tenure,
-- percentile), rate histogram, weekly wear pattern, 90-day strip, ownership
-- by era, median tenure, private-collection count. No member floors (owners
-- are never listed, so aggregates carry no identity); every figure shows its
-- sample size instead. Wear share still needs >=2 watches and >=5 wears per
-- owner — that is what makes the metric meaningful, not a privacy floor.
create or replace function public.model_wear_share_rows()
returns table(model_id uuid, user_id uuid, share numeric, fair numeric, idx numeric, wears bigint, tenure_years numeric)
language sql stable security definer set search_path to 'public' as $$
  with wears as (
    select w.model_id, l.user_id, w.purchase_date
    from logs l join watches w on w.id = l.watch_id
    where l.use_case is distinct from 'measurement' and w.model_id is not null
      and not exists (select 1 from internal_accounts ia where ia.user_id = l.user_id)
  ),
  per_user as (select user_id, count(*) total from wears group by user_id having count(*) >= 5),
  coll as (select user_id, count(*) n from watches group by user_id having count(*) >= 2)
  select wr.model_id, wr.user_id,
         round(count(*)::numeric / pu.total, 4) as share,
         round(1.0 / c.n, 4) as fair,
         round((count(*)::numeric / pu.total) * c.n, 2) as idx,
         count(*) as wears,
         (select round(extract(epoch from (now() - (min(w2.purchase_date)::date)))::numeric / 31557600, 1)
            from watches w2 where w2.user_id = wr.user_id and w2.model_id = wr.model_id
              and w2.purchase_date ~ '^\d{4}-\d{2}-\d{2}') as tenure_years
  from wears wr join per_user pu on pu.user_id = wr.user_id join coll c on c.user_id = wr.user_id
  group by wr.model_id, wr.user_id, pu.total, c.n
$$;

create or replace function public.model_stats(p_model_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_viewer uuid := auth.uid();
  v_brand  text;
  v_type   text;
  v_out    json;
begin
  select brand, specs->>'type' into v_brand, v_type from watch_models where id = p_model_id;
  if v_brand is null then return null; end if;

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
    select ms.user_id, ms.rate, ms.amplitude from measurement_sessions ms join ow on ow.id = ms.watch_id
    where ms.converged and ms.rate is not null
  ),
  acc as (
    select count(*) n_sessions, count(distinct user_id) n_measurers,
           percentile_cont(0.5) within group (order by rate) med_rate,
           percentile_cont(0.5) within group (order by abs(rate)) med_abs_rate,
           percentile_cont(0.5) within group (order by amplitude) filter (where amplitude > 0) med_amp
    from sess
  ),
  hist as (   -- 13 bins of 3 s/d from -25 to +14 (design axis −25 … +10)
    select b, count(s.rate) n from generate_series(1, 13) b
    left join sess s on width_bucket(s.rate, -25, 14, 13) = b
    group by b order by b
  ),
  pts as (
    select ow.user_id, to_char((e->>'date')::date, 'YYYY-MM') ym, (e->>'price')::numeric price
    from ow, jsonb_array_elements(case when jsonb_typeof(ow.price_history) = 'array' then ow.price_history else '[]'::jsonb end) e
    where (e->>'price') ~ '^[0-9]+(\.[0-9]+)?$' and (e->>'date') ~ '^\d{4}-\d{2}-\d{2}'
    union all
    select ow.user_id, to_char(ow.market_price_date::date, 'YYYY-MM'), ow.market_price
    from ow where ow.market_price is not null and ow.market_price_date ~ '^\d{4}-\d{2}-\d{2}'
  ),
  val_months as (
    select ym, percentile_cont(0.5) within group (order by price) med, count(*) n
    from pts group by ym order by ym
  ),
  val_now as (
    select percentile_cont(0.5) within group (order by market_price) med, count(distinct user_id) n
    from ow where market_price is not null
  ),
  ws_all as (select * from model_wear_share_rows()),
  ws_model as (
    select percentile_cont(0.5) within group (order by idx) idx,
           percentile_cont(0.5) within group (order by share) share,
           percentile_cont(0.5) within group (order by fair) fair,
           count(*) n, sum(wears) wears
    from ws_all where model_id = p_model_id
  ),
  ws_models as (
    select m.id, m.brand, m.specs->>'type' typ, percentile_cont(0.5) within group (order by r.idx) idx
    from ws_all r join watch_models m on m.id = r.model_id group by m.id
  ),
  ws_bench as (
    select (select percentile_cont(0.5) within group (order by idx) from ws_models where brand = v_brand) brand_idx,
           (select percentile_cont(0.5) within group (order by idx) from ws_models where v_type is not null and typ = v_type) type_idx,
           (select percentile_cont(0.5) within group (order by idx) from ws_models) all_idx,
           (select count(*) from ws_models) n_models
  ),
  ws_ret as (   -- retention: share by years since purchase (>=3 owners per bucket)
    select case when tenure_years < 1 then 'yr 1' when tenure_years < 2 then 'yr 2' when tenure_years < 3 then 'yr 3' else '5+' end bucket,
           min(case when tenure_years < 1 then 1 when tenure_years < 2 then 2 when tenure_years < 3 then 3 else 5 end) ord,
           percentile_cont(0.5) within group (order by idx) idx, count(*) n
    from ws_all where model_id = p_model_id and tenure_years is not null
    group by 1
  ),
  cpw as (   -- cost per wear: purchase price / cumulative wears, per owner
    select ow.user_id, ow.price / nullif(count(l.id), 0) as cpw, count(l.id) wears
    from ow join logs l on l.watch_id = ow.id and l.use_case is distinct from 'measurement'
    where ow.price >= 100 group by ow.user_id, ow.id, ow.price   -- placeholder prices ($1, $5…) make nonsense cost-per-wear
  ),
  cpw_agg as (select percentile_cont(0.5) within group (order by cpw) med, count(distinct user_id) n, sum(wears) wears from cpw where cpw is not null),
  wl as (   -- wear logs on this model, last 90 days / 12 weeks
    select l.date::date d, l.user_id from logs l join ow on ow.id = l.watch_id
    where l.use_case is distinct from 'measurement' and l.date ~ '^\d{4}-\d{2}-\d{2}'
      and l.date::date >= current_date - 90
  ),
  wears as (
    select count(*) w90, count(distinct user_id) wearers90,
           (select count(*) from logs l join ow on ow.id = l.watch_id where l.use_case is distinct from 'measurement') all_time
    from wl
  ),
  strip as (   -- 15 buckets × 6 days, oldest first
    select b, count(wl.d) n from generate_series(0, 14) b
    left join wl on ((wl.d - (current_date - 89)) / 6) = b group by b order by b
  ),
  weeks as (   -- 12 weekly buckets, oldest first
    select b, count(wl.d) n from generate_series(0, 11) b
    left join wl on ((wl.d - (current_date - 83)) / 7) = b group by b order by b
  ),
  years as (
    select coalesce(substring(year_range from '\d{4}'), left(purchase_date, 4)) y from ow
  ),
  era as (
    select b, count(y.y) n from generate_series(1, 6) b
    left join years y on y.y ~ '^\d{4}$' and least(6, greatest(1, ((y.y::int - 1960) / 10) + 1)) = b
    group by b order by b
  ),
  tenure as (
    select percentile_cont(0.5) within group (order by extract(epoch from (now() - purchase_date::date)) / 31557600) yrs, count(*) n
    from ow where purchase_date ~ '^\d{4}-\d{2}-\d{2}'
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
  photos as (
    select url from (
      select pub.image url, pub.created_at ts from pub where pub.image is not null
      union all
      select l.photo_url, l.created_at from logs l join pub on pub.id = l.watch_id
      where l.visibility = 'public' and l.photo_url like 'http%'
    ) x order by ts desc limit 8
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
    select w.id, w.brand, w.name, w.ref,
           (select ms.rate from measurement_sessions ms where ms.watch_id = w.id and ms.converged and ms.rate is not null
              order by ms.created_at desc limit 1) last_rate
    from watches w where w.user_id = v_viewer and w.model_id = p_model_id
  )
  select json_build_object(
    'owners', (select count(distinct user_id) from ow),
    'public_owners', (select count(distinct user_id) from pub),
    'wishlisted', (select count(distinct user_id) from wishlist wl2
                    where wl2.model_id = p_model_id
                      and not exists (select 1 from internal_accounts ia where ia.user_id = wl2.user_id)),
    'wishlisted_by_me', (v_viewer is not null and exists (select 1 from wishlist wl3 where wl3.model_id = p_model_id and wl3.user_id = v_viewer)),
    'top_ref', (select ref from top_ref),
    'wears', (select json_build_object('w90', w90, 'wearers90', wearers90, 'all_time', all_time) from wears),
    'wear_strip', (select json_agg(n order by b) from strip),
    'wear_weeks', (select json_agg(n order by b) from weeks),
    'accuracy', (select case when n_measurers >= 1 then json_build_object(
                   'n_sessions', n_sessions, 'n_measurers', n_measurers,
                   'med_rate', round(med_rate::numeric, 1), 'med_abs_rate', round(med_abs_rate::numeric, 1),
                   'med_amp', round(med_amp::numeric),
                   'hist', (select json_agg(n order by b) from hist), 'hist_min', -25, 'hist_max', 14) end from acc),
    'value', (select case when n >= 1 then json_build_object(
                   'median_now', round(med::numeric), 'n_contributors', n,
                   'series', case when (select count(*) from val_months) >= 2
                               then (select json_agg(json_build_object('ym', ym, 'median', round(med::numeric), 'n', n) order by ym) from val_months)
                               else null end) end from val_now),
    'cost_per_wear', (select case when n >= 1 then json_build_object('median', round(med::numeric, 2), 'n_owners', n, 'wears', wears) end from cpw_agg),
    'wear_share', (select case when n >= 1 then json_build_object(
                   'index', round(idx::numeric, 2), 'share', round(share::numeric * 100), 'fair', round(fair::numeric * 100),
                   'n_owners', n, 'wears', wears,
                   'pct_rank', (select round(100.0 * count(*) filter (where m2.idx < ws_model.idx) / nullif(count(*), 0)) from ws_models m2),
                   'n_models', (select n_models from ws_bench),
                   'bench', (select json_build_object(
                       'brand', case when brand_idx is not null then round(brand_idx * ws_model.fair * 100) end,
                       'type', case when type_idx is not null then round(type_idx * ws_model.fair * 100) end,
                       'type_label', v_type,
                       'all', case when all_idx is not null then round(all_idx * ws_model.fair * 100) end) from ws_bench),
                   'retention', (select case when count(*) >= 2 then json_agg(json_build_object('bucket', bucket, 'share', round(idx * ws_model.fair * 100), 'n', n) order by ord) end from ws_ret)
                 ) end from ws_model),
    'era', (select json_agg(n order by b) from era),
    'tenure', (select case when n >= 1 then json_build_object('years', round(yrs::numeric, 1), 'n', n) end from tenure),
    'specs_gen', (select year_range from latest_gen),
    'specs_agg', (select coalesce(json_object_agg(k, json_build_object('v', v, 'n', n)), '{}'::json)
                    from spec_field where rn = 1),
    'photos', (select coalesce(json_agg(url), '[]'::json) from photos),
    'related', (select coalesce(json_agg(row_to_json(related)), '[]'::json) from related),
    'brand_models', (select n from brand_count),
    'mine', (select coalesce(json_agg(row_to_json(mine)), '[]'::json) from mine)
  ) into v_out;
  return v_out;
end $$;

grant execute on function public.model_stats(uuid) to anon;
notify pgrst, 'reload schema';
