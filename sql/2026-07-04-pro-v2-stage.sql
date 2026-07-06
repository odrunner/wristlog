-- Pro V2 (tg core) rollout stage — the server-side gate controlled from the admin
-- portal dev-flags panel. Read by all clients (timegrapher_tuning is SELECT-open);
-- writable only by internal accounts. Stages: silent → beta → default.
-- Applied 2026-07-04 via supabase db query --linked.

ALTER TABLE timegrapher_tuning ADD COLUMN IF NOT EXISTS pro_v2_stage text NOT NULL DEFAULT 'silent';

DROP POLICY IF EXISTS tuning_update_internal ON timegrapher_tuning;
CREATE POLICY tuning_update_internal ON timegrapher_tuning FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = auth.uid()));
