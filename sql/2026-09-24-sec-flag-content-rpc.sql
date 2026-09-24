-- Audit 2026-09-23 SEC-23-4 — post/comment takeover via the reporter flag path.
-- "Reporter can flag logs/comments" let any signed-in non-owner UPDATE a row,
-- checking only moderation_status='flagged' afterwards. With table-level UPDATE
-- every column was writable: setting user_id to yourself (so the row stays
-- visible) + flagged, then clearing the flag as the new "owner", took over any
-- public post or comment (verified as testuser2 on testuser's content, rolled
-- back). Replaced by flag_content(): NULL -> 'flagged' only, no other column,
-- and only for content the caller filed a report on in the last hour.

DROP POLICY IF EXISTS "Reporter can flag logs" ON public.logs;
DROP POLICY IF EXISTS "Reporter can flag comments" ON public.comments;

CREATE OR REPLACE FUNCTION public.flag_content(p_type text, p_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n int;
BEGIN
  IF v_uid IS NULL OR p_type NOT IN ('log', 'comment') OR p_id IS NULL THEN
    RETURN false;
  END IF;
  -- A flag hides content from everyone pending admin review, so it must be
  -- backed by a report the admin can see in the Reports tab.
  IF NOT EXISTS (
    SELECT 1 FROM content_reports r
    WHERE r.reporter_id = v_uid AND r.content_type = p_type
      AND r.content_id = p_id AND r.created_at > now() - interval '1 hour'
  ) THEN
    RETURN false;
  END IF;
  IF p_type = 'log' THEN
    UPDATE logs SET moderation_status = 'flagged'
     WHERE id = p_id AND user_id <> v_uid AND moderation_status IS NULL;
  ELSE
    IF p_id !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
    UPDATE comments SET moderation_status = 'flagged'
     WHERE id = p_id::uuid AND user_id <> v_uid AND moderation_status IS NULL;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.flag_content(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flag_content(text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
