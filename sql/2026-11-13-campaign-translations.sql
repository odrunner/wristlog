-- Onboarding drips in every app language, automatically.
--
-- email_campaigns.subject/body_html stay the single thing anyone edits (Admin ->
-- Campaigns). `translations` is a cache run-campaign fills by itself:
--   {"es": {"src": "<fingerprint of the English>", "subject": "...", "body_html": "..."}, ...}
-- When a drip is about to go to someone whose app language is not English,
-- run-campaign uses the stored translation if its `src` still matches the
-- current English, and otherwise translates it there and then and stores it
-- (_shared/translate.ts). So editing the English is the whole workflow: the
-- next send in each language re-translates. A failed translation sends English.
ALTER TABLE public.email_campaigns ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb;
NOTIFY pgrst, 'reload schema';
