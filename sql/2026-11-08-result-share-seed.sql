-- result_share experiment seeding (growth #9, plan
-- docs/superpowers/plans/2026-11-08-share-result-cards.md). Applied to
-- production 2026-11-08 via the Supabase connector.
--
-- Treatment adds a "Share image" button to the post-measurement CTA: the same
-- renderMsrShareCard canvas the feed post attaches, pushed out through the
-- system share sheet with a https://wrotate.com/?utm_source=result_share link.
-- Metric counts feature_events 'result_share' (logged on a completed share,
-- download, or copy, with meta.how). Inbound attribution: page_visits
-- utm_source=result_share.
INSERT INTO experiment_metrics (key, label, kind, source, sort) VALUES
  ('result_share', 'Shared a result image', 'rate', 'feature_events:result_share', 70)
ON CONFLICT (key) DO NOTHING;

INSERT INTO experiments (key, name, hypothesis, metric_key, status, rollout_pct)
VALUES (
  'result_share',
  'External result share',
  'A Share image button on the post-measurement CTA (system share sheet, card image + wrotate.com link) creates an acquisition loop the feed post cannot.',
  'result_share',
  'draft',
  20
)
ON CONFLICT (key) DO NOTHING;
