-- "Your Month in Review" — a fourth promo card treatment.
-- Spec: docs/superpowers/specs/2026-08-07-month-in-review-promo-design.md
--
-- No new columns: a recap slot is an ordinary promo_slots row whose renderer
-- ignores heading/body/image_url and builds its slides from the VIEWER's own
-- wear log. Only the variant CHECK has to learn the new value.
--
-- Drop-then-add rather than "if not exists" (which ADD CONSTRAINT does not
-- support) so re-running the file is idempotent — same shape as
-- sql/2026-08-07-promo-card-variants.sql, which this supersedes.

alter table public.promo_slots drop constraint if exists promo_slots_variant_check;
alter table public.promo_slots add  constraint promo_slots_variant_check
  check (variant in ('classic', 'tag', 'band', 'recap'));

notify pgrst, 'reload schema';
