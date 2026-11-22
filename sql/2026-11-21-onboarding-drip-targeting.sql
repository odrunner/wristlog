-- 2026-11-21 — Onboarding drip: send each email only to members who can use it
-- (approved by the user 2026-11-21, "go B").
--
-- Why (60 days of sends, internal accounts excluded): the drip was a feature
-- tour on a fixed calendar. 92 of 219 "share your collection" emails went to
-- members with no watches and none of the 219 made a link; 146 of 206
-- strap/ranking emails went to members with fewer than two watches; a new
-- member got 5.4 drips in three weeks with days 1, 2 and 3 back to back, and
-- 21 of 187 turned update emails off. Meanwhile 62% of new members try
-- measuring, which had one two-sentence email.
--
-- What changes:
--   1. email_campaigns.require_state — who a campaign is FOR (the counterpart
--      of skip_if_done). Keys live in run-campaign/lib.ts KNOWN_REQUIRES:
--      has_watch, has_two_watches, no_watch, has_measurement. NULL = anyone.
--      An unknown key sends to nobody.
--   2. Schedule 1, 2, 3, 5, 7, 10, 14, 21  ->  1, 3, 4, 5, 6, 7, 9, 12, 14, 21,
--      but no member is in the audience of all ten:
--        did nothing            1, 3, 6, 7, 21          (was 8 emails)
--        watch + log + reading  1, 5, 9, 12, 14*, 21    (* two or more watches)
--   3. Welcome says "iPhone or Android" (it said "iOS app"); the measure email
--      is rewritten; two new emails (Watches database, Accuracy Overview).
--
-- Every drip keeps a distinct delay_days: two campaigns on one day would have
-- the cross-campaign dedup in run-campaign drop the second for good, and would
-- share one drip_d<day> stats row.
-- The Traffic -> By Campaign onboarding list (CAMPAIGN_ONBOARDING +
-- CAMPAIGN_DRIP_DAYS in index.html and wrotate_test.js) mirrors this order.
-- Translations refresh on their own: the cached copy carries a fingerprint of
-- the English, so an edited body is re-translated on the next run.

ALTER TABLE public.email_campaigns ADD COLUMN IF NOT EXISTS require_state text;

-- Day 1 (was 2) — Welcome. Only the measure paragraph changes.
UPDATE public.email_campaigns SET
  delay_days = 1,
  updated_at = now(),
  body_html = $body$Hi {{name}},<br><br>Welcome to WRotate! Three things worth trying this week:<br><br><b>1. See what your watches are worth</b><br>Open any watch and tap <b>Check price</b> for an AI market estimate — or the <b>$</b> button in your collection header to price everything at once. Values are kept over time, so you can see which way your collection is moving.<br><br><b>2. See what everyone else is wearing</b><br>The feed shows what other collectors have on their wrist today. Post your own wrist shot and choose who sees it — everyone, your followers, or just you.<br><br><b>3. Measure your watch's accuracy</b><br>In the WRotate app for iPhone or Android, open the <b>Measure</b> tab and place your watch against your phone's microphone. You'll get a rate reading in about 30 seconds — no extra equipment needed.<br><br>Questions or ideas? Just reply to this email.$body$
WHERE id = 'f10da233-2c90-4e20-ad2a-a663b567c122';

-- Day 3 (was 1) — Add your first watch. Copy unchanged; still skipped for
-- anyone who has a watch.
UPDATE public.email_campaigns SET delay_days = 3, updated_at = now()
WHERE id = 'a145b201-0161-458f-8547-4dfe7aaf3707';

-- Day 4 (was 3) — Fun fact / log a wear. Now only for members who own a watch
-- (106 of 178 recipients had none and got the generic fallback fact).
UPDATE public.email_campaigns SET delay_days = 4, require_state = 'has_watch', updated_at = now()
WHERE id = '14a9156c-f132-435c-9beb-32800b8c97cb';

-- Day 5 — Share your collection. Needs a collection.
UPDATE public.email_campaigns SET require_state = 'has_watch', updated_at = now()
WHERE id = '5e2ae6d0-0334-4df5-a8b9-84156c3c72ef';

-- Day 7 — Measure, rewritten. Still skipped for anyone with a kept reading.
UPDATE public.email_campaigns SET
  updated_at = now(),
  body_html = $body$Hi {{name}},<br><br>WRotate has a timegrapher built in, and it needs nothing but your phone.<br><br><b>1. Open the Measure tab</b> in the WRotate app, on iPhone or Android.<br><br><b>2. Rest the watch against your phone's microphone</b> — usually on the bottom edge — with the caseback facing the mic, and keep it still.<br><br><b>3. Tap Measure.</b> A first rate appears within seconds and settles in about 30 seconds.<br><br>The result is your watch's rate in seconds per day: how fast or slow it is running. Keep the reading and it is saved to that watch, so the next one shows whether it is holding steady or drifting.<br><br>Tap below to measure your watch.$body$
WHERE id = 'adbb64f7-2338-455f-843a-b7898bcecedc';

-- Day 12 (was 10) — What-if and AI Picks. Needs a collection; moved off day 10
-- so it does not land the day after the new day-9 email.
UPDATE public.email_campaigns SET delay_days = 12, require_state = 'has_watch', updated_at = now()
WHERE id = 'af2ca704-7039-4623-9748-b0229eaec053';

-- Day 14 — Straps and the Ranking Game. A head-to-head needs two watches.
UPDATE public.email_campaigns SET require_state = 'has_two_watches', updated_at = now()
WHERE id = '27f3ab45-5e67-46d6-a670-c63c3975b89d';

-- Day 21 — Wishlist: unchanged (needs no collection; skipped if they keep one).

-- Two new emails.
INSERT INTO public.email_campaigns (name, delay_days, subject, body_html, is_active, skip_if_done, require_state, backfill_daily)
SELECT v.name, v.delay_days, v.subject, v.body_html, true, NULL, v.require_state, 0
FROM (VALUES
(
  'Onboarding — Watches database',
  6,
  'Look up any watch',
  $body$Hi {{name}},<br><br>You don't need a collection in WRotate to get something out of it. The <b>Watches</b> tab is a database you can browse on its own.<br><br><b>Search any model.</b> Type a name or a reference — Speedmaster, SKX, Datejust — or filter by brand.<br><br><img src="https://wrotate.com/email-assets/search-watches.png" alt="Searching for Speedmaster — three models, each with the number of members who own one" width="380" style="max-width:100%;border-radius:10px;border:1px solid #eee;"><br><br><b>Every model has a page.</b> Photos, its history, fun facts, the specs, and wrist shots from the members who own one.<br><br><b>So do many brands.</b> The brand's story, the models members own, and how members' watches from that brand actually run when measured.<br><br>Found one you want? Add it to your wishlist from its page. Already own it? Add it to your collection and we fill in the details for you.<br><br>Tap below to look one up.$body$,
  'no_watch'
),
(
  'Onboarding — Accuracy Overview',
  9,
  'See how every watch you own is running',
  $body$Hi {{name}},<br><br>You've measured a watch. Here is where the readings go next.<br><br><b>Accuracy Overview</b> puts your whole collection on one screen. Tap the trend icon on the Measure page: every watch shows its latest reading on the same scale, so you can see at a glance which ones run close and which have wandered. Sort by most accurate, most recent or name, and tap a watch for its full history.<br><br><img src="https://wrotate.com/email-assets/accuracy-overview-169.png" alt="Accuracy Overview — three watches, each with its latest rate on the same scale" width="380" style="max-width:100%;border-radius:10px;border:1px solid #eee;"><br><br>It gets more useful with every watch on it. A reading takes about 30 seconds: measure the ones you haven't done yet, and repeat one you measured a while ago to see whether it has held its rate.<br><br>The WRotate team$body$,
  'has_measurement'
)) AS v(name, delay_days, subject, body_html, require_state)
WHERE NOT EXISTS (SELECT 1 FROM public.email_campaigns c WHERE c.name = v.name);
