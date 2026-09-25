-- Audit 2026-09-23 SEC-23-22 — post/comment owners could undo moderation:
-- "Users can update own logs/comments" had no column limit, so an owner set
-- moderation_status back to NULL on content the admin had removed or that was
-- flagged pending review. Now:
--  * admin_set_moderation() (is_admin, definer) is the only client path that
--    changes it (admin Remove/Restore); reporters flag via flag_content();
--  * users' UPDATE on logs/comments covers every column except moderation_status.

CREATE OR REPLACE FUNCTION public.admin_set_moderation(p_type text, p_id text, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_n int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('flagged', 'removed') THEN
    RAISE EXCEPTION 'bad status';
  END IF;
  IF p_type = 'log' THEN
    UPDATE logs SET moderation_status = p_status WHERE id = p_id;
  ELSIF p_type = 'comment' AND p_id ~ '^[0-9a-fA-F-]{36}$' THEN
    UPDATE comments SET moderation_status = p_status WHERE id = p_id::uuid;
  ELSE
    RETURN false;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_moderation(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_moderation(text, text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- Step 2 (after the client switched to admin_set_moderation, a78221f):
REVOKE UPDATE ON public.logs FROM anon, authenticated;
GRANT UPDATE (id, user_id, watch_id, date, use_case, notes, strap_id, photo_url, created_at, visibility, club_id, location, badge_refs, fact_id) ON public.logs TO authenticated;
REVOKE UPDATE ON public.comments FROM anon, authenticated;
GRANT UPDATE (id, user_id, log_id, body, created_at) ON public.comments TO authenticated;
