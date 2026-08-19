-- sql/2026-08-16-device-tokens-app-version.sql
-- 2.6+ registers its version with the token so senders can ship w.route only to builds
-- whose native switch can route it (older builds open the bell for unknown routes).
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS app_version text;
