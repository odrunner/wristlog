-- Onboarding 5 — Wishlist. Day 21, the fifth and last drip.
--
-- Why it exists: the wishlist is the least-discovered feature in the product.
-- 21 of 508 users have ever added an item, and only 2 of the 97 who joined in
-- the 30 days before this was written.
--
-- Why day 21: it extends the existing 1 / 3 / 7 / 14 ladder rather than
-- competing with the core loop (add a watch -> log a wear -> measure). Late
-- placement is safe here — the day-14 drip is the best performer of the four
-- (37.3% human open rate, vs 34.1% at day 7 and 29.2% at day 1), so engagement
-- has not decayed by the end of the sequence.
--
-- backfill_daily = 0 ON PURPOSE. Backfill would mail the ~400 users already
-- past day 21 — the same people the "We rebuilt the wishlist" broadcast covers,
-- which still had 426 rows held for review when this shipped. New signups only;
-- turn on backfill later, after that broadcast has drained, if it is wanted.
--
-- skip_if_done = 'has_wishlist' -> the `wishlist` table, added to KNOWN_SKIPS in
-- run-campaign/lib.ts. An unknown key maps to null (no skip) rather than
-- dropping the cohort, so the send is safe even if the function lags this row.
--
-- The body is the inner content only: buildHtmlEmail() wraps it in the branded
-- shell and appends the "Open WRotate" CTA (pointing at /open, never the bare
-- root) and the unsubscribe footer.

INSERT INTO email_campaigns (name, subject, body_html, campaign_type, delay_days, skip_if_done, backfill_daily, is_active, is_archived)
VALUES (
  'Onboarding 5 — Wishlist',
  'Which watch is next?',
  'Hi {{name}},<br><br>Every collector keeps a list somewhere — a note on your phone, a browser tab you never close, a screenshot you meant to come back to. WRotate has a proper home for it.<br><br><b>Add one in seconds.</b> Photograph a watch in a shop window, or share a screenshot straight from Photos, and we identify it and fill in the details — brand, model, reference, market price. No typing out reference numbers.<br><br><b>Then send it to someone.</b> Tick the watches you want and share a link. A partner hunting for a gift, a dealer sourcing your next piece. They need no account, and your prices and notes stay private. Revoke the link whenever you like.<br><br>The WRotate team',
  'drip',
  21,
  'has_wishlist',
  0,
  true,
  false
);
