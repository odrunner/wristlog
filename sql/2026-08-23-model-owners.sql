-- Who-else-owns-this: count-always, names-gated. Mirrors the client showcase
-- gates (index.html ~8724): collection_visibility × watch_privacy × relationship.
create or replace function public.model_owners(p_model_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_viewer uuid := auth.uid();
begin
  return (
  with owner_watches as (
    select w.id, w.user_id, w.image, w.watch_privacy, w.year_range, w.purchase_date
    from watches w
    where w.model_id = p_model_id
      -- internal accounts stay out of counts/lists, EXCEPT the viewer's own row:
      -- the client shows total-1 as "others", so the viewer must always count themselves.
      and (w.user_id = v_viewer
        or not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id))
  ),
  owners as (select distinct user_id from owner_watches),
  rels as (
    select o.user_id,
      (v_viewer is not null and exists (select 1 from follows f
          where f.follower_id = v_viewer and f.following_id = o.user_id)) as is_follower
    from owners o
  ),
  rels2 as (
    select r.user_id, r.is_follower,
      (r.is_follower and exists (select 1 from friend_requests fr
          where fr.status = 'accepted'
            and ((fr.initiator_id = v_viewer and fr.target_id = r.user_id)
              or (fr.initiator_id = r.user_id and fr.target_id = v_viewer)))) as is_friend
    from rels r
  ),
  gated as (
    select r.user_id, r.is_follower, r.is_friend,
           p.username, p.display_name, p.avatar_url
    from rels2 r join profiles p on p.id = r.user_id
    where r.user_id is distinct from v_viewer
      and not (coalesce(p.collection_visibility, 'followers') = 'private')
      and not (coalesce(p.collection_visibility, 'followers') in ('followers', 'friends_only') and not r.is_follower)
      and not (coalesce(p.collection_visibility, 'followers') = 'friends' and not r.is_friend)
  ),
  visible_watches as (
    select ow.*, g.username, g.display_name, g.avatar_url, g.is_follower, g.is_friend
    from owner_watches ow join gated g on g.user_id = ow.user_id
    where case
      when g.is_friend   then coalesce(ow.watch_privacy, 'x') <> 'private'
      when g.is_follower then ow.watch_privacy in ('public', 'followers') or ow.watch_privacy is null
      else                    ow.watch_privacy = 'public' or ow.watch_privacy is null
    end
  ),
  per_owner as (
    select vw.user_id, vw.username, vw.display_name, vw.avatar_url,
      (select coalesce(
        (select l.photo_url from logs l
          where l.watch_id in (select id from visible_watches v2 where v2.user_id = vw.user_id)
            and l.user_id = vw.user_id and l.photo_url is not null
            and case
              when vw.is_friend   then l.visibility <> 'private'
              when vw.is_follower then l.visibility in ('public', 'followers')
              else                     l.visibility = 'public'
            end
          order by l.created_at desc limit 1),
        max(vw2.image))
       from visible_watches vw2 where vw2.user_id = vw.user_id) as photo,
      min(coalesce(substring(vw.year_range from '\d{4}'), left(vw.purchase_date, 4))) as year
    from visible_watches vw
    group by vw.user_id, vw.username, vw.display_name, vw.avatar_url, vw.is_follower, vw.is_friend
  )
  select json_build_object(
    'total_owners', (select count(*) from owners),
    'era_min', (select min(coalesce(substring(year_range from '\d{4}'), left(purchase_date, 4)))
                  from owner_watches where coalesce(substring(year_range from '\d{4}'), left(purchase_date, 4)) ~ '^\d{4}$'),
    'era_max', (select max(coalesce(substring(year_range from '\d{4}'), left(purchase_date, 4)))
                  from owner_watches where coalesce(substring(year_range from '\d{4}'), left(purchase_date, 4)) ~ '^\d{4}$'),
    'visible', coalesce((select json_agg(row_to_json(po)) from per_owner po), '[]'::json)));
end $$;

grant execute on function public.model_owners(uuid) to anon;
notify pgrst, 'reload schema';
