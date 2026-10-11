-- 2026-10-10 — Direct Apple rating prompt
-- The "Enjoying WRotate?" gate is gone: maybeShowReviewPrompt now calls the
-- native requestReview directly and logs a single 'requested' event. Allow it
-- in the event check; old values stay valid for history.
-- Apply with: npx supabase db query --linked --file sql/2026-10-10-review-prompt-direct.sql

ALTER TABLE public.review_prompt_events
  DROP CONSTRAINT review_prompt_events_event_check;

ALTER TABLE public.review_prompt_events
  ADD CONSTRAINT review_prompt_events_event_check
  CHECK (event = ANY (ARRAY[
    'shown', 'yes', 'yes_native', 'yes_web',
    'no', 'no_with_text', 'no_no_text', 'dismissed',
    'requested'
  ]));
