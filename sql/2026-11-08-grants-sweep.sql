-- Grants sweep, safe half (weekly security report 2026-11-08, F2) + stale
-- receipts/ cleanup (F7).
--
-- F2: every table created before the revoke-first pattern carried the
-- default-privilege ALL grant for anon/authenticated — relacl arwdDxtm,
-- verified live 2026-11-08 on ~70 public tables. TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN are never reachable through PostgREST (it only speaks
-- SELECT/INSERT/UPDATE/DELETE), so revoking them changes nothing for any
-- client while removing the scary latent powers (TRUNCATE ignores RLS).
-- SELECT/INSERT/UPDATE/DELETE grants are deliberately NOT touched here:
-- narrowing those needs per-table analysis of what the client actually does
-- (a 2026-09-01 DELETE revoke on profiles broke account deletion for 16
-- days). The default-privileges change (new objects starting closed) is a
-- separate proposal — it changes how every future table/RPC must ship.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

-- F7: the media-bucket policies still carried a receipts/<uid>/ arm from
-- before receipts moved to their own private bucket. Verified 2026-11-08:
-- zero objects under media/receipts/, and every client call uses
-- storage.from('receipts') (owner-scoped receipts_owner_* policies, kept).
-- Same expressions as live, minus the receipts arm; clubs arm kept (F5 is
-- parked with the clubs feature).
ALTER POLICY "Read own media files" ON storage.objects
  USING (
    bucket_id = 'media' AND (
      name LIKE 'avatars/' || auth.uid()::text || '%'
      OR name LIKE 'watches/' || auth.uid()::text || '/%'
      OR name LIKE 'logs/' || auth.uid()::text || '/%'
      OR name LIKE 'wishlist/' || auth.uid()::text || '/%'
      OR (storage.foldername(name))[1] = 'clubs'
      OR ((storage.foldername(name))[1] = 'official-drafts' AND is_admin())
    )
  );

ALTER POLICY "Users delete own files" ON storage.objects
  USING (
    bucket_id = 'media' AND auth.role() = 'authenticated' AND (
      name LIKE 'avatars/' || auth.uid()::text || '%'
      OR name LIKE 'watches/' || auth.uid()::text || '/%'
      OR name LIKE 'logs/' || auth.uid()::text || '/%'
      OR name LIKE 'wishlist/' || auth.uid()::text || '/%'
    )
  );

ALTER POLICY "Users update own files" ON storage.objects
  USING (
    bucket_id = 'media' AND auth.role() = 'authenticated' AND (
      name LIKE 'avatars/' || auth.uid()::text || '%'
      OR name LIKE 'watches/' || auth.uid()::text || '/%'
      OR name LIKE 'logs/' || auth.uid()::text || '/%'
      OR name LIKE 'wishlist/' || auth.uid()::text || '/%'
    )
  );

ALTER POLICY "Users upload own files" ON storage.objects
  WITH CHECK (
    bucket_id = 'media' AND auth.role() = 'authenticated' AND (
      name LIKE 'avatars/' || auth.uid()::text || '%'
      OR name LIKE 'watches/' || auth.uid()::text || '/%'
      OR name LIKE 'logs/' || auth.uid()::text || '/%'
      OR name LIKE 'wishlist/' || auth.uid()::text || '/%'
      OR (storage.foldername(name))[1] = 'clubs'
    )
  );
