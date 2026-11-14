-- The model page's story in every app language.
--
-- watch_models.description and .history are written once per model family, in
-- English, by the admin Enrich step (identify-watch mode:model). One row is read
-- by every member, so the prose was English for everyone. `translations` holds
-- the other languages as {"es": {"description": "...", "history": "..."}, ...};
-- the client shows the reader's language when it is there and the English
-- otherwise (index.html loadAndRenderModel).
--
-- Filled by the translate-facts edge function (pg_cron `translate-facts`, every
-- three minutes) once it has no fun facts left to do: a few models per run,
-- oldest first, only answers that pass _shared/translate-lib.ts. A model that
-- keeps failing is left alone after three tries (translate_attempts).
ALTER TABLE public.watch_models ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.watch_models ADD COLUMN IF NOT EXISTS translate_attempts integer NOT NULL DEFAULT 0;

-- Re-running Enrich (or an approved edit request) changes the English, so its
-- translations are thrown away and made again.
CREATE OR REPLACE FUNCTION public.watch_models_reset_translations()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description OR NEW.history IS DISTINCT FROM OLD.history THEN
    NEW.translations := '{}'::jsonb;
    NEW.translate_attempts := 0;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS watch_models_reset_translations ON public.watch_models;
CREATE TRIGGER watch_models_reset_translations
  BEFORE UPDATE OF description, history ON public.watch_models
  FOR EACH ROW EXECUTE FUNCTION public.watch_models_reset_translations();

-- Readable like `history` is. watch_models is an existing table, so its
-- table-level grants already cover the new columns; nothing to add. The job
-- writes with the service role. No new cron: translate-facts already runs.
NOTIFY pgrst, 'reload schema';
