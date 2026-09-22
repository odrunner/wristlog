-- Demo account (Alex Rivera) is read-only in storage too.
-- The table-level demo_readonly_* RESTRICTIVE policies already stop profile/watch
-- writes, but storage.objects had none, so an avatar upload from the demo
-- session wrote media files even though the profiles UPDATE was blocked.
-- RESTRICTIVE policies AND with the permissive "Users ... own files" ones, so
-- they only ever narrow access, and only for this one uid.

DROP POLICY IF EXISTS demo_readonly_storage_insert ON storage.objects;
DROP POLICY IF EXISTS demo_readonly_storage_update ON storage.objects;
DROP POLICY IF EXISTS demo_readonly_storage_delete ON storage.objects;

CREATE POLICY demo_readonly_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid);
CREATE POLICY demo_readonly_storage_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid);
CREATE POLICY demo_readonly_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid);
