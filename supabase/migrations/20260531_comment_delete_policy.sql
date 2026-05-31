-- Allow a user to delete a comment if they wrote it, OR if they own the post
-- it's on (Instagram/Strava moderation model). comment_likes cascade on delete.
-- See docs/superpowers/specs/2026-05-31-delete-comment-design.md

DROP POLICY IF EXISTS "Owner or post author can delete comments" ON comments;

CREATE POLICY "Owner or post author can delete comments" ON comments
FOR DELETE USING (
  auth.uid() = user_id
  OR auth.uid() = (SELECT user_id FROM logs WHERE id = comments.log_id)
);
