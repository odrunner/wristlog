-- 2026-10-17 — Onboarding drip expansion (approved by the user 2026-10-17).
-- Context: signups ~4x since the no-demo landing change (e7056d54, 2026-10-15),
-- but the drip is behavior-skipped and most new users do the actions on day 0,
-- so a fully-activated signup received nothing between day 3 and day 14 — the
-- window where retention falls off (43% active after d1 → 28% after d7).
--
-- Three changes, all feature-awareness emails with no skip gate:
--   Day 2  — revive "Welcome — 3 things to try", rewritten. Old items 1+2
--            duplicated the day-1 and day-7 drips (and most users had already
--            done them); new trio = market value, the feed, measure.
--   Day 5  — share-your-collection link, trimmed from the 2026-08-28 broadcast
--            (its best-opened feature send, 49%). New subject so Traffic →
--            By Campaign doesn't merge it with the old broadcast's stats.
--   Day 10 — What-if simulator + AI Picks, from the unsent admin draft,
--            screenshots inlined (verified live on storage 2026-10-17).
--
-- Drip schedule after this: 1, 2, 3, 5, 7, 10, 14, 21.
-- The Traffic → By Campaign onboarding list in index.html mirrors these
-- subjects in send order — update CAMPAIGN_ONBOARDING when subjects change.

UPDATE email_campaigns SET
  subject = '3 things you can do with WRotate',
  delay_days = 2,
  skip_if_done = NULL,
  is_active = true,
  is_archived = false,
  updated_at = now(),
  body_html = 'Hi {{name}},<br><br>Welcome to WRotate! Three things worth trying this week:<br><br><b>1. See what your watches are worth</b><br>Open any watch and tap <b>Check price</b> for an AI market estimate — or the <b>$</b> button in your collection header to price everything at once. Values are kept over time, so you can see which way your collection is moving.<br><br><b>2. See what everyone else is wearing</b><br>The feed shows what other collectors have on their wrist today. Post your own wrist shot and choose who sees it — everyone, your followers, or just you.<br><br><b>3. Measure your watch''s accuracy</b><br>In the WRotate iOS app, open the <b>Measure</b> tab and place your watch near your phone''s microphone. You''ll get a rate reading in about 30 seconds — no extra equipment needed.<br><br>Questions or ideas? Just reply to this email.'
WHERE id = 'f10da233-2c90-4e20-ad2a-a663b567c122';

INSERT INTO email_campaigns (name, delay_days, subject, body_html, is_active, skip_if_done, backfill_daily)
VALUES
(
  'Onboarding — Share your collection',
  5,
  'Show your collection with one link',
  'Hi {{name}},<br><br>Until now, the only way to show someone your watches was to hand over your phone. WRotate gives you a better way.<br><br><b>Share your collection with a link.</b> Tap <b>Share</b> on the Collection tab and tick the watches you want to show — a few for a dealer, the whole lot for an insurer, your favourites for a friend. You get a unique link with the photo, brand, model and reference of each watch. What you paid, market values, wears, notes and tags stay private. The person you send it to needs no account, and you can revoke any link whenever you like.<br><br><b>See it as a wall of photos.</b> The toggle in the Collection header switches from full cards to an <b>images-only gallery</b>. It follows your sort and tag filters, and it''s the closest thing to laying every watch out on a table.<br><br><b>They can talk back.</b> Anyone with one of your links can leave a comment with their name. You''ll see it in the app, and you can remove it or pull the link.<br><br>Tap below to try it.',
  true,
  NULL,
  0
),
(
  'Onboarding — What-if and AI Picks',
  10,
  'What if you sold two to fund the grail?',
  'Hi {{name}},<br><br>Every collector plays the same game on the commute home: if the grail finally came in, what would go? Two pieces out, one in — is the collection better, or just different?<br><br>You can stop playing it in your head. Open your <b>Collection</b> tab and tap <b>What-if</b>: mark watches for sale, pull in watches from your wishlist, and the count and value move against your real collection as you go. It''s a sandbox — nothing changes for real, and your scenario is kept for next time.<br><br><img src="https://api.wrotate.com/storage/v1/object/public/media/broadcast/whatif-sim-2026-09.png" alt="The What-if simulator — sell one, add one, read the numbers" width="380" style="max-width:100%;border-radius:10px;border:1px solid #eee;"><br><br>And you don''t have to guess what to try. Tap <b>AI Picks</b> on your <b>Wishlist</b> and we read your collection and what you actually wear — the style gaps, the sizes you reach for, the prices that make sense — then rank your wishlist with a plain one-line reason for each pick. It''s honest, too: when a wishlist watch mostly overlaps with something you already own, it says so instead of flattering you.<br><br><img src="https://api.wrotate.com/storage/v1/object/public/media/broadcast/ai-picks-wishlist-2026-09.png" alt="AI Picks on the wishlist — ranked, priced, a reason for each" width="380" style="max-width:100%;border-radius:10px;border:1px solid #eee;"><br><br>The same picks appear inside the simulator, where one tap drops a watch straight into your scenario. Sell two, add the pick, read the numbers. Then sleep on it.<br><br>The WRotate team',
  true,
  NULL,
  0
);
