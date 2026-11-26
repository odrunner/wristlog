-- 2026-11-26 — Four onboarding emails rewritten to the features members use
-- (usage review docs/usage-review-2026-11-26.md, E5; approved by the user "build 5").
--
-- Days 5, 12, 14 and 21 promoted share links (1 member used one in 30 days), the What-if
-- simulator (11), the Ranking Game (16 ever) and the wishlist (10 adds). They now cover
-- value check (100 members in 30 days), the member's own model page (Watches database,
-- 174), Enhance (103) and adding a watch from a photo (97).
--
-- Updated IN PLACE, keyed by campaign name: email_campaign_sends is per campaign id, so a
-- member who already had the old day-N email is not sent the new one, and nothing is
-- backfilled. email_campaigns.translations refreshes itself (its `src` fingerprint no
-- longer matches the English). Stats: the admin table groups by msg_key drip_d<day>, so
-- each of these four rows continues the old email's counts from today on - compare by date.
-- Subjects are mirrored in CAMPAIGN_ONBOARDING (index.html + wrotate_test.js).
-- Day 14 widens from two-watch owners to anyone with a watch; day 21 drops its
-- skip-if-has-wishlist rule (it is no longer about the wishlist).

update public.email_campaigns set
  name = 'Onboarding — Value check',
  subject = 'What are your watches worth today?',
  require_state = 'has_watch', skip_if_done = null, cta_action = 'open_collection',
  body_html = $b$Hi {{name}},<br><br>You know what you paid. Here is how to see what your watches are worth now.<br><br><b>Check one watch.</b> Open any watch in your collection and tap <b>Check Value</b> for an AI-based estimate of its current market price.<br><br><b>Or check them all.</b> The <b>$</b> button in the Collection header updates every watch in one go.<br><br><b>See it move.</b> Each check is saved, so over time you can see how the value of a watch, and of the whole collection, changes. If you know better, you can type a value in yourself.<br><br>These are estimates, a guide and not an appraisal.<br><br>Tap below to open your collection.<br><br>The WRotate team$b$,
  updated_at = now()
where name = 'Onboarding — Share your collection' and is_active;

update public.email_campaigns set
  name = 'Onboarding — Your model page',
  subject = 'Look up your own watch',
  require_state = 'has_watch', skip_if_done = null, cta_action = 'open_discover',
  body_html = $b$Hi {{name}},<br><br>The watch you own has a page in WRotate, and it is worth a look.<br><br>Open the <b>Watches</b> tab and search for your model by name or reference. Its page has photos, the model's history, the specs, fun facts, and wrist shots from other members who own one.<br><br><img src="https://wrotate.com/email-assets/search-watches.png" alt="Searching for Speedmaster — three models, each with the number of members who own one" width="380" style="max-width:100%;border-radius:10px;border:1px solid #eee;"><br><br><b>Many brands have a page too.</b> The brand's story, the models members own, and how members' watches from that brand actually run when measured. It is a quick way to see whether your own reading is typical.<br><br>Tap below to look yours up.<br><br>The WRotate team$b$,
  updated_at = now()
where name = 'Onboarding — What-if and AI Picks' and is_active;

update public.email_campaigns set
  name = 'Onboarding — Enhance',
  subject = 'Let us fill in the details of your watches',
  require_state = 'has_watch', skip_if_done = null, cta_action = 'open_collection',
  body_html = $b$Hi {{name}},<br><br>Adding a watch takes a brand and a name. The rest we can fill in for you.<br><br><b>One watch.</b> Open any watch and tap <b>Enhance</b>. We fill in the specs, dimensions, caliber and a short history of the model.<br><br><b>Or all of them.</b> The <b>Enhance</b> button in your Collection header does every watch in one go.<br><br>You review the result for each watch before anything is saved, so nothing changes without your say.<br><br>Tap below to open your collection.<br><br>The WRotate team$b$,
  updated_at = now()
where name = 'Onboarding 4 — Straps & Ranking Game' and is_active;

update public.email_campaigns set
  name = 'Onboarding — Add from a photo',
  subject = 'Add a watch with one photo',
  require_state = null, skip_if_done = null, cta_action = 'open_collection',
  body_html = $b$Hi {{name}},<br><br>There is a faster way to add a watch than typing it in.<br><br><b>Take a photo.</b> On the Collection tab, tap <b>Add from Photo</b>. We identify the watch and fill in the brand, model and reference for you to check and save.<br><br><b>Several at once.</b> Lay a few watches out together and take one picture. Each one is identified and listed, ready to review.<br><br>It works for the watch on your wrist today, and for the ones in the box you have not added yet.<br><br>Tap below to open your collection.<br><br>The WRotate team$b$,
  updated_at = now()
where name = 'Onboarding 5 — Wishlist' and is_active;

-- Metric for the push_ask_repeat experiment (client writes feature_events 'push_turned_on'
-- once per device when delivery goes from quiet to real notifications).
insert into public.experiment_metrics (key, label, kind, source, sort)
values ('push_turned_on', 'Turned on real notifications', 'rate', 'feature_events:push_turned_on', 56)
on conflict (key) do nothing;

-- The two client experiments, as drafts at 50%. Press Start in Admin -> Experiments after
-- the page is deployed; until then experiment() is false for everyone.
insert into public.experiments (key, name, hypothesis, status, rollout_pct, metric_key, min_lift_pct,
                                min_users_per_arm, min_days, guardrail_metric_key, max_guardrail_drop_pct, owner)
values
 ('push_ask_repeat', 'Notification ask: repeat, and tie it to the reading',
  'Members on quiet notifications act on 2% of reminders against 52% with real ones, and the one-time ask card is accepted by 6%. Showing the card up to three times, 14 days apart, with copy about re-measure reminders right after a kept reading, raises the share who turn real notifications on. Guardrail: wear logs.',
  'draft', 50, 'push_turned_on', 10, 50, 14, 'log_created', 5, 'sql'),
 ('msr_retry_coach', 'Measurement coach on the first failed run',
  'Only 54% of first-ever sessions give a reading, and members with none in their first two days return at 26% against 66%. Showing numbered retry steps after the first failed run (not the second), and also after a weak or lost signal, raises the share who keep a reading. Guardrail: seen again 7+ days later.',
  'draft', 50, 'accuracy_reading_saved', 10, 50, 7, 'd7_retained', 5, 'sql')
on conflict (key) do nothing;
