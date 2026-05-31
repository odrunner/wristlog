-- Fix RH-A: duplicate "liked your post/comment" notifications (and duplicate APNs pushes).
-- Root cause: toggleLike / toggleCommentLike in index.html insert a notification row
-- unconditionally on every like-add, so a like -> unlike -> re-like creates duplicate rows.
-- Fix = dedup existing rows + a partial unique index as the hard backstop. The client
-- now swallows the resulting 23505 (unique_violation) silently.
--
-- Applied directly to the linked project on 2026-05-31 via `supabase db query --linked`
-- (migration push is disabled for this project — remote-only migrations). Kept here for record.

-- 1) Collapse existing duplicates, keeping the earliest row per (type, recipient, actor, ref).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY type, user_id, actor_id, ref_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM notifications
  WHERE type IN ('like','comment_like')
)
DELETE FROM notifications n
USING ranked r
WHERE n.id = r.id AND r.rn > 1;

-- 2) Prevent future duplicates. Partial so other notification types (e.g. repeated
--    'comment' notifications from the same actor on the same post) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_like_notif
ON public.notifications (user_id, actor_id, ref_id, type)
WHERE type IN ('like','comment_like');
