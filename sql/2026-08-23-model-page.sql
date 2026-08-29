-- Public model page payload. SECURITY DEFINER because watch_facts SELECT is
-- authenticated-only; teasers are truncated to the FIRST SENTENCE server-side —
-- full facts are an in-app perk and must never leave the server on this endpoint.
create or replace function public.model_page(p_slug text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_m public.watch_models%rowtype;
begin
  select * into v_m from watch_models where slug = p_slug and merged_into is null;
  if v_m.id is null then return null; end if;
  return json_build_object(
    'model', json_build_object('id', v_m.id, 'brand', v_m.brand, 'name', v_m.name, 'slug', v_m.slug,
                               'specs', v_m.specs, 'hero_image', v_m.hero_image, 'hero_credit', v_m.hero_credit,
                               'description', v_m.description, 'history', v_m.history,
                               'refs_by_era', v_m.refs_by_era, 'calibers_by_era', v_m.calibers_by_era),
    'teasers', coalesce((select json_agg(f.teaser order by f.position)
        from (select left(coalesce((regexp_match(fact, '^.*?[.!?](?=\s|$)'))[1], fact), 140) as teaser, position
              from watch_facts where model_key = v_m.facts_key
              order by position limit 6) f), '[]'::json),
    'owners', public.model_owners(v_m.id));
end $$;

grant execute on function public.model_page(text) to anon;
notify pgrst, 'reload schema';
