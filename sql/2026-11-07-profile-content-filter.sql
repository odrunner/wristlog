-- sql/2026-11-07-profile-content-filter.sql
-- Security audit 2026-11-06 NEW-3: display_name and bio passed only the client's
-- checkContent() — a hostile client could PATCH the granted columns directly.
-- This ports checkContent()'s four patterns to SQL and enforces them in a
-- BEFORE trigger, the same approach as enforce_reserved_username.
--
-- Deliberately NOT the audit's one-line suggestion (reserved_usernames pattern
-- rows): those include brand patterns ('wrotate' would block a bio that mentions
-- the app) and exact rows that are real human names ('alp', 'dogan'). Porting
-- the client regexes verbatim means the server accepts exactly what the client
-- already accepts — no new false positives.
--
-- KEEP IN STEP with _objPatterns/checkContent() in index.html and
-- wrotate_test.js (OBJECTIONABLE_PATTERNS). JS \b == Postgres \y, \s == [[:space:]].
-- Existing rows are grandfathered per field: only a CHANGED display_name/bio is
-- checked, so a pre-rule bio never blocks an unrelated profile save.

CREATE OR REPLACE FUNCTION public.is_content_objectionable(p_text text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(p_text, '') ~* '\y(f+[u*]+[c*]+[k*]+|sh[i*]+[t*]+|a[s*]+h[o*]+le|b[i*]+tch|d[i*]+ck|c[u*]+nt)\y'
      OR coalesce(p_text, '') ~* '\y(kill[[:space:]]+your|go[[:space:]]+die|kys|stfu)\y'
      OR coalesce(p_text, '') ~* '\y(buy[[:space:]]+now|click[[:space:]]+here|free[[:space:]]+money|act[[:space:]]+now)\y'
      OR coalesce(p_text, '') ~* '\y(n[i1]+[gq]+[e3]*r|f+[a@]+[gq]+[o0]*t|tr[a@]+nn)';
$$;
REVOKE ALL ON FUNCTION public.is_content_objectionable(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_profile_content()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.display_name IS NOT DISTINCT FROM OLD.display_name
     AND NEW.bio IS NOT DISTINCT FROM OLD.bio THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    -- Server-side path: handle_new_user seeds display_name from the email prefix
    -- inside the auth.users insert — an exception here would roll back that
    -- insert and brick signup for the address (same rule as
    -- enforce_reserved_username). Sanitize, never raise.
    IF public.is_content_objectionable(NEW.display_name) THEN NEW.display_name := NULL; END IF;
    IF public.is_content_objectionable(NEW.bio) THEN NEW.bio := NULL; END IF;
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.display_name IS DISTINCT FROM OLD.display_name)
     AND public.is_content_objectionable(NEW.display_name) THEN
    RAISE EXCEPTION 'display_name contains objectionable content';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.bio IS DISTINCT FROM OLD.bio)
     AND public.is_content_objectionable(NEW.bio) THEN
    RAISE EXCEPTION 'bio contains objectionable content';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_profile_content() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_profile_content ON public.profiles;
CREATE TRIGGER trg_enforce_profile_content
  BEFORE INSERT OR UPDATE OF display_name, bio ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_content();

-- Audit 2026-11-06 NEW-4 (cosmetic, "next time the file area is touched"):
-- the username trigger function kept default PUBLIC EXECUTE — and this
-- project's default privileges had also granted anon/authenticated.
REVOKE ALL ON FUNCTION public.enforce_reserved_username() FROM PUBLIC, anon, authenticated;
