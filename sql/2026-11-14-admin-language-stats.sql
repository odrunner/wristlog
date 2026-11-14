-- sql/2026-11-14-admin-language-stats.sql
-- Admin Usage tab -> Languages card: how many members explicitly chose an app
-- language (profiles.language, sql/2026-11-13-profiles-language.sql) and which,
-- each with the usual last-24h change.
--
-- profiles.language carries no timestamp, so a 24h change can't be read from
-- it. language_changes records every change (trigger below); the RPC takes the
-- totals from profiles (current state) and the 24h change from this log. The
-- log starts empty: choices made before it was deployed count in the totals
-- but never in a 24h change.
--
-- No grants: written only by the SECURITY DEFINER trigger, read only by the
-- SECURITY DEFINER RPC. RLS on with no policies, so the Data API sees nothing.
-- No FK to profiles, so account deletion is untouched; the RPC joins profiles,
-- which drops a deleted member's rows.
--
-- Deploy with:
--   npx supabase db query --linked --file sql/2026-11-14-admin-language-stats.sql
-- Guarded by tests/admin-language-stats-sql.test.js.

CREATE TABLE IF NOT EXISTS public.language_changes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid        NOT NULL,
  old_language text,
  new_language text,
  changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS language_changes_changed_at_idx ON public.language_changes (changed_at);
ALTER TABLE public.language_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.language_changes FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_language_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  INSERT INTO language_changes (user_id, old_language, new_language)
  VALUES (NEW.id, OLD.language, NEW.language);
  RETURN NULL;
END; $function$;
REVOKE EXECUTE ON FUNCTION public.log_language_change() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS profiles_language_change ON public.profiles;
CREATE TRIGGER profiles_language_change
  AFTER UPDATE OF language ON public.profiles
  FOR EACH ROW
  WHEN (OLD.language IS DISTINCT FROM NEW.language)
  EXECUTE FUNCTION public.log_language_change();

CREATE OR REPLACE FUNCTION public.admin_language_stats()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  WITH chosen AS (
    SELECT p.id, p.language
      FROM profiles p
     WHERE p.language IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = p.id)
  ),
  recent AS (
    SELECT c.old_language, c.new_language
      FROM language_changes c
      JOIN profiles p ON p.id = c.user_id
     WHERE c.changed_at >= now() - interval '24 hours'
       AND NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = c.user_id)
  ),
  langs AS (
    SELECT language AS lang FROM chosen
    UNION SELECT new_language FROM recent WHERE new_language IS NOT NULL
    UNION SELECT old_language FROM recent WHERE old_language IS NOT NULL
  ),
  per_lang AS (
    -- d1 is the net change: members who switched TO the language in the last
    -- 24h minus those who switched away from it.
    SELECT l.lang,
           (SELECT count(*) FROM chosen WHERE language = l.lang) AS users,
           (SELECT count(*) FROM recent WHERE new_language = l.lang)
         - (SELECT count(*) FROM recent WHERE old_language = l.lang) AS d1
      FROM langs l
  )
  SELECT json_build_object(
    'chosen_total', (SELECT count(*) FROM chosen),
    -- First-ever choices minus choices cleared back to none; a switch between
    -- two languages leaves the total unchanged.
    'chosen_24h',   (SELECT count(*) FROM recent WHERE old_language IS NULL)
                  - (SELECT count(*) FROM recent WHERE new_language IS NULL),
    'by_lang',      (SELECT coalesce(json_agg(json_build_object('lang', lang, 'users', users, 'd1', d1)
                                              ORDER BY users DESC, lang), '[]'::json)
                       FROM per_lang)
  ) INTO result;
  RETURN result;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.admin_language_stats() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_language_stats() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
