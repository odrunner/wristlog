-- Broadcasts translate themselves at queue time.
--
-- send-broadcast translates a draft once per language its audience uses
-- (profiles.language, _shared/translate.ts) and stores each recipient's row
-- already in their language, as it always stored rows already rendered.
-- `lang` records which language a row is in, so the drain can add the
-- unsubscribe footer in the same one. NULL = English. `label` stays the English
-- subject, which is what the admin stats and the re-click guard key on.
ALTER TABLE public.broadcast_queue ADD COLUMN IF NOT EXISTS lang text;
NOTIFY pgrst, 'reload schema';
