-- Feed watch display accessor — closes the last of audit finding S2.
--
-- Problem: `watches_feed_read` let any authenticated user read a watch row whenever
-- that watch was attached to a non-private post. Publicly posting a restricted watch
-- is INTENDED behaviour, so the policy could not simply be dropped — the feed needs
-- to resolve the watch to render the card. But the policy granted the WHOLE row:
-- price, insured_value, insurance, insurance_notes, receipts, purchase_date,
-- market_price. The feed only ever reads ten display columns.
--
-- Fix: this function returns exactly those ten columns under the same visibility
-- condition the policy used, so the feed is unchanged while the financial fields
-- stop leaving the database. `watches_feed_read` is then dropped.
--
-- Deliberately granted to `authenticated` only. The logged-out public feed
-- (loadPublicFeed, index.html:11069) never had `watches_feed_read` — that policy was
-- TO authenticated — so anon already cannot resolve restricted watches. Granting
-- anon here would WIDEN what logged-out visitors see; out of scope for a fix.

CREATE OR REPLACE FUNCTION public.feed_watch_display(ids text[])
RETURNS TABLE (
  id          text,
  brand       text,
  name        text,
  color       text,
  image       text,
  ref         text,
  url         text,
  description text,
  background  text,
  functions   text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.brand, w.name, w.color, w.image,
         w.ref, w.url, w.description, w.background, w.functions
  FROM watches w
  WHERE w.id = ANY(ids)
    AND (
      -- the owner always resolves their own watches (covers own private posts)
      w.user_id = auth.uid()
      -- otherwise: mirrors the dropped watches_feed_read condition exactly, so
      -- feed rendering is byte-for-byte unchanged
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
