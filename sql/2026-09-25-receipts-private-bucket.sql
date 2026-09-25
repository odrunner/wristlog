-- Audit 2026-09-23 SEC-23-8 (receipts). Receipts were uploaded to the public
-- `media` bucket (receipts/<uid>/…) and stored as public URLs — anyone holding a
-- link could open a purchase receipt. They now live in a PRIVATE bucket,
-- readable only by their owner through short-lived signed URLs.
-- Object path: <uid>/<watch_id>/<receipt_id>.<ext>; watches.receipts[] entries
-- carry {path} instead of a public {data} URL. The demo_readonly_storage_*
-- RESTRICTIVE policies (no bucket filter) keep applying.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('receipts', 'receipts', false, 15728640,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS receipts_owner_read ON storage.objects;
CREATE POLICY receipts_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS receipts_owner_insert ON storage.objects;
CREATE POLICY receipts_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS receipts_owner_update ON storage.objects;
CREATE POLICY receipts_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS receipts_owner_delete ON storage.objects;
CREATE POLICY receipts_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
