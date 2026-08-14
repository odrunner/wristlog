-- Audit R4: give broadcast_queue an attempt counter.
--
-- The drain deliberately distrusts a batch the moment any row reports a
-- non-retryable error: resolveBatchOutcome() folds every "permanent" verdict back
-- into `pending` rather than writing `failed`, because a bad key or a paused
-- provider makes every verdict in that batch untrustworthy. That protection is
-- correct and stays.
--
-- Its cost is that a genuinely dead address inside a tripped batch returns to
-- `pending` forever, re-tripping the same batch on every future drain and holding a
-- budget slot indefinitely. With a counter, a row individually judged permanently
-- undeliverable on 3 SEPARATE drains is retired — at that point the evidence is
-- about the address, not the transport.
ALTER TABLE public.broadcast_queue
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.broadcast_queue.attempts IS
  'Times this row was individually judged permanently undeliverable. At '
  'MAX_DELIVERY_ATTEMPTS the drain retires it to status=failed instead of '
  'retrying forever. See audit-results/2026-08-13-reliability-audit.md R4.';
