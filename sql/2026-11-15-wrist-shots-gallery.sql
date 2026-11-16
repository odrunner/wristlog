-- Wrist-shot gallery + brand-filtered feed (2026-11-15).
--
-- 1. wrist_shots_page(): the photos behind a model or brand page's "N photos",
--    newest first, paged for the app's image-only grid. Same rows as the nine
--    on the page (model_stats / brand_page): first photo of each post the viewer
--    may see (shot_visible), videos skipped.
-- 2. brand_feed_page(): the Feed filtered to one brand, the brand page's
--    counterpart of model_feed_page().
-- 3. model_feed_page(): now follows the viewer like the page it is opened from
--    (it was public posts only, so the feed showed fewer posts than the page).
CREATE OR REPLACE FUNCTION public.wrist_shots_page(p_model_id uuid DEFAULT NULL, p_brand text DEFAULT NULL,
                                                   p_offset integer DEFAULT 0, p_limit integer DEFAULT 60)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select coalesce(json_agg(json_build_object('id', id, 'url', url) order by created_at desc, id), '[]'::json)
  from (
    select id, url, created_at from (
      select l.id, l.created_at,
             case when l.photo_url like '[%' then l.photo_url::jsonb->>0 else l.photo_url end url
      from logs l join watches w on w.id = l.watch_id join watch_models m on m.id = w.model_id
      where ((p_model_id is not null and w.model_id = p_model_id)
          or (p_model_id is null and p_brand is not null and m.brand = p_brand))
        and l.moderation_status is null and l.photo_url is not null
        and shot_visible(auth.uid(), l.user_id, l.visibility)
    ) s
    where url like 'http%' and url !~* '\.(mp4|mov|webm|m3u8)(\?|$)'
    order by created_at desc, id
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 60), 1), 120)
  ) p
$$;
GRANT EXECUTE ON FUNCTION public.wrist_shots_page(uuid, text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.brand_feed_page(p_brand text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 20)
 RETURNS TABLE(id text, user_id uuid, watch_id text, club_id uuid, photo_url text, notes text, use_case text, date text, created_at timestamp with time zone, visibility text, moderation_status text, location text, badge_refs jsonb, fact_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select l.id, l.user_id, l.watch_id, l.club_id, l.photo_url, l.notes,
         l.use_case, l.date, l.created_at, l.visibility, l.moderation_status,
         l.location, l.badge_refs, l.fact_id
  from logs l
  join watches w on w.id = l.watch_id
  join watch_models m on m.id = w.model_id and m.brand = p_brand
  where l.moderation_status is null
    and shot_visible(auth.uid(), l.user_id, l.visibility)
  order by l.date desc, l.created_at desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$function$;
GRANT EXECUTE ON FUNCTION public.brand_feed_page(text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.model_feed_page(p_model_id uuid, p_offset integer DEFAULT 0, p_limit integer DEFAULT 20)
 RETURNS TABLE(id text, user_id uuid, watch_id text, club_id uuid, photo_url text, notes text, use_case text, date text, created_at timestamp with time zone, visibility text, moderation_status text, location text, badge_refs jsonb, fact_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select l.id, l.user_id, l.watch_id, l.club_id, l.photo_url, l.notes,
         l.use_case, l.date, l.created_at, l.visibility, l.moderation_status,
         l.location, l.badge_refs, l.fact_id
  from logs l
  join watches w on w.id = l.watch_id and w.model_id = p_model_id
  where l.moderation_status is null
    and shot_visible(auth.uid(), l.user_id, l.visibility)
  order by l.date desc, l.created_at desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$function$;

NOTIFY pgrst, 'reload schema';
