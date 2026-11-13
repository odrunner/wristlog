-- Fun facts in every app language.
--
-- A fact is one row per watch model, shown to everyone, so until now it was in
-- English for every reader. `translations` holds the other languages as
-- {"es": "...", "it": "...", ...}; the client shows the reader's language when
-- it is there and the English otherwise.
--
-- Filled automatically by the translate-facts edge function (pg_cron, every
-- five minutes): it takes facts that are missing a language, asks the model,
-- and stores only answers that pass _shared/translate-lib.ts. The same job
-- translates the backlog and every fact generated from now on. A fact that
-- keeps failing is left alone after three tries (translate_attempts).
ALTER TABLE public.watch_facts ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.watch_facts ADD COLUMN IF NOT EXISTS translate_attempts integer NOT NULL DEFAULT 0;

-- Editing the English throws its translations away, so they are made again.
CREATE OR REPLACE FUNCTION public.watch_facts_reset_translations()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.fact IS DISTINCT FROM OLD.fact THEN
    NEW.translations := '{}'::jsonb;
    NEW.translate_attempts := 0;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS watch_facts_reset_translations ON public.watch_facts;
CREATE TRIGGER watch_facts_reset_translations
  BEFORE UPDATE OF fact ON public.watch_facts
  FOR EACH ROW EXECUTE FUNCTION public.watch_facts_reset_translations();

-- The job's work list: oldest facts still missing a language.
CREATE INDEX IF NOT EXISTS watch_facts_untranslated_idx ON public.watch_facts (created_at)
  WHERE NOT (translations ?& ARRAY['es','it','fr','tr','de','pt']) AND translate_attempts < 3;

-- Readable like `fact` is. watch_facts is an existing table, so its table-level
-- grants already cover a new column; nothing to add.
NOTIFY pgrst, 'reload schema';

-- The job. Every three minutes; a run with nothing to do costs one count query.
SELECT cron.unschedule('translate-facts') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'translate-facts');
SELECT cron.schedule('translate-facts', '*/3 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/translate-facts',
    headers := jsonb_build_object('Content-Type','application/json','x-campaign-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'campaign_trigger_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000) AS request_id;
$cron$);
