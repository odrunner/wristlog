-- Explore/browse the watch database — CURATED families only (auto buckets stay
-- reachable from a member's own watch, never listed). SECURITY DEFINER because owner counts and
-- representative images aggregate over RLS-protected watches; only models with
-- at least one non-internal owner surface, and only publicly-visible photos.

create or replace function public.browse_watch_models(
  p_q text default null, p_brand text default null,
  p_limit int default 30, p_offset int default 0)
returns json language sql stable security definer set search_path to 'public' as $$
  select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
    select m.id, m.brand, m.name, m.slug,
           count(distinct w.user_id) as owners,
           coalesce(m.hero_image, (
             select w2.image from watches w2
             join profiles p2 on p2.id = w2.user_id
             where w2.model_id = m.id and w2.image is not null
               and (w2.watch_privacy = 'public' or w2.watch_privacy is null)
               and coalesce(p2.collection_visibility, 'followers') = 'public'
               and not exists (select 1 from internal_accounts ia where ia.user_id = w2.user_id)
             order by w2.created_at desc limit 1)) as image
    from watch_models m
    join watches w on w.model_id = m.id
      and not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
    where m.merged_into is null and not m.is_auto   -- Explore lists curated families only
      and (p_brand is null or m.brand = p_brand)
      and (p_q is null or trim(p_q) = ''
           or m.canonical_key ilike '%' || lower(trim(p_q)) || '%'
           or exists (select 1 from watch_model_aliases a
                       where a.model_id = m.id and a.alias_key ilike '%' || lower(trim(p_q)) || '%'))
    group by m.id
    order by count(distinct w.user_id) desc, count(w.id) desc, m.brand, m.name
    limit least(greatest(p_limit, 1), 60) offset greatest(p_offset, 0)
  ) t
$$;

create or replace function public.model_brands(p_limit int default 24)
returns json language sql stable security definer set search_path to 'public' as $$
  select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
    select m.brand, count(distinct m.id) as models, count(distinct w.user_id) as owners
    from watch_models m
    join watches w on w.model_id = m.id
      and not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
    where m.merged_into is null and not m.is_auto
    group by m.brand
    order by count(distinct w.user_id) desc, count(distinct m.id) desc
    limit least(greatest(p_limit, 1), 60)
  ) t
$$;

grant execute on function public.browse_watch_models(text, text, int, int) to anon;
grant execute on function public.model_brands(int) to anon;
notify pgrst, 'reload schema';
