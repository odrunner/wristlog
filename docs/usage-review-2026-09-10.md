# WRotate usage review — 2026-09-10

Fresh production numbers (internal accounts excluded via `internal_accounts`, headline query run twice for determinism), compared against the 15 Aug review (`docs/usage-review-2026-08-15.md`) and the 28 Jun snapshot (`WROTATE-FEATURES.md` §1A–1D). Then a scorecard of what shipped since 15 Aug, a per-feature most→least used table, competitive research (two web sweeps, ~140 fetches), and ranked proposals — each checked against what the app already has.

## 1. Headline movement

| Metric | 28 Jun | 15 Aug | 10 Sep | Read |
|---|---|---|---|---|
| Registered users | 364 | 515 | **599** | +16% in 26 days; signups 99/30d vs 96 prior — flat for 3 months, all direct (no UTM, no referrer) |
| Active 30d / 7d (app opens) | 98 / 48 | 137 / 65 | **158 / 74** | growing with the base |
| Wear-loggers 30d / logs 30d | 24 / — | 72 / 564 | **82 / 648** | 22% back-dated; weekly loggers flat at 30–37 since the week of 27 Jul |
| Measurers 30d / sessions | — | — | **131 / 2,726** | median **11 sessions** per measurer; 233 watches measured, 72 of them 10+ times |
| Readings kept 30d | — | 232 | **1,093** | auto-keep (16 Aug) — history now fills itself |
| Users who ever measured | 109 | 172 | **282** | 47% of all accounts |
| Wishlist users / items | 11 / 39 | 17 / 51 | 18 / 57 | **8 items in 26 days**; 0 wishlist links, 1 collection link (6 views), 0 link comments |
| Follows / users following anyone | 53 / — | 72 / 23 | **110 / 29** | +39 since 15 Aug — August (40) was the best month ever |
| Avatars / bios | 8 / 9 | 8 / 9 | 10 / 10 | Google-avatar import is broken (F4) |
| Likes / comments (all time) | 628 / 171 | 1,769 / 256 | 2,274 / 299 | |
| Value-check users ever / 30d | 94 | 146 / 51 | **177 / 63** | 40% of monthly actives |
| Users with a push token | — | 143 | **231** | provisional push (2.6) — but see F2 |
| Demo views 30d | — | 221 | 287 | vs 99 signups |
| Club posts | 0 | 0 | 0 | |

**Who the users are:** 155 of 158 monthly actives visit from an iPhone; 4 Android, ~10 desktop. 108 of 129 with a timezone are in the US. Median active user opens the app on **2 days** out of 30 (62 of 129 on one day only).

## 2. Scorecard — what shipped since 15 Aug and whether it moved anything

| Aug proposal | Shipped | Result |
|---|---|---|
| P1 push opt-in leak | 2.6 provisional push at sign-in + deferred full ask (16 Aug) | Reach doubled (34 → 68 users get the 5pm push). **Per-send conversion fell 32.6% → 22.8%.** Provisional recipients convert at **2.8%** (47 users, 465 sends), authorized at **62.9%** (15 users, 240 sends). Only 20 users are fully authorized; 67 provisional; 25 denied. |
| P2 second log easy | Named-watch reminder, one-tap "wearing it again?" banner after 5pm | Same-watch-as-yesterday share 24% → 22%: **no visible lift**. Median logs per logger still 1; 45 of 82 logged once. |
| P3 measurement onboarding | Not the placement guide. Shipped instead: auto-keep, accuracy history (65 users viewed, 219 opens via the hint card), re-measure push (21–60 d) | Accuracy history is the most-adopted new surface. **Re-measure push: 36 sent, 4 followed by any session, 0 on the reminded watch.** `position` still null on all 965 readings. |
| P4 value digest | Collection Value tile on Stats (16 Aug); digest parked | `value_digest_sends` is empty. Only 22 users have ≥2 price points, so "value over time" is flat for everyone else. |
| P5 wear-this-next | "Not worn in a while" chips (16 Aug) | **Worked.** Logs that revive a watch unworn ≥30 days: 5.2% → 12.2% of all logs. |
| P6 timegrapher without account | not done | Two more feedback rows since: "Remove requirement to register/login", "I only use the timegrapher. Stop the social bs." |
| P7 identify accept-rate | instrumented (17 Aug) | 265 outcomes: **74% accepted as-is, 14% edited, 11% rejected**. Better than the reviews suggested; multi-photo not needed now. |
| P8 social seed | Follow-from-bell + Google avatar default (16 Aug) | Follow-from-bell → best follow month ever (+40). **Avatar import never ran** (F4). |
| P9 freeze wishlist | not frozen — ranking game, drag-reorder, share links, link comments, two broadcasts | 8 items added, 0 links. Freeze it now. |
| P10 hide clubs / ranking | not done | Clubs 9 / 16 members / 0 posts; Ranking Game 13 users ever. |
| New: Month in Review card | shipped | 19 users eligible in Aug (≥5 wears, 2 watches) — all 19 saw it; 61 human views of shared cards, all from **one** sharer's link. |
| New: Watch database (Explore, model pages, Also owned by) | built, **admin-gated** | 61 curated models, 57 hero photos, 1,502 of 1,503 watches linked to a model. 0 external use by design. |
| New: enhance_nudge experiment | running at 50% | 127 assigned, p = 0.29 — not significant yet. |

## 3. Feature usage — most to least (30 days, base = 158 active users)

**Heavily used**
| Feature | Users 30d | Depth | Note |
|---|---|---|---|
| Timegrapher measure | **131** (83%) | 2,726 sessions, median 11/user | 57% converge; 79 users hit "user stopped", 63 "no ticks after recal", 60 "signal lost" — placement is still the failure mode |
| Add watch | 118 | 325 watches | 64 via AI identify (74% accepted as-is), 131 with a URL, 234 with a photo |
| Fun facts | 172 viewers, 45 clickers | 5,613 impressions | 631 of 647 logs carry one; 26% of viewers click |
| Wear log | 82 (52%) | 648 logs; median 1 | 45 once · 17 two–four · 3 five–nine · 17 ten+; top 5 users = 32% |
| Value check | 63 (40%) | 248 checks | 170 users have a market price; 22 have history |
| Accuracy history | 65 | 248 opens | 88% via the hint card on Measure |
| Enhance (AI specs) | 61 | 282 runs | experiment running |
| Public posting | 57 posters | 369 posts | top 5 posters = 49%; 26 users posted a photo; 13 measurement cards |
| Likes / comments | 18 likers · 12 commenters | 607 · 49 | top 3 likers = 56% of likes — the feed is 3–5 people |
| Reminders | push 69 users · email 52 | 799 · 86 sends | see F2 |
| Strap on a log | — | 86 of 647 logs (13%) | the 46 watches with straps do get logged with them |
| Follow | 29 ever follow anyone | +39 follows since 15 Aug | |

**Barely used**
| Feature | Evidence |
|---|---|
| Wishlist | 8 items in 26 days; 18 users total; wishlist Ranking Game shipped 17 Aug |
| Share links (wishlist / collection) + link comments | 0 · 1 (6 views) · 0 — after two broadcasts each opened by ~240 people |
| Month-in-Review sharing | 19 renders, 1 user's link viewed |
| Re-measure reminder | 36 sends → 0 same-watch re-measures |
| Manual timegrapher entry | 1 reading |
| Public profile / post pages (external) | 6 + 8 visits |
| @mentions | 0 in captions this month; 20 comments ever |
| Location chips | 10% of public posts |
| Clubs | 9 clubs, 16 members, 0 posts ever; clubs-email pref is off for 598 of 599 |
| Ranking Game (collection) | 13 users ever |
| Tags / receipts / insurance / warranty | 129 · 4 · 6 · 24 watches |
| Close friends | 16 requests ever; 14 posts/30d at friends visibility (2%) |
| Blocks / reports | 0 / 0 |
| Explore / model pages | admin-only, 0 external |

**Not measurable without PostHog** (needs a `phx_` key): Today's Pick taps, Stats / Year in Review / Month Review visits, gallery view, Post Pics toggle, URL fetch, Invite a Friend, `snap_to_track_matched`. `np_identify_outcome` in `feature_events` shows the wrist-shot auto-log matching for 8 users / 34 posts.

**Lifecycle email today (90 d):** broadcasts open 50%, click ~1%; onboarding drip open 45%, click 1%; social notifications open 69%, click 4.9%; wear reminder open 57%, click 2.5% (click tracking only records iOS 2.6+, so clicks are undercounted). The drip's day-14 email is **"Straps & Ranking Game"** (89 sends/30d) and day-21 is **"Wishlist"** (78 sends) — the three least-used features in the app.

## 4. What the data says

**F1 — Activation doubled, retention halved.** Signup cohorts:

| Cohort | n | added watch | measured wk1 | logged wk1 | push token | returned after day 14 | logged after day 14 |
|---|---|---|---|---|---|---|---|
| Jun | 95 | 85% | 54% | 17% | 31% | **45%** | 14% |
| Jul | 89 | 90% | 83% | 28% | 26% | 38% | 10% |
| Aug | 101 | 84% | 74% | **50%** | 50% | **23%** | **4%** |
| Sep (partial) | 38 | 71% | 66% | 45% | 95% | — | — |

Of the 113 Aug–Sep signups older than 7 days: 95 added a watch, 85 measured and 56 logged a wear **on day 0** — and **62 (55%) never came back after day 2.** The first session now does everything; nothing pulls people back except the 5pm push, which most of them don't see (F2). (Late-Aug rows are slightly right-censored on the day-14 columns; the direction holds for signups before 20 Aug.)

**F2 — Provisional push is a silent downgrade.** Provisional notifications land in Notification Center with no banner or sound. Conversion by permission state since 17 Aug:

| State | users | sends | → log within 36 h |
|---|---|---|---|
| authorized | 15 | 240 | **62.9%** |
| provisional | 47 | 465 | **2.8%** |
| denied | 3 | 25 | 24% |

Worse: holding a token routes those 47 users off the **email** reminder (13% conversion), so they went from a 13% channel to a 3% one. The deferred one-shot full ask has produced 20 authorized users in total (16 on 2.7).

**F3 — The measure-first persona is now the majority.** 131 measurers vs 82 loggers per month. 50 of this month's measurers have **never** logged a wear (32 of them joined this month); none of the 50 has ever liked a post; 18 have checked a value. Feedback in the period: "Remove requirement to register/login", "I only use the timegrapher. Stop the social bs." Demo views 287/30d vs 99 signups.

**F4 — Google avatar import never ran (bug).** 40 of 41 Google sign-ups since 16 Aug have `avatar_url = null` although every one carries a Google picture in `auth.users.raw_user_meta_data`. Cause: the `on_auth_user_created` trigger (`handle_new_user()`) inserts the profile row before the client runs, so the client's `isNewUser` branch is false and `maybeImportProviderAvatar()` is never called. The single success is the race case. Fix belongs in the trigger (copy `raw_user_meta_data->>'avatar_url'`/`'picture'`).

**F5 — Logging is broad, not deep, and flat.** Weekly loggers 30–37 for seven weeks while actives grew 15%. Median logs per logger = 1. The one lever that measurably worked is the rotation chips (revived-watch logs 5% → 12%). The Month-in-Review needs 5 wears on 2 watches, so only 19 people qualify.

**F6 — Social is still 3–5 people, but one lever worked.** 18 likers (top 3 = 56%), 12 commenters, 57 posters (top 5 = 49%). Follow-from-bell produced the best follow month; avatars (the other half of P8) didn't ship in effect.

**F7 — Value is a one-shot.** 40% of actives check a value; 22 users have two price points; the digest has never sent. The Value tile shows a number with no movement.

**F8 — Everything built on wishlist/share since June is unused** despite two broadcasts. Decision, not iteration.

**F9 — The watch database is built and dark.** 1,502 watches already resolve to a model; the "Also owned by" row is the cheapest social-graph seed we have (F6) and the direct answer to the measure-first persona's one non-social interest (their own watches).

**F10 — AI identify is fine.** 88% accepted or edited. Multi-photo (Aug P7b) is not needed.

**F11 — Measurement quality (context only).** 63% of converged readings within ±15 s/d; per-watch repeatability median IQR 6 s/d, 36 of 121 watches > 15. The Sunday loop owns this; no proposal here.

## 5. Competitive research — filtered against what WRotate already has

Two web sweeps (watch apps; niche logging/social apps). Full agent reports are summarised here; the raw findings are in this session.

**Already have — don't rebuild:** wrist-shot auto-log (snap-to-track), Today's Pick, monthly recap card, not-worn chips, cost per wear, streaks with earned weekends, accuracy history with bands, fun facts, close friends, follow-from-bell, share links, warranty banner, Year in Review on Stats, watch-model pages (dark).

**Peers ship, we don't:**
- **One-tap logging outside the app** — home/lock-screen widgets, Siri Shortcut, Apple Watch complication (Vellore, WatchGrid, WearTime, WORN with 9 widgets). Every serious peer has this; it targets exactly our depth problem.
- **Service / water-resistance / "unworn threshold" reminders** (Vellore, Bezelio, Klokker; tickIQ predicts service with AI). We have a warranty banner and accuracy history — rate drift is the one service signal nobody else can back with data.
- **"In repair" / sold / archived status** that freezes stats and Today's Pick (Klokker, Vellore).
- **Insurance-ready PDF / CSV export** (Bezelio, Vellore, WristWorth, Hodinkee's insurance) — we have no export at all. Most common one-time "pro" unlock in the category.
- **Time-offset accuracy mode** (Toolwatch, ChronoLog photo offset, WristTrack atomic sync): no mic, no placement tickets, measures real-wear drift over days.
- **Meetup Mode** hides prices when showing the app to friends (WatchGrid). RedBar is at 85–90 chapters.
- **Year-end card + #mostworn ritual** (Wristlog, WristTrack, WatchCrunch #mostwornin25).
- **Have / Want / "wearing today" counts on the object page** (Discogs, Fragrantica) — ours exists, dark.

**Mechanics with evidence:**
- Duolingo **friend streak**: +22% daily completion; the hard step is the first invite. **Silent streak freeze** auto-applied. Strava **Local Legend**: consistency laurel per segment, rolling 90 days.
- Mastodon's cold-start **follow carousel**: most-liked accounts last 30 d + most-followed active accounts. Threads: notify your followers on someone's **first post**.
- Whoop: prompt at the natural decision moment (morning), not a fixed clock; BeReal: random-time pushes convert the tap, not retention.
- Push opt-in benchmarks: iOS average ~56%; ours is 20 authorized of 231 token holders.
- Monetisation: one-time $6–13 unlock dominates; subscriptions draw the loudest reviews (tickIQ, EveryWatch); only AI credits and market data are paid monthly.

## 6. Proposals, ranked by users affected × effort

### P1 — Push: stop counting provisional as reached (JS + SQL + Swift trigger)
- **Issue:** 47 users get a silent push that converts at 3% and, because they hold a token, no longer get the 13% email.
- **Options:** (a) route provisional users to email as well until authorized; (b) move the full-permission ask to the first value moment — right after the first kept reading or first log — with copy naming the exact benefit ("a 5pm nudge naming your last-worn watch"); (c) both.
- **Recommendation:** (c). `wear_reminder_targets()` already knows the channel; `push_auth_status` tells it who is provisional. Metric: authorized users 20 → 60; push→log per send back above 30%.

### P2 — Fix the avatar import in the trigger (bug)
- **Issue:** F4. The shipped feature never ran.
- **Recommendation:** `handle_new_user()` copies `raw_user_meta_data->>'avatar_url'` / `'picture'` into `profiles.avatar_url`; optionally a one-off backfill for the 40 Google accounts with null avatars. Metric: avatars among new Google signups 2% → 90%.

### P3 — A day-7 reason to return for the measure-first majority
- **Issue:** 85 of 113 new users measure on day 0; 55% are gone after day 2. The re-measure push waits 21 days and has converted 0 of 36.
- **Options:** (a) day-7 push on the first kept watch: "Your Speedmaster ran +4.2 s/d last week — measure again to see if it holds" (accuracy history makes the second reading meaningful); (b) "3 watches unmeasured — complete your audit" for users with unmeasured watches (Full Audit badge exists, 23 earned); (c) weekly accuracy digest email.
- **Recommendation:** (a) as an `experiment()`, iOS push only, then (b). Metric: day-14 return for measure-first signups 23% → 35%.

### P4 — Timegrapher without an account (carried from Aug P6, now stronger)
- **Issue:** F3. Half the measurers this month never log; feedback asks for it twice; 287 demo views/30d.
- **Options:** (a) demo mode can run one measurement, gate Keep/History/Share; (b) a "Measure first" preference that puts Measure as the home tab and hides Feed; (c) both.
- **Recommendation:** (a) now — measurement runs on-device, costs nothing, and the reading is the signup argument. Metric: demo→signup on the Measure screen.

### P5 — Log without opening the app
- **Issue:** median 1 log per logger; the reminder gets people in, nothing makes the second log trivial.
- **Options:** (a) iOS notification action buttons on the 5pm push: "Wearing the Speedmaster again" / "Different watch" — logs without opening the app (small Swift, route already exists); (b) home/lock-screen widget + App Intent for "Log wear" / Today's Pick (2.8 build; every peer has one); (c) Apple Watch complication.
- **Recommendation:** (a) now, (b) in the next native build. Metric: loggers with ≥3 logs per month 24 of 82 (29%) → 45%.

### P6 — Recap reach and the year card
- **Issue:** 19 users qualify for the month card; measure-only users never see one; the December #mostworn ritual already exists in the community by hand.
- **Options:** (a) add a measurement slide (watches measured, best reading, biggest drift) so a measure-only month qualifies; (b) lower the wear threshold 5 → 3; (c) a shareable year card in December.
- **Recommendation:** (a) + (c); (b) as an experiment. Metric: recap-eligible users 19 → 60.

### P7 — Retarget the lifecycle email
- **Issue:** day-14 and day-21 drips promote straps, Ranking Game and wishlist (F8); broadcasts open 50% and click 1%.
- **Recommendation:** day-14 → "Not worn in a while + Today's Pick" (the one lever that worked), day-21 → "Your accuracy history / measure the rest of your watches". Stop broadcasting wishlist/share features. Metric: click rate 1% → 4% (social-notification level); log-after-day-14 4% → 10%.

### P8 — Suggested follows from the watch database (first payoff of the dark build)
- **Issue:** follow-from-bell gave the best month; 29 users follow anyone; the next follow moment is "who else owns this".
- **Options:** (a) after a watch is added, a carousel: owners of the same model (`model_owners` RPC exists), most-liked posters last 30 d, most-followed active accounts; (b) notify a new user's followers on their first post.
- **Recommendation:** (a). Metric: users following anyone 29 → 60.

### P9 — Watch database launch decision
- **Issue:** F9. Built, linked, dark.
- **Recommendation:** ship "Also owned by" + the model page from watch detail to everyone behind an experiment; keep Explore for later. Metric: `model_page_viewed` users; follows originating there.

### P10 — Value: make the second data point exist
- **Issue:** F7. 40% check once; 22 have history; the digest never sent. Watch-value is also the AI cost driver, so refreshing everything monthly is not free.
- **Options:** (a) quarterly auto-refresh for watches of 30-day-active users only (bounded); (b) then send the parked digest to users with ≥2 points; (c) leave it.
- **Recommendation:** (a) then (b). Metric: users with ≥2 price points 22 → 150.

### P11 — Freeze / demote (data-backed)
Wishlist (8 items/26 d), wishlist + collection share links (0 / 1), link comments (0), clubs (0 posts ever), Ranking Game (13 users), receipts/insurance. **Recommendation:** no more builds on any of these for 90 days; hide Clubs from nav for new accounts; drop them from the drip (P7). Nothing deleted.

### P12 — From the research, small and new (hold unless wanted)
"In repair / sold" status that freezes stats and Today's Pick; Meetup Mode (hide prices); collection PDF export — the natural first paid unlock if monetisation is ever on the table; a service-due nudge driven by accuracy-history drift, which no competitor can back with data.

## 7. Suggested order
P1 + P2 this week (bug-class, JS/SQL). Then P3 and P5a — one retention lever per persona, both measurable within two weeks. P7 and P8 next (reuse, cheap). P4 and P9 are product decisions. P6 and P10 after. Freeze P11.

## Caveats
- PostHog click data not pulled (needs a `phx_` key): Today's Pick, Stats/Year in Review, gallery, Post Pics, URL fetch, Invite a Friend are unmeasured here.
- Email click rates are undercounted (click tracking only for iOS 2.6+ recipients since 21 Aug).
- `measurement_sessions` covers June onward; `user_activity_days` only since 28 Aug (streak and month-over-month retention from it are not usable yet).
- iOS share is from `page_visits` user agents, not tokens.
- Aug cohort day-14 columns are partly right-censored for signups after ~20 Aug.
