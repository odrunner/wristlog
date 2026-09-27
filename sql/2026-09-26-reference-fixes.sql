-- 2026-09-26: the 4 real mis-filings from the reference sweep (owner-approved).
-- Undo notes: watch b0de66d4-04d7-4887-8b42-8ffb309aeec3 was on tudor-pelagos;
-- watches b4e78138-82f3-4333-98cb-15eb00b37d05, 9da9137a-7005-4b38-b13c-4270f66b90ae
-- were on omega-speedmaster; the two merges leave tombstones (merged_into).
-- 3513.53 (a7d65e4a…) deliberately left on Speedmaster: Reduced vs Speedmaster Date unconfirmed.
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where username = 'od' and is_admin))::text, true);
select public.admin_merge_watch_models(
  (select id from watch_models where slug = 'seiko-speed-timer' and merged_into is null),
  (select id from watch_models where slug = 'seiko-prospex-speedtimer' and merged_into is null));
select public.admin_merge_watch_models(
  (select id from watch_models where slug = 'seiko-spirit-sarb033-baby-grand-seiko' and merged_into is null),
  (select id from watch_models where slug = 'seiko-sarb035' and merged_into is null));
update watch_models set name = 'Spirit SARB033 / SARB035' where slug = 'seiko-sarb035' and merged_into is null;
update watches set model_id = (select id from watch_models where slug = 'tudor-pelagos-39' and merged_into is null)
  where id = 'b0de66d4-04d7-4887-8b42-8ffb309aeec3';
update watches set model_id = (select id from watch_models where slug = 'omega-speedmaster-reduced' and merged_into is null)
  where id in ('b4e78138-82f3-4333-98cb-15eb00b37d05', '9da9137a-7005-4b38-b13c-4270f66b90ae');
commit;
