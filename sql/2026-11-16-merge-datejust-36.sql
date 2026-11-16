-- 2026-11-16: fold "Rolex Datejust 36" into "Rolex Datejust" (owner's call).
-- The split followed whatever each member typed: the plain page already held
-- 36mm and 41mm references alike, so a member's Datejust 36 posts were missing
-- from the page called Datejust. Same path as Admin -> Models -> Merge; the
-- source row stays as a tombstone (merged_into), so its slug still resolves.
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where username = 'od' and is_admin))::text, true);
select public.admin_merge_watch_models(
  (select id from watch_models where slug = 'rolex-datejust-36' and merged_into is null),
  (select id from watch_models where slug = 'rolex-datejust' and merged_into is null));
commit;
