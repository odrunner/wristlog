-- Audit 2026-09-23 SEC-23-3 — stored XSS through feed-card fields.
-- logs.id is client-chosen TEXT and is interpolated raw into ~35 attributes and
-- inline handlers in index.html; logs.use_case is free text (custom occasions)
-- rendered in every feed card. Any signed-in user could insert a public log
-- whose id/use_case carried markup, executing in every viewer's session.
-- Client fix: index.html escapes use_case. These CHECKs are the authoritative
-- fix for ids (all clients generate UUIDs) and defence in depth for use_case.
-- Pre-check 2026-09-24: 0 of 3,808 logs, 0 watches, 0 wishlist rows violate;
-- max id length 36; all 18 distinct use_case values pass.

ALTER TABLE public.logs
  ADD CONSTRAINT logs_id_format CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$');
ALTER TABLE public.watches
  ADD CONSTRAINT watches_id_format CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$');
ALTER TABLE public.wishlist
  ADD CONSTRAINT wishlist_id_format CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$');
ALTER TABLE public.logs
  ADD CONSTRAINT logs_use_case_safe
  CHECK (use_case IS NULL OR (length(use_case) <= 60 AND use_case !~ '[<>"`]'));
