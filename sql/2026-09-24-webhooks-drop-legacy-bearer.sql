-- Audit 2026-09-23 SEC-23-5 (key rotation, step 1a).
-- Four Database Webhooks sent the legacy service-role JWT as
-- "Authorization: Bearer …" — the same key leaked in sql/schema.sql. None of
-- the receiving functions reads that header (all deployed --no-verify-jwt), so
-- it carried no protection, only exposure. Recreated identically minus the
-- header, so turning off the legacy keys later cannot break them.

DROP TRIGGER IF EXISTS feedback ON public.feedback;
CREATE TRIGGER feedback AFTER INSERT ON public.feedback FOR EACH ROW
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/feedback-to-github',
    'POST', '{"Content-type":"application/json"}', '{}', '5000');

DROP TRIGGER IF EXISTS new_user_alert ON public.profiles;
CREATE TRIGGER new_user_alert AFTER INSERT ON public.profiles FOR EACH ROW
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/new-user-alert',
    'POST', '{"Content-type":"application/json"}', '{}', '5000');

DROP TRIGGER IF EXISTS "send-push-on-notification" ON public.notifications;
CREATE TRIGGER "send-push-on-notification" AFTER INSERT ON public.notifications FOR EACH ROW
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-push',
    'POST', '{"Content-type":"application/json"}', '{}', '15000');

DROP TRIGGER IF EXISTS send_email ON public.notifications;
CREATE TRIGGER send_email AFTER INSERT ON public.notifications FOR EACH ROW
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-email',
    'POST', '{"Content-type":"application/json"}', '{}', '15000');
