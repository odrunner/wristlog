-- 2026-09-18 — remaining Supabase security-advisor items, one transaction.
-- Companion to 2026-09-18-revoke-server-only-rpcs.sql. Every change below was
-- checked against its callers first (grep index.html + pg_proc + pg_policies).
--
-- Rollback (each independent):
--   1. GRANT EXECUTE ON FUNCTION public.resolve_watch_model(text,text,text) TO anon, authenticated;
--   2. DROP POLICY "Read own media files" ON storage.objects;
--      CREATE POLICY "Public read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'media');
--   3. DROP POLICY pz_cap_insert ON public.piezo_raw_captures;
--      CREATE POLICY pz_cap_insert ON public.piezo_raw_captures FOR INSERT TO authenticated WITH CHECK (true);
--   4. re-apply the function from sql/2026-09-01-feedback-insert-hardening.sql
--   5. ALTER FUNCTION ... RESET search_path;

BEGIN;

-- 1. resolve_watch_model() INSERTs into watch_models and had no guard, so a
--    logged-out caller could mint model rows. Its only caller is the
--    set_watch_model_id() trigger (SECURITY DEFINER → runs as owner), so the
--    watches/wishlist insert path is unaffected. No client or edge-fn caller.
REVOKE EXECUTE ON FUNCTION public.resolve_watch_model(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolve_watch_model(text, text, text) TO service_role;

-- 2. media bucket: "Public read" let ANYONE (logged out included) list every
--    path in the bucket — receipts/<uid>/…, private-post photos under logs/.
--    Public buckets serve /object/public/… without consulting RLS, so image
--    URLs keep working. SELECT is still needed by the owner for upsert and
--    remove(), so it is narrowed to exactly the paths each caller can already
--    write: own folders, clubs/ (any signed-in user, as the upload policy), and
--    official-drafts/ for admins. Service-role scripts bypass RLS.
CREATE POLICY "Read own media files" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'media' AND (
       name LIKE 'avatars/'  || auth.uid()::text || '%'
    OR name LIKE 'watches/'  || auth.uid()::text || '/%'
    OR name LIKE 'logs/'     || auth.uid()::text || '/%'
    OR name LIKE 'wishlist/' || auth.uid()::text || '/%'
    OR name LIKE 'receipts/' || auth.uid()::text || '/%'
    OR (storage.foldername(name))[1] = 'clubs'
    OR ((storage.foldername(name))[1] = 'official-drafts' AND public.is_admin())
  )
);
DROP POLICY "Public read" ON storage.objects;

-- 3. piezo_raw_captures: any signed-in user could insert unbounded blobs into
--    the table behind the 2026-08-13 outage. Raw capture is an admin-testing
--    path (index.html _tgNativeCallback) and the table has received 0 rows
--    since it was truncated. Limit to admin/internal accounts and cap the blob:
--    a full 12 s capture at 48 kHz is ~1.54 M base64 chars.
DROP POLICY pz_cap_insert ON public.piezo_raw_captures;
CREATE POLICY pz_cap_insert ON public.piezo_raw_captures FOR INSERT TO authenticated
WITH CHECK (
  ( public.is_admin()
    OR EXISTS (SELECT 1 FROM public.internal_accounts ia WHERE ia.user_id = (SELECT auth.uid())) )
  AND length(samples_b64) <= 4000000
);

-- 4. feedback_recent_count(): must stay executable by anon/authenticated (the
--    "Feedback rate limit" INSERT policy calls it as the inserting role), but
--    it answered for ANY user id. Now it only counts the caller's own rows (or
--    the anonymous bucket). The policy only ever passes auth.uid() or NULL.
CREATE OR REPLACE FUNCTION public.feedback_recent_count(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::int FROM feedback
  WHERE created_at > now() - interval '1 hour'
    AND (CASE WHEN p_user IS NULL THEN user_id IS NULL
              ELSE user_id = p_user AND p_user = auth.uid() END);
$$;

-- 5. Pin search_path on the three functions the advisor named (lint 0011).
ALTER FUNCTION public.unsaved_measurement_sessions(text) SET search_path = public;
ALTER FUNCTION public.normalize_model_key(text, text)    SET search_path = public;
ALTER FUNCTION public.normal_cdf(double precision)       SET search_path = public;

COMMIT;

NOTIFY pgrst, 'reload schema';
