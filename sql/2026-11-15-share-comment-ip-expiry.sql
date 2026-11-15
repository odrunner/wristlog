-- Share-link comments: the per-address limiter's fingerprint does not outlive
-- its use (weekly security report 2026-11-15, follow-up to F2).
--
-- The comment handler keys its 10-per-hour limit on a fingerprint of the
-- poster's IP, held in rate_limits.function_name ('share-comment:ip:<hash>').
-- Nothing ever removed those rows. The fingerprint is now HMAC-keyed (edge
-- secret IP_HASH_KEY, see _shared/share-comments-lib.ts) and is no longer
-- written to share_comments.ip_hash at all; this job clears the limiter rows
-- a day after their window opened. The window is one hour, so nothing the
-- limiter still needs is touched.
--
-- Rollback: SELECT cron.unschedule('forget-share-comment-ips');

UPDATE public.share_comments SET ip_hash = NULL WHERE ip_hash IS NOT NULL;
DELETE FROM public.rate_limits WHERE function_name LIKE 'share-comment:ip:%';

SELECT cron.unschedule('forget-share-comment-ips') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'forget-share-comment-ips');
SELECT cron.schedule('forget-share-comment-ips', '23 * * * *',
  $job$DELETE FROM public.rate_limits WHERE function_name LIKE 'share-comment:ip:%' AND window_start < now() - interval '24 hours'$job$);
