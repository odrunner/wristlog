-- Wishlist ranking game: per-item Elo score, accumulates across sessions
-- (mirrors watches.elo_rating). Applied 2026-08-17.
ALTER TABLE public.wishlist ADD COLUMN IF NOT EXISTS elo_rating integer;
NOTIFY pgrst, 'reload schema';
