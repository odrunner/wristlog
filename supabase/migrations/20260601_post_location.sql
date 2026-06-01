-- Optional location on posts (presets Home/Work/Travel or free text).
-- Spec: docs/superpowers/specs/2026-06-01-post-location-design.md
--
-- logs uses explicit per-column grants (not table-wide), so a new column has
-- NO privilege by default and the post upsert/read would fail. Grant it.

ALTER TABLE public.logs ADD COLUMN IF NOT EXISTS location text;

GRANT SELECT, INSERT, UPDATE (location) ON public.logs TO authenticated;
-- Anonymous landing feed renders public posts, so it needs to read the column.
GRANT SELECT (location) ON public.logs TO anon;
