-- Review-prompt timing experiment (2026-11-01, weekly growth proposal #1).
-- Ratings were flat (33 → 35) across a ~130-signup fortnight: the native rating
-- sheet only fires after the FIFTH converged measurement, which most of the ad
-- cohort never reaches. Treatment asks on the FIRST good converged measurement
-- (|rate| <= 15 s/day — the delight moment); control keeps the >=5 gate.
-- Client branch: experiment('review_first_good_msr') in shouldShowReviewPrompt.
-- Guardrail: accuracy_reading_saved — if the earlier ask interrupts people out
-- of saving readings, the nightly judge kills it.

-- 1. Target metric: did the user trigger a native rating request after
--    assignment? (review_prompt_events.event = 'requested'; control users
--    reaching the 5th measurement count too — that is the comparison.)
INSERT INTO experiment_metrics (key, label, kind, source, sort) VALUES
  ('review_requested', 'Asked for an App Store rating', 'rate', 'table:review_prompt_events', 55)
ON CONFLICT (key) DO NOTHING;

-- 2. Evaluator branch for the new table source (full replace; only the
--    'table:review_prompt_events' WHEN is new vs 2026-08-28-experiments.sql).
CREATE OR REPLACE FUNCTION experiment_user_metric(p_metric text, p_user uuid, p_since timestamptz)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  m experiment_metrics;
  n numeric;
BEGIN
  SELECT * INTO m FROM experiment_metrics WHERE key = p_metric;
  IF m.key IS NULL THEN RAISE EXCEPTION 'unknown metric %', p_metric; END IF;

  IF m.source LIKE 'feature_events:%' THEN
    SELECT count(*) INTO n FROM feature_events
     WHERE user_id = p_user AND event = substr(m.source, 16) AND created_at >= p_since;
  ELSE
    CASE m.source
      WHEN 'table:logs' THEN
        SELECT count(*) INTO n FROM logs WHERE user_id = p_user AND created_at >= p_since;
      WHEN 'table:watches' THEN
        SELECT count(*) INTO n FROM watches WHERE user_id = p_user AND created_at >= p_since;
      WHEN 'table:timegrapher_results' THEN
        SELECT count(*) INTO n FROM timegrapher_results WHERE user_id = p_user AND created_at >= p_since;
      WHEN 'table:review_prompt_events' THEN
        SELECT count(*) INTO n FROM review_prompt_events
         WHERE user_id = p_user AND event = 'requested' AND created_at >= p_since;
      WHEN 'table:user_activity_days' THEN
        IF m.key = 'd7_retained' THEN
          IF p_since > now() - interval '7 days' THEN
            RETURN NULL;   -- not yet eligible for the 7-day window
          END IF;
          SELECT count(*) INTO n FROM user_activity_days
           WHERE user_id = p_user AND day >= (p_since + interval '7 days')::date;
        ELSE
          SELECT count(*) INTO n FROM user_activity_days
           WHERE user_id = p_user AND day > p_since::date;   -- exclude the assignment day itself
        END IF;
      ELSE RAISE EXCEPTION 'metric % has no evaluator branch for source %', p_metric, m.source;
    END CASE;
  END IF;
  IF m.kind = 'rate' THEN RETURN CASE WHEN n > 0 THEN 1 ELSE 0 END; END IF;
  RETURN n;
END;
$$;

-- 3. The experiment, started at 50/50 (same split as msr_verdict_line — same
--    surface, and request volume is ~80/3wk so 20% would starve the arms).
INSERT INTO experiments (key, name, hypothesis, status, rollout_pct, metric_key,
                         guardrail_metric_key, started_at, owner)
VALUES ('review_first_good_msr',
        'Review ask on first good measurement',
        'Asking for a rating right after the first good converged measurement (|rate| <= 15 s/day) instead of after the fifth measurement reaches users at the delight moment and raises rating requests without hurting measurement saves.',
        'running', 50, 'review_requested', 'accuracy_reading_saved', now(), 'sql')
ON CONFLICT (key) DO NOTHING;
