-- 2026-10-23: account deletion fails for any user who ever submitted feedback.
--
-- Reported by @petituc (feedback d8e7e436, five failed attempts 19:47-19:50 UTC):
-- DELETE FROM profiles returned 409 with "update or delete on table users
-- violates foreign key constraint feedback_user_id_fkey".
--
-- Chain: deleteAccount() (index.html) issues DELETE /rest/v1/feedback first,
-- which returns 204 but removes NOTHING. feedback has an own-row DELETE policy
-- but no own-row SELECT policy, and under RLS a DELETE whose WHERE references
-- the rows only sees rows visible through SELECT policies - so the delete
-- silently matches 0 rows (verified: 0 rows as the user; 2 rows the moment a
-- select-own policy exists). The surviving feedback row then blocks
-- DELETE FROM auth.users inside the cleanup_after_profile_delete trigger,
-- because feedback_user_id_fkey is NO ACTION - which aborts the profiles
-- delete and the whole account deletion.
--
-- The 2026-09-17 fix (account-delete-fk-cascade.sql) left this FK alone on the
-- assumption the client clears feedback "under working own-row DELETE
-- policies" - that assumption was wrong; the policy is dead without a
-- select-own policy. Same trap as the 2026-09 upsert/SELECT-policy bug.
--
-- Fix: cascade the FK, same as every other user-owned table. The client-side
-- feedback delete remains a harmless no-op. timegrapher_results (the other
-- NO ACTION FK to auth.users) is NOT affected: it has "Users can read own
-- results", so its client delete really deletes.
--
-- Rollback: re-add the constraint without the ON DELETE clause.

BEGIN;

ALTER TABLE public.feedback
  DROP CONSTRAINT feedback_user_id_fkey,
  ADD CONSTRAINT feedback_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMIT;
