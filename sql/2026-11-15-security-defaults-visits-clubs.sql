-- Three access tightenings from the weekly security report 2026-11-15
-- (F3, F4, F5). Nothing here changes what the app can do today.

-- ── 1. New tables and functions no longer start open (F3) ─────────────────
-- Until now every table postgres created in public was born with ALL for
-- anon + authenticated, and every function with EXECUTE for everyone; only
-- RLS and in-body checks stood in the way, and each new object had to be
-- locked down by hand. From here on a new object starts closed:
--   * a new table needs explicit GRANTs (already the rule in CLAUDE.md);
--   * a new function needs GRANT EXECUTE ... TO authenticated (or anon) if
--     the client calls it as an RPC, or if an RLS policy calls it.
-- service_role keeps its defaults. Sequences are left alone (a serial column
-- needs USAGE for whoever inserts). Existing objects are untouched.
-- PUBLIC's EXECUTE is a global default and can only be revoked globally, so
-- that line has no IN SCHEMA: it covers functions postgres creates anywhere.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- Rollback:
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- ── 2. page_visits: the dead "backfill" UPDATE path (F4) ──────────────────
-- The client stopped updating visits long ago (attribution goes through the
-- SECURITY DEFINER RPC attribute_page_visit); the leftover policy let any
-- signed-in user claim and rewrite every unattributed visit, held back only
-- by incidental protections. The pages only ever INSERT.
DROP POLICY IF EXISTS "Users can backfill own visit" ON public.page_visits;
REVOKE UPDATE, DELETE, TRUNCATE ON public.page_visits FROM anon, authenticated;

-- ── 3. Club images: only someone who may edit the club (F5) ───────────────
-- The upload policy let any signed-in user write anything under clubs/ in the
-- public media bucket. The app writes exactly clubs/<club id>.jpg and its
-- _thumb sibling, from the club edit form, which the clubs UPDATE policy
-- limits to the creator or an owner; the upload now has the same limit.
DROP POLICY IF EXISTS "Users upload own files" ON storage.objects;
CREATE POLICY "Users upload own files" ON storage.objects FOR INSERT TO public
WITH CHECK (
  bucket_id = 'media' AND auth.role() = 'authenticated' AND (
       name LIKE 'avatars/'  || auth.uid()::text || '%'
    OR name LIKE 'watches/'  || auth.uid()::text || '/%'
    OR name LIKE 'logs/'     || auth.uid()::text || '/%'
    OR name LIKE 'wishlist/' || auth.uid()::text || '/%'
    OR (name ~ '^clubs/[0-9a-f-]{36}(_thumb)?\.jpg$' AND EXISTS (
          SELECT 1 FROM public.clubs c
           WHERE c.id::text = substring(objects.name from 7 for 36)   -- objects.: clubs has a name column too
             AND (c.created_by = auth.uid() OR public.is_club_owner(c.id))))
  )
);
