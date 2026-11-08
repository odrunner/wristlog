-- wn_badge experiment seeding (usability P5, 2026-11-08). Applied to
-- production 2026-11-08 via the Supabase connector.
--
-- The metric row makes "Opened What's New" selectable in Admin -> Experiments
-- (source 'feature_events:whats_new_opened' needs no CASE branch in
-- experiment_user_metric; the client logs the event in openWhatsNew()).
-- The experiment row is the draft the admin form would have created; it ships
-- dark until started in Admin -> Experiments.
INSERT INTO experiment_metrics (key, label, kind, source, sort) VALUES
  ('whats_new_opened', 'Opened What''s New', 'rate', 'feature_events:whats_new_opened', 60)
ON CONFLICT (key) DO NOTHING;

INSERT INTO experiments (key, name, hypothesis, metric_key, status, rollout_pct)
VALUES (
  'wn_badge',
  'What''s New unread dot',
  'A quiet unread dot on the header help button when What''s New changed makes returning users discover new features (dot clears on open).',
  'whats_new_opened',
  'draft',
  20
)
ON CONFLICT (key) DO NOTHING;
