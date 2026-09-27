-- 2026-09-26: 4 watches named plain "Submariner" carry Submariner Date references
-- (16610 x3, 16800 x1). The resolver matched the name before the reference, so they
-- sat on the no-date Submariner page and its write-up picked up Date references and
-- calibres. Move them to Submariner Date. Previous links are echoed below for undo:
--   update watches set model_id = (select id from watch_models where slug='rolex-submariner') where id in (
--   'cc303255-c0bb-4fd3-a042-7395af57ef3f', '1db4be33-16ea-4501-9d14-bf6b349ace14', 'd488f5ac-2e55-4c87-9955-33129f2c0e32', 'd6582f1a-b8a9-4eeb-831d-39211484c2d5');
update watches w
set model_id = (select id from watch_models where slug = 'rolex-submariner-date' and merged_into is null)
where w.model_id = (select id from watch_models where slug = 'rolex-submariner' and merged_into is null)
  and upper(regexp_replace(coalesce(w.ref, ''), '[^A-Za-z0-9]', '', 'g')) ~ '^(16610|16800)'
returning w.id;
