-- Grounding payload for the admin Enrich button: what members actually own on
-- this model (aliases, refs, calibers, years, sizes, WR) so the LLM write-up
-- reflects the page's real population.
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
      'grounding', json_build_object(
        'calibers', (select coalesce(json_agg(v), '[]'::json) from top where k = 'calibers'),
        'years', (select coalesce(json_agg(v), '[]'::json) from top where k = 'years'),
        'diameters', (select coalesce(json_agg(v), '[]'::json) from top where k = 'diameters'),
        'water_resistance', (select coalesce(json_agg(v), '[]'::json) from top where k = 'water_resistance')))
    from watch_models m where m.id = p_id);
end $$;
notify pgrst, 'reload schema';
