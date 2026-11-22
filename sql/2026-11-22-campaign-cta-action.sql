-- 2026-11-22 — Onboarding emails: the button opens the screen the email is about
-- (weekly usability review 2026-11-22, P1; approved by the user "do A").
--
-- Every drip ended in the same "Open WRotate" button, and it always landed on
-- the Feed — also for "Tap below to measure your watch" and "Tap below to look
-- one up". email_campaigns.cta_action holds a key from the app's PROMO_ACTIONS
-- registry (index.html); run-campaign appends it to the button link as
-- &go=<key>; the page (and, from iOS 2.12 / Android 1.9, the native shells)
-- opens that screen. NULL = the Feed, exactly as before. A key the app does
-- not know is ignored, so an old app or a typo opens the Feed too.
-- Editable in Admin -> campaigns ("Button action").
--
-- No grants: email_campaigns already exists (its grants and admin-only RLS
-- are unchanged); this only adds a column.
alter table public.email_campaigns add column if not exists cta_action text;

alter table public.email_campaigns drop constraint if exists email_campaigns_cta_action_format;
alter table public.email_campaigns add constraint email_campaigns_cta_action_format
  check (cta_action is null or cta_action ~ '^[a-z_]{1,40}$');

-- The ten live drips. Welcome (day 1) stays on the Feed.
update public.email_campaigns set cta_action = v.action
from (values
  ('Onboarding 1 — Add a watch',              'open_collection'),  -- day 3,  "Tap below to add your first watch"
  ('Onboarding 2 — Start your streak',        'open_track'),       -- day 4,  logging a wear
  ('Onboarding — Share your collection',      'open_collection'),  -- day 5
  ('Onboarding — Watches database',           'open_discover'),    -- day 6,  "Tap below to look one up"
  ('Onboarding 3 — Measure',                  'open_measure'),     -- day 7,  "Tap below to measure your watch"
  ('Onboarding — Accuracy Overview',          'open_accuracy'),    -- day 9
  ('Onboarding — What-if and AI Picks',       'open_whatif'),      -- day 12
  ('Onboarding 4 — Straps & Ranking Game',    'open_collection'),  -- day 14, both live in the Collection header
  ('Onboarding 5 — Wishlist',                 'open_wishlist')     -- day 21
) as v(name, action)
where email_campaigns.name = v.name and email_campaigns.is_active;
