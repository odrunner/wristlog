-- Add model_id to feed_watch_display so feed cards can deep-link to the
-- in-app model page. RETURNS TABLE changed -> drop + recreate with the
-- original grants (see sql/2026-08-13-feed-watch-display.sql).

DROP FUNCTION IF EXISTS public.feed_watch_display(text[]);

CREATE OR REPLACE FUNCTION public.feed_watch_display(ids text[])
RETURNS TABLE(id text, brand text, name text, color text, image text, ref text,
              url text, description text, background text, functions text[], model_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT w.id, w.brand, w.name, w.color, w.image,
         w.ref, w.url, w.description, w.background, w.functions, w.model_id
  FROM watches w
  WHERE w.id = ANY(ids)
    AND (
      w.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM logs l
        WHERE l.watch_id = w.id
          AND l.visibility IS DISTINCT FROM 'private'
      )
    );
$$;

COMMENT ON FUNCTION public.feed_watch_display(text[]) IS
  'Display-only watch fields for feed cards. Replaces the watches_feed_read RLS '
  'policy, which granted the whole row (price, insured_value, receipts) when the '
  'feed only needs brand/name/image. See audit-results/2026-08-13-security-audit.md S2.';

REVOKE ALL ON FUNCTION public.feed_watch_display(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.feed_watch_display(text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
