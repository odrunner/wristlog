# WRotate usage review — 2026-11-26

Production numbers, internal accounts excluded, headline query run twice. Compared with the 10 Oct review (`docs/usage-review-2026-10-10.md`). Windows are the last 30 days unless stated. "Active" here means a row in `user_activity_days` (the app was opened that day).

## 1. The short version

1. **Growth is back, and the October "decline" was an outage, not a trend.** Apple sign-in produced zero new accounts from 7 Sep to 18 Oct. The week it was fixed, Apple signups went 0 → 62. Signups are 269 in 30 days against 68 at the last review.
2. **Half of the new growth is people who never do anything.** Since 26 Oct, 41% of signups (94 of 227) added no watch, ran no measurement and logged nothing in their first week; before that it was 19%. They are concentrated in Europe: 32% of European signups add a watch against 78% in the Americas.
3. **American new users are as good as ever** — 78% add a watch, 73% measure, 44% log a wear in week one. That is roughly double the published activation norm (average 34%, median 25%).
4. **The product people use is the timegrapher plus the reference content.** Measuring reaches 57% of actives, the Watches database 44% (it was 7 users in October), value check 25%. Social, wishlist, sharing, messages and clubs each reach 0–7%.
5. **The biggest gap against outside benchmarks is notifications.** 10% of iPhone users have real notifications on (norm about 44%). Those who do log a wear after 52% of reminders; everyone else, 2%.
6. **43% of all accounts own exactly one watch, 26% own none.** A rotation and wear-log app has nothing to offer a one-watch member after the first reading. This is the structural reason most people open the app on one day only.

## 2. Headline movement

| Metric | 10 Sep | 10 Oct | 26 Nov | Read |
|---|---|---|---|---|
| Registered users | 599 | 667 | **1,027** | +360 in 47 days |
| Signups, 30 days | 99 | 68 | **269** | Apple 130 / Google 138 in the last 5 weeks |
| Active 30 days (app opened) | — | — | **394** | 220 of them on one day only |
| Seen in last 30 / 7 days (`user_presence`) | 158 / 74 | 149 / 65 | 241 / 105 | same measure as earlier reviews |
| Weekly actives | 90 | 72 | 103–153 | peaked 182 the week Apple sign-in came back |
| Average daily actives | 34 | 31 | **45** | daily/monthly ratio 11% |
| Measurers / sessions | 131 / 2,726 | 117 / 2,444 | **225 / 5,108** | |
| Readings kept | 1,093 | 941 | 1,746 | |
| Wear-loggers / logs | 82 / 648 | 70 / 756 | **132 / 898** | 24 people with 10+ logs wrote most of them |
| Value-check users | 63 | 44 | 100 | |
| Watches database users | — | 7 | **174** | model pages 52, brand pages 3 |
| Likers / commenters | — | 20 / 8 | 27 / 6 | |
| Followers (people who followed someone) | — | 9 | 18 | |
| Recap sharers / human views | 1 / 61 | 22 / 93 | 21 / 187 | |
| Real notifications on (iPhone) | 20 | 41 | 60 | provisional 416, denied 95 |
| US App Store ratings | — | 33 | 37 (4.84) | 47 worldwide |
| Android users | 0 | 0 | 11 | announcement email: 836 sent, 6 clicks |

Signups by sign-in method, per week (the outage is the row of zeros):

| Week of | Apple | Google |
|---|---|---|
| 31 Aug | 15 | 12 |
| 7 Sep – 12 Oct (six weeks) | **0** | 12–37 |
| 19 Oct | 2 | 30 |
| 26 Oct | **62** | 34 |
| 2 Nov | 46 | 17 |
| 9 Nov | 28 | 19 |
| 16 Nov | 35 | 15 |

## 3. New users

### 3.1 Activation and return, by signup month

| Cohort | n | Added a watch (wk 1) | Measured | Logged | Back next day | Back in days 1–7 | Back in days 8–14 |
|---|---|---|---|---|---|---|---|
| Sep | 77 | 82% | 78% | 49% | 34% | 55% | 26% |
| Oct | 181 | 63% | 56% | 38% | 24% | 39% | 24% |
| Nov (to date) | 208 | 57% | 52% | 36% | 21% | 33% | — |

(June–August cannot be compared: daily activity has only been recorded since 28 Aug.)

Every column fell, and the next table shows why: it is a change in who is signing up, not in how the app treats them.

### 3.2 The same numbers, split by region (signups 26 Oct – 19 Nov)

| Region (from time zone) | n | Added a watch | Measured | Logged | Back in days 1–7 | Back in days 8–14 |
|---|---|---|---|---|---|---|
| Americas | 111 | **78%** | 73% | 44% | 41% | 23% |
| Europe | 90 | **32%** | 28% | 21% | 23% | 4% |
| Other | 26 | 54% | 46% | 38% | 42% | 12% |

Before 26 Oct, Europe was 65% / 58% / 47% on 43 signups — lower than the Americas but not broken.

By city since 26 Oct (signups → added a watch): Rome 25 → 3, Istanbul 19 → 1, Madrid 14 → 5, Lisbon 10 → 4, Berlin 10 → 4, Moscow 6 → 0. Against New York 54 → 44, Chicago 29 → 24, Los Angeles 23 → 17. Since 20 Nov alone: Rome 14 → 2, Istanbul 8 → 0.

What those accounts look like: of the 76 European signups with no watch, 63 signed in on the iPhone app, were shown the feed, never chose a username (the app asks for one at the first "add a watch") and were seen on a single day. Three of the 63 have a language set. The data does not say why they stop; it says they arrive, look, and leave before the first action.

### 3.3 First week decides the rest

Signups 28 Aug – 25 Oct, share active again in days 15–28:

| First week | n | Back in days 15–28 |
|---|---|---|
| Measured and logged | 84 | 39% |
| Measured only | 53 | 26% |
| Added a watch only | 10 | 20% |
| Nothing | 36 | 8% |

And the first measurement itself (signups 28 Aug – 11 Nov who measured in their first two days):

| First two days | n | Back in days 1–7 | Back in days 8–14 |
|---|---|---|---|
| Got a reading and kept it | 163 | 66% | 34% |
| Never got a reading | 42 | 26% | 14% |

Only 54% of first-ever measurement sessions produce a reading, and one new measurer in five gets none on day one. Across all sessions 51% converge; the rest end as stopped by the member (1,131), no ticks heard (818), weak signal (308), timed out (160).

## 4. What people use, and don't

Share of the 394 members active in the last 30 days:

| Used by many | % | Used by some | % | Barely used | % |
|---|---|---|---|---|---|
| Ran a measurement | 57 | Photo identify | 25 | Liked a post | 7 |
| Added a watch | 50 | Enhance (AI details) | 26 | Followed someone | 5 |
| Kept a reading | 45 | Value check | 25 | Shared a recap | 5 |
| Watches database | 44 | Posted beyond private | 25 | Wishlist add | 3 |
| Logged a wear | 34 | Accuracy history | 24 | What-if simulator | 3 |
| Measured on 2+ days | 27 | Fun fact tapped | 18 | Commented | 2 |
| | | Model page | 13 | Brand page | 1 |
| | | Logged 3+ wears | 10 | Shared a reading | 1 |
| | | | | Collection share link | 0 (1 person) |
| | | | | Started a message | 0 |
| | | | | Club post (ever) | 0 |

Ever, not 30-day: Ranking Game 16 people, straps 36, a non-English language 20.

**How often.** Days active in the last 30: one day 220 members, 2–3 days 82, 4–7 days 48, 8–14 days 19, 15+ days 25. The top 44 members account for 55% of all active days.

**What brings established members back** (accounts older than 14 days, 846 active days from 136 people): a wear was logged on 57% of those days and a measurement run on 31% — but counted by people it reverses: **91 came back to measure, 36 came back to log.** Measuring is why most people return; logging is why a few return very often. 12% of return days had no action at all.

**Collection size, all accounts:** none 270, one watch 440, two or three 187, four to nine 91, ten or more 39.

**Feedback box, last 45 days:** 28 entries, 23 of them "please add ⟨brand⟩ to the brand list". Each is a member who hit a wall at the first step of adding a watch. One asks for quartz to count toward the measure-everything badge.

## 5. Channels that bring people back

| Channel | Sends | Acted | Rate |
|---|---|---|---|
| Wear reminder, real notification | 461 (35 people) | 238 logged | **52%** |
| Wear reminder, quiet (provisional) notification | 1,314 (153 people) | 31 | 2% |
| Wear reminder, email | 306 | 20 | 7% |
| Day-7 "did it hold?" email | 69 | 10 measured within 3 days | 14% |
| Re-measure reminder (21–60 days) | 134 | 9 | 7% |
| "Turn on notifications" card | 95 people shown | 6 accepted | 6% |
| Review prompt | 133 shown | +2 US ratings in 3 weeks | ~2% |

Onboarding emails, 30 days: about 1,500 sent, opens 45–60% (inflated by Apple Mail), clicks 0–4% each, about 30 clicks in total. Six of the ten are about the features in the right-hand column of §4: share link (day 5, 236 sent), What-if (day 12, 214), Straps and Ranking Game (day 14, 199), Wishlist (day 21, 183). Two are about measuring.

Web: model pages took 263 visits, 222 of them crawlers and 13 from search engines; brand pages 11. The landing page had 21 Google and 12 AI-assistant arrivals. The pages are being indexed and are not yet a source of visitors.

## 6. Benchmark

| Measure | WRotate | Outside figure | Verdict |
|---|---|---|---|
| Week-one activation | 57% add a watch (Americas 78%) | 34% average, 25% median (Lenny's, 2022) | Well ahead |
| Back next day | 21–24% (Sep cohort 34%) | iPhone average 24% (AppsFlyer 2024) | At par |
| Back on day 7 | 4–8% (Sep 13%) | 8% | At par, dragged by Europe |
| Daily ÷ monthly actives | 11% | Lifestyle median 15%, tools 17.5% (MWM 2026, single vendor) | Below |
| Notifications allowed, iPhone | 10% | about 44% | **Far below** |
| Notification acted on | 52% (real) | 3% median open, 14% for contextual (Airship, Batch 2025) | Far ahead |
| Onboarding email clicks | 0–4% | welcome emails 15% (e-commerce weighted) | Below |
| US ratings | 37 | tickIQ 827, WristCheck 201, WatchCharts ~965 | Far below |
| People who like or comment | 7% / 2% | "90-9-1": ~1% create, ~9% react | Normal for a small community |

Benchmark figures are mostly second-hand and vendors define them differently; treat them as rough bands.

**Competitors (US App Store, read today).** tickIQ: mic timegrapher + AI wear tracking + feed, subscription from $29.99/yr, 4.6 on 827 ratings, iPhone only; complaints are price and thin per-watch history. WristCheck: free with tips, 4.9 on 201, CSV export, praised for no paywall. WearTime and WRST (new in 2026): one-tap wear widgets on home and lock screen, Siri shortcut. Klokker: its site says the iPhone app ends 31 December; Android stays. Recurring across rivals: wear widgets, streaks, CSV/Excel export, cost-per-wear, service and warranty tracking, valuation. Recurring complaints: forced accounts, subscription prices, watch-count limits, inconsistent readings. Nobody has an Apple Watch app.

WRotate has no widget, no notification buttons and no export.

## 7. Where engagement and adoption can grow

Ranked by people affected × evidence ÷ effort.

**E1 — Find out why European signups stop at the door (largest, cheapest).**
- Issue: 90 European signups in 25 days, 32% add a watch; Rome and Istanbul are near zero, and stayed there after 20 Nov.
- Options: (a) pull the Search Ads country report and pause the countries where installs do not become watches; (b) offer the member's language at sign-in rather than by a banner inside the app; (c) both.
- Recommendation: (a) first — it is an hour in the ads console and I cannot see that account. Judge each country on "added a watch", not installs. Then (b) as an experiment for the countries kept.

**E2 — Get real notifications from 10% to 30%.**
- Issue: the best channel in the app (52%) reaches 60 people; 416 sit on quiet notifications worth 2%. The ask card is accepted by 6%.
- Options: (a) ask at the moment of value — straight after a kept reading ("we'll tell you if it drifts") and after a second wear log; (b) repeat the ask up to three times, two weeks apart; (c) leave as is.
- Recommendation: (a)+(b) as one experiment. Every 100 members moved is roughly 50 more wear logs a day.

**E3 — Make the first measurement succeed.**
- Issue: 46% of first sessions give no reading; those members come back at 26% against 66%.
- Options: (a) a retry coach on a failed first session (move the phone, quiet room, crown against the microphone) before anything else is shown; (b) leave it to the Sunday accuracy loop, which tunes correctness and not first-run success.
- Recommendation: (a), measured on "first-day reading rate" 80% → 90%. Note: the explainer screen was tried twice and killed; this is a reaction to a failure, not an explainer shown up front.

**E4 — Give the one-watch member a reason to return.**
- Issue: 440 members own one watch. Rotation, the ranking game, straps and what-if mean nothing to them; measuring does.
- Options: (a) lean on the accuracy story for this group — the day-7 email already gets 14% to re-measure, so add a day-3 and a day-14 step and an accuracy trend they can watch build; (b) position reminder ("dial up overnight vs crown up"), which gives one watch several readings worth comparing; (c) push them to add a second watch.
- Recommendation: (a) now, (b) next. Not (c) — most have no second watch to add.

**E5 — Point the onboarding emails at what people use.**
- Issue: six of ten emails promote features used by 0–5% of members; two cover the feature used by 57%.
- Recommendation: replace day 5 (share link), day 12 (What-if), day 14 (Ranking Game) and day 21 (Wishlist) with: your watch's reading in context, the Watches database page for the member's own model, value check, and accuracy history. Target: about 30 clicks a month → 100.

**E6 — One-tap wear log from the lock screen (next native build).**
- Issue: third time on this list. Two new rivals lead with it; our reminder converts 52% even though it requires opening the app.
- Recommendation: "Wearing it again / Different watch" buttons on the reminder first (small), home-screen widget second.

**E7 — Ratings.**
- Issue: 37 US ratings; 133 prompts produced two. Ratings drive App Store search rank, which is the whole acquisition channel.
- Options: (a) ask only after a reading inside ±10 s/day on a second-or-later session; (b) keep the current triggers.
- Recommendation: (a). Apple caps prompts at three a year per person, so each one should land on a good moment.

**E8 — Stop the brand-list wall.**
- Issue: 23 of 28 feedback entries are brand requests, at the first step of the first action.
- Recommendation: let a member type an unlisted brand and continue, and queue it for review, instead of sending them to the feedback form.

## 8. Features to add, and to stop feeding

**Add (in order):** notification buttons and widget (E6); CSV export and import — the most-praised feature at WristCheck and ChronoLog, and the bridge for Klokker's iPhone users before 31 December; service and warranty reminders — common at rivals, and the fields (`warranty_expiry`, purchase date) already exist on every watch; "Year on the Wrist" card for December, with a measurement slide so the 225 measurers qualify and not only the 132 loggers.

**Keep investing:** the timegrapher, accuracy history, the Watches database and model pages, value check, fun facts, photo identify.

**Stop building on, this quarter:** messages (0 conversations started in 30 days), clubs (0 posts ever), share links (1 person), reading share (2), wishlist and What-if (10 and 11), Ranking Game (16 ever), brand pages inside the app (3 — their job is search traffic, which has not started). None needs removing; none should take another build or another email.

## 9. Since the October review

| October proposal | Status | Result |
|---|---|---|
| Measure before signing in | Shipped 11 Oct, demo entry removed 15 Oct | Not measurable: 1 demo view in 30 days |
| Model pages for search | Shipped, with brand pages | Crawled (222 bot visits), 13 search arrivals |
| Widen the day-7 nudge | Shipped | 12 → 77 sends a month; email 14% re-measure, notification 0 of 8 |
| Retarget the drip | Audience rules and button targets shipped 21–22 Nov | Subjects still promote the least-used features (E5) |
| One-tap log and widget | Not shipped | Carried a third time (E6) |
| Re-ask for notifications | Not shipped | Authorized 41 → 60, provisional 118 → 416 (E2) |
| Klokker import | Not shipped | Five weeks left |
| Year card | Not shipped | Due first week of December |
| Kill stale experiments | Done | No product experiment is running today |

## Caveats

- Region comes from the member's time zone, not from the store country. I cannot see the Search Ads account, so the link between ad countries and the European signups is not established here.
- "Back in days N–M" is any app open in that window; published D1/D7/D30 figures use single days, so only the next-day and day-7 columns are like-for-like.
- `user_presence` (241 seen in 30 days) and `user_activity_days` (394 active) disagree; presence has rows for only 527 of 1,027 accounts. The tables above use activity days, the headline row shows both.
- First-measurement and first-week retention splits are correlations.
- Email clicks are only recorded for members on iPhone app 2.6 or later.
- PostHog was not pulled (needs a personal key), so taps on screens with no database footprint — Stats, Help, the tab bar — are not in this review.
