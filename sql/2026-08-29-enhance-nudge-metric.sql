-- A/B experiment `enhance_nudge` target metric.
-- feature_events:<event> metrics need no change to experiment_user_metric() —
-- the generic feature_events branch reads the event name out of `source`.
INSERT INTO experiment_metrics (key, label, kind, source, sort)
VALUES ('enhance_run', 'Ran Enhance', 'rate', 'feature_events:enhance_run', 35)
ON CONFLICT (key) DO NOTHING;
