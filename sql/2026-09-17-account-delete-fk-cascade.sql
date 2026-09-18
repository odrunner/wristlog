-- 2026-09-17: let account deletion finish when the user has rows in tables the
-- client never clears.
--
-- deleteAccount() (index.html) ends with DELETE FROM profiles; the
-- cleanup_after_profile_delete trigger then runs DELETE FROM auth.users. Four
-- foreign keys still default to NO ACTION, so a user with rows in any of them
-- makes that auth.users delete — and therefore the whole profile delete — fail
-- with a foreign-key violation:
--
--   timegrapher_debug_logs.user_id  -> auth.users   (client never touches it;
--                                                     449 rows / 2 users today)
--   app_feedback.user_id            -> auth.users   (client tries, but the table
--                                                     has no DELETE policy so the
--                                                     RLS-filtered delete removes
--                                                     0 rows; 6 rows / 4 users)
--   featured_posts.enqueued_by      -> auth.users   (admin authorship; nullable)
--   official_drafts.created_by      -> profiles     (admin authorship; nullable)
--
-- User-owned data cascades with the account. Admin-authorship columns are set
-- to NULL instead so the featured post / draft itself survives the admin
-- account. feedback and timegrapher_results also point at auth.users with
-- NO ACTION but the client clears them first under working own-row DELETE
-- policies, so they are left unchanged here.
--
-- Rollback: re-add each constraint without the ON DELETE clause.

BEGIN;

ALTER TABLE public.timegrapher_debug_logs
  DROP CONSTRAINT timegrapher_debug_logs_user_id_fkey,
  ADD CONSTRAINT timegrapher_debug_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.app_feedback
  DROP CONSTRAINT app_feedback_user_id_fkey,
  ADD CONSTRAINT app_feedback_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.featured_posts
  DROP CONSTRAINT featured_posts_enqueued_by_fkey,
  ADD CONSTRAINT featured_posts_enqueued_by_fkey
    FOREIGN KEY (enqueued_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.official_drafts
  DROP CONSTRAINT official_drafts_created_by_fkey,
  ADD CONSTRAINT official_drafts_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMIT;
