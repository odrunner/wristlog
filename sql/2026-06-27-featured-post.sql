-- Featured post: single active slot + FIFO queue, 24h lazy rotation (no cron).
-- Spec: docs/superpowers/specs/2026-06-27-featured-post-design.md
-- Deployed via `npx supabase db query --linked`; this file is the record.

CREATE TABLE IF NOT EXISTS public.featured_posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id       text NOT NULL REFERENCES public.logs(id) ON DELETE CASCADE,
  enqueued_by  uuid REFERENCES auth.users(id),
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  expires_at   timestamptz,
  status       text NOT NULL DEFAULT 'queued'  -- queued | active | expired
);

-- A given post can appear at most once while still queued/active.
CREATE UNIQUE INDEX IF NOT EXISTS featured_posts_one_per_log
  ON public.featured_posts(log_id)
  WHERE status IN ('queued','active');

ALTER TABLE public.featured_posts ENABLE ROW LEVEL SECURITY;
-- No RLS policies: all access via the SECURITY DEFINER RPCs below (which bypass RLS).

-- ── Internal rotation: expire stale/ineligible active, promote next eligible queued ──
CREATE OR REPLACE FUNCTION public.featured_rotate()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_next uuid;
BEGIN
  -- Serialize concurrent rotations (every feed load calls this) so we never double-promote.
  PERFORM pg_advisory_xact_lock(hashtext('featured_rotate'));

  -- 1. Expire active rows past expiry or whose post is no longer eligible.
  UPDATE featured_posts fp SET status = 'expired'
  WHERE fp.status = 'active'
    AND (
      fp.expires_at <= now()
      OR NOT EXISTS (
        SELECT 1 FROM logs l
        WHERE l.id = fp.log_id
          AND l.visibility = 'public'
          AND (l.moderation_status IS NULL OR l.moderation_status <> 'removed')
      )
    );

  -- 2. Expire queued rows whose post is no longer eligible (hard-deleted handled by cascade).
  UPDATE featured_posts fp SET status = 'expired'
  WHERE fp.status = 'queued'
    AND NOT EXISTS (
      SELECT 1 FROM logs l
      WHERE l.id = fp.log_id
        AND l.visibility = 'public'
        AND (l.moderation_status IS NULL OR l.moderation_status <> 'removed')
    );

  -- 3. If nothing active, promote the oldest eligible queued row with a fresh 24h clock.
  IF NOT EXISTS (SELECT 1 FROM featured_posts WHERE status = 'active') THEN
    SELECT fp.id INTO v_next
    FROM featured_posts fp
    WHERE fp.status = 'queued'
    ORDER BY fp.enqueued_at ASC
    LIMIT 1;
    IF v_next IS NOT NULL THEN
      UPDATE featured_posts
      SET status = 'active', activated_at = now(), expires_at = now() + interval '24 hours'
      WHERE id = v_next;
    END IF;
  END IF;
END;
$f$;

-- ── Public read: rotate, then return the active featured log_id (or null) ──
CREATE OR REPLACE FUNCTION public.featured_current()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_log text;
BEGIN
  PERFORM featured_rotate();
  SELECT log_id INTO v_log FROM featured_posts WHERE status = 'active' LIMIT 1;
  RETURN v_log;
END;
$f$;

-- ── Admin: feature a post (append to FIFO queue; lazy promote if slot empty) ──
CREATE OR REPLACE FUNCTION public.admin_feature_post(p_log_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM logs WHERE id = p_log_id
      AND visibility = 'public'
      AND (moderation_status IS NULL OR moderation_status <> 'removed')
  ) THEN
    RAISE EXCEPTION 'Post is not eligible to be featured (must be a public, non-removed post)';
  END IF;
  IF EXISTS (SELECT 1 FROM featured_posts WHERE log_id = p_log_id AND status IN ('queued','active')) THEN
    RAISE EXCEPTION 'Post is already featured or queued';
  END IF;
  INSERT INTO featured_posts(log_id, enqueued_by) VALUES (p_log_id, auth.uid());
  PERFORM featured_rotate();
END;
$f$;

-- ── Admin: remove a queued/active entry (next read promotes successor) ──
CREATE OR REPLACE FUNCTION public.admin_unfeature(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM featured_posts WHERE id = p_id;
  PERFORM featured_rotate();
END;
$f$;

-- ── Admin: current active + queued, with post fields for display ──
CREATE OR REPLACE FUNCTION public.admin_featured_queue()
RETURNS TABLE(
  id uuid, log_id text, status text, activated_at timestamptz, expires_at timestamptz,
  enqueued_at timestamptz, notes text, photo_url text, user_id uuid,
  display_name text, username text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $f$
BEGIN
  -- profiles.id qualified: 'id' is also a RETURNS TABLE out-param here, so an
  -- unqualified reference is ambiguous (PL/pgSQL variable vs. table column).
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  PERFORM featured_rotate();
  RETURN QUERY
  SELECT fp.id, fp.log_id, fp.status, fp.activated_at, fp.expires_at, fp.enqueued_at,
         l.notes, l.photo_url, l.user_id, pr.display_name, pr.username
  FROM featured_posts fp
  JOIN logs l ON l.id = fp.log_id
  LEFT JOIN profiles pr ON pr.id = l.user_id
  WHERE fp.status IN ('queued','active')
  ORDER BY (fp.status = 'active') DESC, fp.enqueued_at ASC;
END;
$f$;

-- ── Grants: lock down, expose only what the client needs to authenticated ──
REVOKE EXECUTE ON FUNCTION public.featured_rotate()          FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.admin_feature_post(text)   FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.admin_unfeature(uuid)      FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.admin_featured_queue()     FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.featured_current()         FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.featured_current()         TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_feature_post(text)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_unfeature(uuid)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_featured_queue()     TO authenticated;
