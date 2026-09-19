-- 2026-09-18 — close three SECURITY DEFINER functions that were callable by
-- anon/authenticated with no internal guard (Supabase security advisor 0028).
--   wear_reminder_targets()  returned user_id + EMAIL; only caller is the
--                            send-wear-reminders edge function (service role).
--   model_wear_share_rows()  per-user wear share / tenure; only caller is
--   model_wear_index_rows()  model_stats(), itself SECURITY DEFINER, so the
--                            inner call runs as the owner and is unaffected.
-- CREATE OR REPLACE keeps an existing ACL, so re-applying the older source
-- files does not reopen these — but a DROP + CREATE would: re-run this file.
REVOKE EXECUTE ON FUNCTION public.wear_reminder_targets()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.model_wear_share_rows()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.model_wear_index_rows()  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.wear_reminder_targets()  TO service_role;
GRANT  EXECUTE ON FUNCTION public.model_wear_share_rows()  TO service_role;
GRANT  EXECUTE ON FUNCTION public.model_wear_index_rows()  TO service_role;
NOTIFY pgrst, 'reload schema';
