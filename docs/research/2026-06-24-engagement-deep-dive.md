# WRotate Engagement Deep Dive — Research & Roadmap (2026-06-24)

Reference doc from the engagement research initiative. Three parallel research streams
(live usage metrics, watch-app competitor scan, analogous engagement mechanics) + a
code verification of the log/post model. Use this to pick the next features.

---

## 0. The one-sentence diagnosis

**Strong top-of-funnel, dead habit loop.** 78% of users add a watch, but 63% never do
anything again, only 16% ever log a wear, and D30 retention is ~8%. Users treat WRotate
as a *catalog*, not a *daily app*. Streaks, the feed, and badges are all starved because
the keystone behavior — wear logging — isn't happening. The problem is "day 2," not acquisition.

---

## 1. Usage metrics (live DB, 351 real users; excludes internal/suspended) — as of 2026-06-24

### Growth
- 351 real users. Launch spike April 2026 (161 signups), settled to ~15–30/week. Flat, not accelerating. iOS App Store is the main channel (all push tokens iOS).

### Activation funnel
| Step | % of users |
|---|---|
| Added ≥1 watch | **78.6%** |
| Did ≥1 measurement | 29.6% |
| Logged ≥1 wear | **16.0%** |
| Made ≥1 public post | 10.8% |
| Follows ≥1 person | 4.3% |
| Completed profile (name+avatar+bio) | ~0% |
- Median time to first watch: <1 min (during onboarding). To first measurement: ~12 min.

### Retention (the core problem)
- Of users who signed up ≥30 days ago (259): active in last 7 days = **6 (2.3%)**, last 30 days = **21 (8.1%)**.
- DAU 7 / WAU 21 / MAU 55. WAU/MAU 38%, DAU/MAU 13%.
- Weekly cohorts lose ~70% of active users W0→W1; plateau at 2–9% by W4. (Jun 1 cohort 57% W0 — possible recent-onboarding improvement, too early to confirm.)

### Engagement depth (power law)
- Watches: median 1, p90 4, max 68. 21% have 0, 49% have exactly 1.
- Logs: **84% have 0 logs**; only 6 users have 21+. Max 196.
- Measurements: 70% have 0; 57.7% of measurers repeat (≥2). p90 9, max 65.

### Social graph
- Follow anyone: **15 users (4.3%)**; 46 total follow edges. Median 3 follows.
- 449 public posts, 552 likes, 163 comments. **44% of public posts get ≥1 like** (content quality is there; density isn't).

### Streaks (shipped 2026-06-22)
- Only 56 users ever logged a wear-day. Median best streak 1, p90 14, max 46.
- **9 users have an active streak** right now; 7 ≥3 days; 2 ≥7. Longest active 14.

### Measurement (the bright spot / moat)
- 104 measured ≥1 (29.6%); 50 ≥3; 11 ≥10. Weekly volume up ~25× since late April (73 in week of Jun 8). 616 valuation events (91 users, 26%).

### Dormancy
- **62.7% (220/351) have zero activity ever** beyond signup/add-watch. Of the 131 ever-active, 57% went silent >30 days ago.

### Secondary features
- Badges: 44.7% earned ≥1 (best-adopted secondary feature; fires early/broadly). Valuation 26%. Wishlist 2.8%, clubs 2.0% (essentially unused).

### Push reach
- Only **34.5% have a push token (iOS only)**. 65% web-only → reachable only by email/in-app.

### Top 5 gaps
1. First-session cliff: 63% never act.
2. Wear logging not happening: 84% never log (81% of watch owners).
3. Social graph too sparse to loop (4.3% follow anyone) — though posted content engages.
4. Measurement is the differentiator but 70% never touch it.
5. D30 retention 8% — well below the ~20–30% viable range.

---

## 2. Competitor landscape (key players + the mechanics that retain)

### Direct collection/tracker apps
- **tickIQ** (4.6★, ~40k users, $39.99/yr) — strongest competitor. Timegrapher + full social + AI watch ID. **Killer mechanic: posting a wrist shot auto-logs wear time** (social motivation does the data entry). Community accuracy benchmarking, predictive service alerts.
- **WatchCrunch** (free, social-first) — the **daily "Wristcheck"** thread is the entire loop (resets daily, always fresh, new members surfaced to top). Wrist-time charts. Badge system exists but is buggy (counter breaks at 23/30) — opening for WRotate.
- **WatchGrid** — wear-streak **home-screen widget**, GitHub-style **year heatmap**, **neglect sort** (days-since-worn), **AM+PM daily reminders**.
- **Vellore** — wear streaks, idle-watch notifications, shareable social cards.
- **WristTrack** — **service reminders**, **annual "Wrist Recap"** (Wrapped), dual daily reminders.
- **WearTime / Watchee / ChronoLog** — cost-per-wear, "draw a random watch", position-tagged accuracy history, 3 measurement methods.

### Market-data / marketplace (proven loops, but crowded & funded)
- **WatchCharts** — price alerts (8 free/unlimited paid), portfolio value, **weekly portfolio value email**, market indexes, Morgan Stanley reports.
- **Chrono24** — 1.3M portfolio users, daily revaluation, **ChronoPulse** index, saved-search + price alarms, auto-import purchases, AR try-on.
- **Bezel** — Want-list price/condition/year alerts, Tue/Thu auction drops, Chubb insurance, Beztimate, Kalshi watch-futures.
- **EveryWatch** — global alerts (push/email/Slack/Discord), **transferable Passport** provenance, 35yr data.

### Timegrapher niche
- ChronoLog (4.7★, $4.99, position-tagging + trend charts), TickTracer (**re-measurement reminders** — added for retention), Toolwatch (**community accuracy benchmarks** — "178,118 Omegas measured"), WatchScope (COSC mode).
- Category gap: **nobody** combines clean measurement + persistent history + meaningful reminders + social. Measurement-as-social-data is unclaimed.

### Content/community
- Hodinkee (daily editorial, Talking Watches, limited-edition drops), WatchUSeek (daily WRUW thread + marketplace-unlock progression gate at 100 posts), r/Watches (daily expiring WRUW megathread + story-driven posts).

---

## 3. Analogous engagement mechanics (proven, transferable)

- **Endowed Progress Effect** (Nunes & Dréze 2006, peer-reviewed): a pre-filled head start lifted completion **34% vs 19%**. → onboarding progress bar with "Collection ✓".
- **Day-zero achievement** (Trophy.so data): unlock on day 0 → **56.9% retention vs 27.1%** (2.1×; D30 25% vs 4%). → celebrate first wear/measure/post instantly.
- **Loss-aversion streaks** (Kahneman/Tversky λ≈2): strongest post-day-7 retainer. **Streak freeze → ~48% longer streaks** (17.2 vs 11.6 days). Social-visible streaks **34% longer**. Duolingo streak widget +~60% commitment.
- **Identity > outcome** (Atomic Habits; Belk extended-self): collection logging ("this is who I am") structurally out-retains activity logging — collections never go backward, are identity, create switching-cost lock-in (Letterboxd/Discogs/Goodreads).
- **Zeigarnik / completion**: incomplete badge grids, wantlists, "collect them all" (Untappd: **1B+ badges earned**, 15k+ types tied to identity).
- **Wrapped / year-in-review** (Spotify/Letterboxd/Strava): highest-share moment + growth channel.
- **Variable reward in data reveal**: surfacing surprising measurement insights is intrinsic to the core loop.
- **Notifications as scaffolding** (RCT: 82% vs 49% compliance) — but they fade when removed; pair with habit + identity. Channel note: 65% of WRotate users are web-only → lean email + in-app, not just push.

---

## 4. Prioritized roadmap

### Tier 1 — Fix the habit loop (highest leverage)
1. **2-tap daily wear-log + multi-channel reminder** (84% never log; WatchGrid AM/PM, WristTrack reminder). Push reaches only 34% → also email + in-app (reuse campaign rails). Effort: med.
2. **Post = wear log fusion** (tickIQ). *NOTE: largely already implemented — see §6.* Remaining is UX framing, not plumbing.
3. **Day-zero reward on first wear log** (56.9% vs 27.1%; endowed progress). First-log celebration + "streak started" + onboarding progress bar. Effort: low.
4. **Streak freeze + loss-aversion framing + social-visible streaks** (48% / 34% lifts). Extends shipped streaks. Effort: low–med.
5. **Daily "Wristcheck" surface** independent of the follow graph (feed is empty at 4.3% follow but 44% like rate). Effort: med.

### Tier 2 — Exploit the moat (timegrapher data)
6. **Community accuracy benchmarking** — "your Sub runs +2.3 vs +0.8 community avg (412 owners)". Most defensible; no collection app can do it. Effort: med.
7. **Re-measurement + service reminders** (TickTracer added for retention). Effort: low–med.

### Tier 3 — Identity & virality
8. **"Your Year in Watches" (Wrapped)** — `computeYearInReview` already exists; shareable → growth. Effort: med.
9. **Identity badges** (brand/complication/era worn; Untappd model). Extends shipped badge system. Effort: low.

### Consciously NOT chasing
- Price alerts / portfolio-value / marketplace: proven loops but huge build into funded incumbents (Chrono24/WatchCharts/Bezel/EveryWatch). WRotate's moat is the timegrapher + the habit. *Cheap exception:* a wishlist price-drop alert could revive a dead feature (2.8% use) — small bet only.

### Chosen sequence (user, 2026-06-24): **#3 → #1 → #2**

---

## 5. Recommended starting bundle
#3 (day-zero reward) + #1 (daily log + reminders) — small, extend shipped systems, hit the W1 cliff where it's steepest. The throughline: get the 78% who add a watch to log a wear *once* and return *once* — that lights up streaks + feed + badges + accuracy data simultaneously.

---

## 6. Code verification — "post = wear log" (#2) — CONFIRMED ALREADY BIDIRECTIONAL

A wear log and a post are the **same `logs` row**, differentiated by `use_case` + `visibility`.

- **Logging a wear** (`saveLog`, index.html ~14491–14643): inserts a `logs` row with `visibility = selTrackVis || getDefaultVis()` (user's default pref, not hardcoded). If visibility ≠ 'private', it **appears in the feed** — i.e. logging already posts.
- **Creating a post** (`saveNewPost`, ~10639–11111): **always** inserts a `logs` row (`logs.push(entry)`); `use_case = 'measurement'` if the source is a measurement, else `'unspecified'` (a wear if a `watchId` is attached). So a watch photo post already counts as a wear.

| Action | use_case | counts as wear? | in feed? |
|---|---|---|---|
| Log wear (Track modal) | unspecified/occasion | yes (if not private) | yes (if not private) |
| Post photo + watch | unspecified | yes | yes (if not private) |
| Post photo, no watch | unspecified | no (watchId null) | yes (if not private) |
| Share measurement | measurement | no (excluded) | yes (if not private) |

**Edge cases:** a *private* wear log does NOT post (by design); a post with *no watch* or a *measurement* does NOT count as a wear. **Implication:** #2's plumbing is done. Any remaining work is UX framing (making users perceive log↔share as one fluid action, default-visibility nudges), not a new fusion.

## 7. Day-zero reward (#3) — what already exists vs. what to add
Already present: onboarding badges (ref 1 first_watch, 3 first_wear, 4 first_post, 5 profile_complete) auto-awarded in `checkAndAwardBadges`; earning fires the badge toast + `badge_earned` bell/push (shipped). A 6-step one-time welcome modal exists.
Missing (the actual #3 work): no **persistent onboarding progress/checklist** after the welcome modal; no **special first-wear celebration** beyond the generic badge toast (no "streak started", no endowed-progress bar). #3 = add the endowed-progress checklist + a stronger day-zero moment, reusing the badge/streak systems.
