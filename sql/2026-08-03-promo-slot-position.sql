-- Per-slot override for where a promo card lands in the feed. Falls back to
-- promo_config.first_position when null — same override pattern as
-- promo_slots.max_impressions (nullable, no default, config supplies the
-- fallback in application code).
-- Purely additive: no existing column altered or dropped, no row data touched.

alter table public.promo_slots add column if not exists first_position int;

notify pgrst, 'reload schema';
