-- The model page's spec values and reference notes in every app language.
--
-- watch_models.translations already holds the story per language
-- ({"es": {"description": "...", "history": "..."}}, sql/2026-11-13-model-translations.sql).
-- The translate-facts job now also fills, in the same entry:
--   "specs":     {"materials": "...", "movement": "..."}  the spec values that are words
--                                                         ("40mm", "200m (660 ft)" are never sent)
--   "ref_notes": ["...", null, "..."]                     the note of each refs_by_era item,
--                                                         same length and order as refs_by_era
--   "extras":    1                                        marker: this language's specs + notes are done
-- The job finds its work by the missing marker, so the 367 models whose story is
-- already translated are picked up again for these two parts only (six models a
-- run, on runs with no fun fact waiting; about three hours for the backlog).
--
-- No new table or column, so no grants: `translations` is read like the rest of
-- the row and written by the job with the service role.
--
-- ref_notes go by position, so they must never outlive the English they were
-- made from. This trigger is what guarantees it: any change to specs or
-- refs_by_era removes the three keys above from every language in the same
-- UPDATE (the story stays, it did not change); a change to the story still
-- clears everything, as before. Both writers are covered: Enrich
-- (admin_set_model_enrichment) and the wiki/curate update of specs.
CREATE OR REPLACE FUNCTION public.watch_models_reset_translations()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description OR NEW.history IS DISTINCT FROM OLD.history THEN
    NEW.translations := '{}'::jsonb;
    NEW.translate_attempts := 0;
  ELSIF NEW.specs IS DISTINCT FROM OLD.specs OR NEW.refs_by_era IS DISTINCT FROM OLD.refs_by_era THEN
    NEW.translations := COALESCE((
      SELECT jsonb_object_agg(e.key,
        CASE WHEN jsonb_typeof(e.value) = 'object' THEN e.value - 'specs' - 'ref_notes' - 'extras' ELSE e.value END)
      FROM jsonb_each(NEW.translations) AS e), '{}'::jsonb);
    NEW.translate_attempts := 0;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS watch_models_reset_translations ON public.watch_models;
CREATE TRIGGER watch_models_reset_translations
  BEFORE UPDATE OF description, history, specs, refs_by_era ON public.watch_models
  FOR EACH ROW EXECUTE FUNCTION public.watch_models_reset_translations();

-- No function signature or column changed, so PostgREST has nothing to reload.
