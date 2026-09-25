-- Audit 2026-09-23 SEC-23-10 + SEC-23-15, applied together on purpose.
-- (1) Admin XSS: content_reports.content_id (free text, reporter-chosen) and
--     profiles.collection_visibility (owner-writable, no CHECK) reached the
--     admin panel raw. index.html now escapes/data-attributes them; these
--     CHECKs pin the values at the source.
-- (2) Reporting was broken: notify_report_inserted() called
--     extensions.http_post (http extension not installed), so every report
--     INSERT failed with 42883 — 0 reports ever stored. It now uses pg_net
--     (net.http_post), which is async: a notify failure can no longer block a
--     report. (1) must land first, or fixing (2) opens the Reports-tab XSS.
-- Pre-check 2026-09-25: 0 content_reports rows; all profiles values valid.

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_collection_visibility_valid
  CHECK (collection_visibility IS NULL OR collection_visibility IN ('public', 'followers', 'friends', 'private'));
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_wishlist_visibility_valid
  CHECK (wishlist_visibility IS NULL OR wishlist_visibility IN ('public', 'followers', 'friends', 'friends_only', 'private'));

-- Log ids match logs_id_format; comment ids are uuids.
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_content_id_format
  CHECK (content_id ~ '^[A-Za-z0-9_-]{1,64}$');

-- Reporters file reports; only the admin decides their status.
DROP POLICY IF EXISTS "Users can report content" ON public.content_reports;
CREATE POLICY "Users can report content" ON public.content_reports FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = reporter_id AND status = 'pending' AND actioned_at IS NULL);

CREATE OR REPLACE FUNCTION public.notify_report_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/report-notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('record', to_jsonb(NEW)),
    timeout_milliseconds := 15000);
  RETURN NEW;
END;
$$;
