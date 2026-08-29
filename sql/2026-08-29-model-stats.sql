-- Model page v2: enrichment columns + model_stats RPC (community numbers).
-- Spec: docs/superpowers/specs/2026-08-23-watch-database-design.md (page v2, 2026-08-29)
-- Every aggregate carries its sample size and sits behind a >=3-member floor.

alter table public.watch_models
  add column if not exists description     text,
  add column if not exists history         text,
  add column if not exists refs_by_era     jsonb,
  add column if not exists calibers_by_era jsonb,
  add column if not exists enriched_at     timestamptz;

create or replace function public.admin_set_model_enrichment(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'forbidden';
  end if;
  update watch_models set
    description     = coalesce(nullif(p->>'description', ''), description),
    history         = coalesce(nullif(p->>'history', ''), history),
    refs_by_era     = coalesce(p->'refs_by_era', refs_by_era),
    calibers_by_era = coalesce(p->'calibers_by_era', calibers_by_era),
    specs           = case when jsonb_typeof(p->'specs') = 'object' then specs || (p->'specs') else specs end,
    enriched_at     = now()
  where id = p_id;
end $$;

-- ── Wear index per (model, owner): share of the owner's wears that go to this
-- model × the owner's collection size. 1.0 = worn exactly its fair share.
-- Owners qualify with >=2 watches and >=5 wears. Reused by model_stats twice
-- (this model + the percentile across all models).
create or replace function public.model_wear_index_rows()
returns table(model_id uuid, user_id uuid, idx numeric)
language sql stable security definer set search_path to 'public' as $$
  with wears as (
    select w.model_id, l.user_id
    from logs l join watches w on w.id = l.watch_id
    where l.use_case is distinct from 'measurement' and w.model_id is not null
      and not exists (select 1 from internal_accounts ia where ia.user_id = l.user_id)
  ),
  per_user as (select user_id, count(*) total from wears group by user_id having count(*) >= 5),
  coll as (select user_id, count(*) n from watches group by user_id having count(*) >= 2)
  select wr.model_id, wr.user_id,
         round((count(*)::numeric / pu.total) * c.n, 2) as idx
  from wears wr join per_user pu on pu.user_id = wr.user_id join coll c on c.user_id = wr.user_id
  group by wr.model_id, wr.user_id, pu.total, c.n
$$;

create or replace function public.model_stats(p_model_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_viewer uuid := auth.uid();
  v_brand  text;
  v_out    json;
begin
  select brand into v_brand from watch_models where id = p_model_id;
  if v_brand is null then return null; end if;

  with ow as (  -- member watches on this model (internal accounts excluded, viewer's own included)
    select w.* from watches w
    where w.model_id = p_model_id
      and (w.user_id = v_viewer or not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id))
  ),
  pub as (      -- publicly visible member watches (for photos)
    select ow.* from ow join profiles p on p.id = ow.user_id
    where (ow.watch_privacy = 'public' or ow.watch_privacy is null)
      and coalesce(p.collection_visibility, 'followers') = 'public'
      and ow.user_id is distinct from v_viewer
  ),
  acc as (
    select count(*) n_sessions, count(distinct ms.user_id) n_measurers,
           percentile_cont(0.5) within group (order by ms.rate) med_rate,
           percentile_cont(0.5) within group (order by abs(ms.rate)) med_abs_rate,
           percentile_cont(0.5) within group (order by ms.amplitude) filter (where ms.amplitude > 0) med_amp
    from measurement_sessions ms join ow on ow.id = ms.watch_id
    where ms.converged and ms.rate is not null
  ),
  pts as (      -- every valuation point: history entries + current value
    select ow.user_id, to_char((e->>'date')::date, 'YYYY-MM') ym, (e->>'price')::numeric price
    from ow, jsonb_array_elements(case when jsonb_typeof(ow.price_history) = 'array' then ow.price_history else '[]'::jsonb end) e
    where (e->>'price') ~ '^[0-9]+(\.[0-9]+)?$' and (e->>'date') ~ '^\d{4}-\d{2}-\d{2}'
    union all
    select ow.user_id, to_char(ow.market_price_date::date, 'YYYY-MM'), ow.market_price
    from ow where ow.market_price is not null and ow.market_price_date ~ '^\d{4}-\d{2}-\d{2}'
  ),
  val_months as (
    select ym, percentile_cont(0.5) within group (order by price) med, count(*) n, count(distinct user_id) contributors
    from pts group by ym having count(*) >= 3 order by ym
  ),
  val_now as (
    select percentile_cont(0.5) within group (order by market_price) med, count(distinct user_id) n
    from ow where market_price is not null
  ),
  wi_all as (select * from model_wear_index_rows()),
  wi_model as (
    select percentile_cont(0.5) within group (order by idx) idx, count(*) n from wi_all where model_id = p_model_id
  ),
  wi_models as (   -- one index per model with >=3 qualifying owners, for the percentile rank
    select model_id, percentile_cont(0.5) within group (order by idx) idx
    from wi_all group by model_id having count(*) >= 3
  ),
  wears as (
    select count(*) filter (where l.date >= to_char(now() - interval '90 days', 'YYYY-MM-DD')) w90,
           count(distinct l.user_id) filter (where l.date >= to_char(now() - interval '90 days', 'YYYY-MM-DD')) wearers90,
           count(*) all_time
    from logs l join ow on ow.id = l.watch_id where l.use_case is distinct from 'measurement'
  ),
  spec_field as (
    select f.k, lower(trim(f.v)) v, count(*) n,
           row_number() over (partition by f.k order by count(*) desc, lower(trim(f.v))) rn
    from ow, lateral (values
      ('caliber', ow.caliber), ('case_diameter', ow.case_diameter), ('water_resistance', ow.water_resistance),
      ('movement_type', ow.movement_type), ('case_material', ow.case_material), ('year_range', ow.year_range)) f(k, v)
    where f.v is not null and trim(f.v) <> ''
    group by f.k, lower(trim(f.v))
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
  mine as (
    select w.id, w.brand, w.name, w.ref,
           (select ms.rate from measurement_sessions ms where ms.watch_id = w.id and ms.converged and ms.rate is not null
              order by ms.created_at desc limit 1) last_rate
    from watches w where w.user_id = v_viewer and w.model_id = p_model_id
  )
  select json_build_object(
    'owners', (select count(distinct user_id) from ow),
    'wishlisted', (select count(distinct user_id) from wishlist wl
                    where wl.model_id = p_model_id
                      and not exists (select 1 from internal_accounts ia where ia.user_id = wl.user_id)),
    'wears', (select json_build_object('w90', w90, 'wearers90', wearers90, 'all_time', all_time) from wears),
    'accuracy', (select case when n_measurers >= 3 then json_build_object(
                   'n_sessions', n_sessions, 'n_measurers', n_measurers,
                   'med_rate', round(med_rate::numeric, 1), 'med_abs_rate', round(med_abs_rate::numeric, 1),
                   'med_amp', round(med_amp::numeric)) end from acc),
    'value', (select case when n >= 3 then json_build_object(
                   'median_now', round(med::numeric), 'n_contributors', n,
                   'series', case when (select count(*) from val_months) >= 3 and (select count(distinct user_id) from pts) >= 3
                               then (select json_agg(json_build_object('ym', ym, 'median', round(med::numeric), 'n', n) order by ym) from val_months)
                               else null end) end from val_now),
    'wear_index', (select case when n >= 3 then json_build_object(
                   'index', round(idx::numeric, 2), 'n_owners', n,
                   'pct_rank', (select round(100.0 * count(*) filter (where m2.idx < wi_model.idx) / nullif(count(*), 0))
                                  from wi_models m2)) end from wi_model),
    'specs_agg', (select coalesce(json_object_agg(k, json_build_object('v', v, 'n', n)), '{}'::json)
                    from spec_field where rn = 1 and n >= 2),
    'photos', (select coalesce(json_agg(url), '[]'::json) from photos),
    'related', (select coalesce(json_agg(row_to_json(related)), '[]'::json) from related),
    'mine', (select coalesce(json_agg(row_to_json(mine)), '[]'::json) from mine)
  ) into v_out;
  return v_out;
end $$;

grant execute on function public.model_stats(uuid) to anon;
notify pgrst, 'reload schema';
