-- watch-value: keep the last answer per watch for a few minutes, so a client
-- whose connection dropped can re-ask without a second paid lookup.
--
-- 2026-11-16 03:25 UTC: a 10-watch "Update Market Prices" run showed "Error"
-- on 8 rows. The function had priced all 10 (every call logged 200); the page
-- left the foreground for ~30s and iOS dropped the answers in flight. Nothing
-- was kept server-side, so those lookups were paid for and lost.
--
-- One row per (user, watch), overwritten by each new lookup, so the table can
-- never hold more rows than there are watches. Read and written only by the
-- watch-value edge function (service role); the function ignores a row older
-- than 15 minutes or one whose query differs from the retry's.

CREATE TABLE IF NOT EXISTS public.watch_value_recent (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  watch_id   text        NOT NULL,
  query      jsonb       NOT NULL,
  result     jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, watch_id)
);

ALTER TABLE public.watch_value_recent ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: nothing but the service role reads or writes it.

GRANT SELECT, INSERT, UPDATE ON public.watch_value_recent TO service_role;
