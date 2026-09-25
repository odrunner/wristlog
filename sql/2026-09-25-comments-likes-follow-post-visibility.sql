-- Audit 2026-09-23 SEC-23-14 — comments/likes leaked from non-public posts.
-- "Anyone can read comments" ignored the post's visibility: a logged-out caller
-- read 220 comments (body, author, post id) on posts they cannot see; likes and
-- comment_likes were USING (true) (three duplicate policies). Each now follows
-- its parent: the EXISTS runs under the caller's own RLS on logs/comments, so a
-- comment or like is readable exactly when its post is. Own rows stay readable;
-- the admin policy on comments is unchanged.

DROP POLICY IF EXISTS "Anyone can read comments" ON public.comments;
CREATE POLICY comments_read ON public.comments FOR SELECT TO anon, authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR (moderation_status IS NULL
        AND EXISTS (SELECT 1 FROM public.logs l WHERE l.id = comments.log_id))
  );

DROP POLICY IF EXISTS "Anyone can read likes" ON public.likes;
DROP POLICY IF EXISTS likes_read ON public.likes;
DROP POLICY IF EXISTS likes_select ON public.likes;
CREATE POLICY likes_read ON public.likes FOR SELECT TO anon, authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (SELECT 1 FROM public.logs l WHERE l.id = likes.log_id)
  );

DROP POLICY IF EXISTS "Anyone can read comment likes" ON public.comment_likes;
DROP POLICY IF EXISTS "Users can read all comment likes" ON public.comment_likes;
CREATE POLICY comment_likes_read ON public.comment_likes FOR SELECT TO anon, authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (SELECT 1 FROM public.comments c WHERE c.id = comment_likes.comment_id)
  );
