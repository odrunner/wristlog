-- Follow-up for the 2026-09-18 security changes (revokes, media read policy,
-- piezo insert policy). Read-only. One row per day for the last 9 days so the
-- days after the change (2026-09-19 onward, UTC) sit next to their own baseline.
-- A silent break shows up as a column dropping to ~0 while the others hold.
--   npx supabase db query --linked --file sql/checks/2026-09-18-security-change-followup.sql
WITH d AS (SELECT generate_series((now() AT TIME ZONE 'utc')::date - 8, (now() AT TIME ZONE 'utc')::date, '1 day')::date AS day)
SELECT d.day,
  (SELECT count(*) FROM wear_reminder_sends s WHERE s.sent_on = d.day)                                   AS wear_reminders_sent,
  (SELECT count(*) FROM watches w   WHERE (w.created_at AT TIME ZONE 'utc')::date = d.day)                AS watches_added,
  (SELECT count(*) FROM watches w   WHERE (w.created_at AT TIME ZONE 'utc')::date = d.day
                                      AND w.model_id IS NULL AND coalesce(w.brand,'') <> '' AND coalesce(w.name,'') <> '') AS watches_missing_model,
  (SELECT count(*) FROM wishlist x  WHERE (x.created_at AT TIME ZONE 'utc')::date = d.day)                AS wishlist_added,
  (SELECT count(*) FROM storage.objects o WHERE o.bucket_id='media' AND (o.created_at AT TIME ZONE 'utc')::date = d.day
                                      AND o.name ~ '^(logs|watches|wishlist|avatars|receipts)/')         AS media_uploads,
  (SELECT count(*) FROM feedback f  WHERE (f.created_at AT TIME ZONE 'utc')::date = d.day)                AS feedback_rows,
  (SELECT count(*) FROM experiment_decisions e WHERE (e.created_at AT TIME ZONE 'utc')::date = d.day
                                      AND e.verdict ILIKE '%error%')                                     AS experiment_errors
FROM d ORDER BY d.day;
