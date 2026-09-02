-- Audit 2026-09-01 REL-N9 (partial): stop last-write-wins on prefs JSON blobs.
--
-- email_prefs and rec_settings were mutated key-by-key in JS and written back
-- WHOLE — two quick toggles (or two devices) raced and one lost. This RPC
-- merges a single-key patch server-side (jsonb || is key-level), so concurrent
-- writers only clobber each other when they touch the SAME key.
--
-- SECURITY DEFINER because the column grants deliberately deny SELECT on
-- email_prefs/rec_settings to `authenticated` (own-row reads go through
-- my_profile()) — an invoker-rights UPDATE that reads the column in its SET
-- expression would be denied. Row scope is pinned to auth.uid(); field is
-- whitelisted; the demo account is refused (same account the demo_readonly_*
-- policies pin).
--
-- Readers treat missing keys as their defaults (e.g. email_prefs.reminders
-- defaults on), so patching only the toggled key is correct.
--
-- Rollback: client reverts to whole-object UPDATE; DROP FUNCTION merge_profile_pref(text, jsonb).

CREATE OR REPLACE FUNCTION public.merge_profile_pref(p_field text, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF auth.uid() = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid THEN
    RAISE EXCEPTION 'demo account is read-only';
  END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'patch must be a JSON object';
  END IF;
  IF p_field = 'email_prefs' THEN
    UPDATE profiles SET email_prefs = coalesce(email_prefs, '{}'::jsonb) || p_patch
     WHERE id = auth.uid() RETURNING email_prefs INTO result;
  ELSIF p_field = 'rec_settings' THEN
    UPDATE profiles SET rec_settings = coalesce(rec_settings, '{}'::jsonb) || p_patch
     WHERE id = auth.uid() RETURNING rec_settings INTO result;
  ELSE
    RAISE EXCEPTION 'invalid field %', p_field;
  END IF;
  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.merge_profile_pref(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_profile_pref(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
