-- Author-selected promo card treatments.
-- Spec: docs/superpowers/specs/2026-08-07-promo-card-variants-design.md
--
-- Two new per-slot columns. Both default to the CLASSIC card that every
-- existing row already renders as, so applying this migration changes nothing
-- that is currently in a user's feed — the new treatments only appear on slots
-- an admin deliberately switches over.
--   variant: classic | tag  (caseback tag)   | band (full-bleed band)
--   size:    prompt  | nudge

alter table public.promo_slots
  add column if not exists variant text not null default 'classic',
  add column if not exists size    text not null default 'prompt';

-- Drop-then-add rather than "if not exists" (which ADD CONSTRAINT does not
-- support) so re-running the file is idempotent.
alter table public.promo_slots drop constraint if exists promo_slots_variant_check;
alter table public.promo_slots add  constraint promo_slots_variant_check
  check (variant in ('classic', 'tag', 'band'));

alter table public.promo_slots drop constraint if exists promo_slots_size_check;
alter table public.promo_slots add  constraint promo_slots_size_check
  check (size in ('prompt', 'nudge'));

notify pgrst, 'reload schema';
