-- 2026-09-26: delete auto watch models nothing points at any more (no watch,
-- no wishlist row, not a merge target) — left behind when members renamed or
-- deleted a watch. 94 rows, all auto, none enriched or with a hero image.
-- Backup of the rows + their aliases: sql/backups/2026-09-26-orphan-watch-models.json.
-- A future add with the same name simply re-creates the model via the resolver.
begin;
create temp table _orphans on commit drop as
  select z.id from watch_models z
  where z.merged_into is null and z.is_auto
    and not exists (select 1 from watches x where x.model_id = z.id)
    and not exists (select 1 from wishlist y where y.model_id = z.id)
    and not exists (select 1 from watch_models t where t.merged_into = z.id);
delete from watch_model_aliases where model_id in (select id from _orphans);
delete from watch_models where id in (select id from _orphans);
commit;
