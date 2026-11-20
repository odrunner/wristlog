-- Promo slots: optional thumbs up / down on a classic card.
-- The month-in-review card has always asked "What do you think of this
-- feature?"; this lets an authored feature announcement ask the same thing.
-- Votes are the existing promo_events 'thumbs_up' / 'thumbs_down' rows, so
-- admin_promo_stats already counts them. Off for every existing slot.
ALTER TABLE public.promo_slots
  ADD COLUMN IF NOT EXISTS ask_vote boolean NOT NULL DEFAULT false;
