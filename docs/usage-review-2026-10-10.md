# WRotate usage review — 2026-10-10

Fresh production numbers (internal accounts excluded via `internal_accounts`, headline query run twice for determinism), compared against the 10 Sep review (`docs/usage-review-2026-09-10.md`). Then the scorecard of the Sep proposals, what the data says, competitive/growth research, and ranked proposals for the three asks: usage, retention, new signups.

## 1. Headline movement

| Metric | 15 Aug | 10 Sep | 10 Oct | Read |
|---|---|---|---|---|
| Registered users | 515 | 599 | **667** | +68 in 30 days |
| Signups 30d | 96 | 99 | **68** | **first decline (−31%)**; Sep cohort 77 vs Aug 101; weekly: 23 → 18 → 12 → 15 → 18 since early Sep |
| Active 30d / 7d | 137 / 65 | 158 / 74 | **149 / 65** | first contraction; WAU (from `user_activity_days`) 90 (wk of 7 Sep) → 72 |
| Wear-loggers 30d / logs | 72 / 564 | 82 / 648 | **70 / 756** | fewer loggers, MORE logs — depth is up (see F6) |
| Measurers 30d / sessions | — | 131 / 2,726 | **117 / 2,444** | tracking the active-user dip |
| Readings kept 30d | 232 | 1,093 | 941 | position still null on all of them |
| Users who ever measured | 172 | 282 | **340** | 51% of all accounts |
| Demo views 30d (distinct IPs) | 221 | 287 | **445 (152)** | **+55% while signups fell 31%** — tool-curious visitors who don't sign up |
| Follows 30d / users ever following | 72 / 23 | 110 / 29 | +22 / **32** | follow growth cooled after the Sep spike (9 distinct followers this month) |
| Avatars / bios | 8 / 9 | 10 / 10 | **116** / 11 | Sep P2 trigger fix worked |
| Likes / comments (all time) | 1,769 / 256 | 2,274 / 299 | 2,773 / 325 | 20 likers 30d, top 3 = 44%; commenters 12 → 8 |
| Value-check users 30d | 51 | 63 | **44** | declining; digest still never sent (`value_digest_sends` = 0) |
| Users with a push token | 143 | 231 | 295 | authorized **41** · provisional 118 · denied **55** (see F3) |
| Wishlist users / items | 17 / 51 | 18 / 57 | 20 / 68 | +11 items — AI Picks / What-if didn't move it (F9) |
| Club posts | 0 | 0 | 0 | Clubs parked 3 Oct |

**Acquisition reality check:** the web landing page gets ~3–7 anonymous visits/day (the apparent 5,000-visit prior month was a desktop crawler burst Aug 9–14). Reddit referrers: 10 visits/30d. Google search: 14. Effectively **100% of signups come from the App Store**, and that channel just shrank by a third.

## 2. Scorecard — the 10 Sep proposals

| Sep proposal | Shipped | Result |
|---|---|---|
| P1 push: provisional ≠ reached | 11 Sep (5503301) | **Worked where it ran.** Authorized 20 → **41** (target 60); authorized push converts **49.3%** (347 sends); provisional users now get the email (11.4%) + quiet push (3.3%). But **denied grew 25 → 55** — the benefit card also collects explicit "no"s. |
| P2 avatar import in trigger | 12 Sep (fba03448) | **Done.** Avatars 10 → 116. |
| P3 day-7 "did it hold?" nudge | 11 Sep (`remeasure_d7`) | **Starving.** 29 ledger rows in 29 days: 17 control, 12 email, **0 push** (no day-7 user is push-authorized). Verdict `too_early`, +33% lift at p=0.76 on 2 conversions/arm. The gate (first-ever kept reading, nothing since day 1) is too narrow to ever read. |
| P5 log without opening the app | not shipped | No notification actions, no widget. iOS 2.8 still in review queue carries neither. |
| P6 recap reach | share chip only (1 Oct) | **Sharing works now:** 22 sharers / 93 human views this month vs 1 sharer / 61 views at Sep review. Measurement slide + year card still open. |
| P7 drip retarget | **not shipped** | Day-14 is still "Straps & Ranking Game" (80 sends/30d), day-21 "Wishlist" (82). **27 unsubscribes/30d = 4.5% of sends** — the least-used features are emailed into the exact window where retention dies. |
| P8 suggested follows | 13 Sep (`follow_suggest` A/B) | **Seen, not acted:** 712 impressions / 80 users → 4 follows per arm. 26 days, inconclusive (−2.4%). |
| P9 Watches database launch | **3 Oct, to everyone (Beta)** + Clubs parked | 1 week in: 7 explore users, 7 model-page users (1–3/day). The launch broadcast is **drafted but unsent** (`broadcast_queue` has no pending rows). Dark in practice. |
| P10 value second data point | not shipped | Value users 63 → 44/30d. |
| P11 freeze wishlist/share | **violated in spirit** | What-if simulator + AI wishlist Picks shipped to everyone 28 Sep + broadcast: `sim_opened` **4 users**/30d, wishlist +11 items. The freeze zone claimed another build. |
| Other ships | feed perf (feed_rpc 100%), security batch (23–26 Sep), no-watch-today (3 Oct: 5 users/9 logs), compact views, Last Worn sort, review prompt → direct Apple sheet (10 Oct) | Review prompt funnel so far: 318 shown → 124 yes (119 native) → now straight to the Apple sheet. Baseline 33 App Store ratings, check mid-Nov. |

## 3. What the data says

**F1 — Growth went negative for the first time.** Signups 99 → 68/30d, WAU 90 → 72, actives 158 → 149, measurers 131 → 117. Nothing shipped since 10 Sep plausibly *caused* this (the period's ships were mostly invisible: security, perf, dark launches) — the engine was always "App Store search + nothing", and it is drifting down on its own. There is no second channel to catch it.

**F2 — The retention slide continues, cohort after cohort.** Returned-after-day-14: Jun **49%** → Jul 40% → Aug 32% → Sep **23%** (Sep 1–20 only, fully mature: 14/61). Roughly half of every cohort is never seen after day 2 (Sep: 48%). Meanwhile day-0 activation stays high (Sep: 78% measured in week 1, 49% logged). The first session does everything; each successive cohort finds less reason to come back. The one retention experiment aimed at this (`remeasure_d7`) physically cannot read at 12 sends/month (F4).

**F3 — The push fix worked, but the ceiling is visible.** Authorized 20 → 41 of 295 token holders (14%; iOS norm ~56%). Authorized push converts 49.3% per send — it is by far the best channel in the app. Denied also doubled (25 → 55): the benefit card converts fence-sitters in both directions. 118 users remain provisional (the card shows once; most never see it again).

**F4 — Both new retention experiments are starving, for the same reason.** `remeasure_d7`: 12 real sends in a month, 0 by push. `follow_suggest`: 80 users saw the card, 8 followed. Narrow eligibility gates + a 149-user active base = experiments that need quarters, not weeks, to read. At this scale an experiment must either target a majority surface or not run.

**F5 — Logging is consolidating into a core.** 70 loggers: 35 logged once, 20 logged 10+ times (652 of 756 logs, 86%). The 10+ group *grew* (17 → 20) while casual loggers shrank. The habit loop works for those who adopt it; the on-ramp is losing people earlier (F2).

**F6 — Email is actively hurting during the retention window.** The day-14/21 drips still promote the three least-used features (P7 never shipped), and unsubscribes hit 27/30d — 4.5% of sends. Every unsubscribe is a user permanently removed from the only re-engagement channel that works for the 85% who aren't push-authorized.

**F7 — The Watches database launched into silence.** Live for everyone since 3 Oct, but 1–3 users/day find it, and the announcement draft was never queued. Its two payoffs — "Also owned by" as a social seed, and public model pages as the first-ever SEO surface — are both still theoretical.

**F8 — The share loop finally produced numbers.** Recap sharing went from 1 sharer / 61 views to 22 sharers / 93 human views in a month. This is the only externally-visible growth mechanism the app has, and it just started working.

**F9 — The freeze zone claimed another build.** What-if + AI Picks (shipped 28 Sep, broadcast sent): 4 sim users, 6 opens, +11 wishlist items. Same pattern as share links, link comments, Ranking Game. The Sep P11 freeze ("no more builds on wishlist/share for 90 days") predicted this.

**F10 — Experiments hygiene.** `enhance_nudge` has run 42 days, inconclusive, −1.3% lift — by the project's own rules it should be killed and cleaned up. `collection_sim` and `wishlist_recommend` were manually shipped to 100% with 0-user treatment data, which makes the experiment system decorative for those launches.

## 4. Competitive & growth research (web sweep, Oct 2026)

One deep sweep (~35 fetches; Reddit blocks fetching, triangulated via WatchCrunch/WatchUSeek/indexed snippets). Evidence tags: STRONG = primary data / large sample, MEDIUM = vendor data or single credible source.

**The market since Sep:**
- **Klokker is shutting down** — "permanently removed from the App Store on December 31, 2026", data exportable in-app, free/no monetisation, 6 ratings. Free-with-cloud-costs died; its users are orphaned with exportable data. [STRONG]
- **tickIQ is the growth story:** ~45K installs in 13 months, ~3.5K MAU, 905 ratings at 4.6 (we have 33), $39–59/yr subscription — and its weekly installs are already declining. Zero press found; its channel is **App Store search alone**, with ASO-stuffed localized titles ("Timegrapher Watch Tuner tickIQ"). Review complaints: subscription price, no per-watch history pages. It converts <8% of installs to MAU. [STRONG]
- Timegrapher apps as rating-count proxy: ChronoLog 345 ratings 4.6 (~17K installs, $6 one-time, loved: no subscription, rate graphs, CSV export), Timegrapher X $30 one-time 23 ratings, Watch Tuner 3.8 (complaints: mic placement, inconsistent readings). Theme across all: **rate trusted, amplitude doubted, built-in mic maligned, subscriptions hated, one-time purchases praised.** [STRONG]
- ~14 tiny new entrants in 2026 (Lumed, Timeboxd, Prolost, Horolog, Bezelio, Skew…), none with traction; most are **account-optional or fully on-device** — account-first is the exception in this niche. WORN/Vellore/WearTime/WatchGrid have no 2026 footprint. Also: two unrelated apps now ship under the name "WristLog". [STRONG on existence]

**Channels that work / don't:**
- App Store search ≈ 48–53% of all app discovery; **AI assistants are now 10% of "first learned about my latest download"** and 58% of US adults have used AI to find an app (AppTweak survey Sep 2026). Product Hunt is dead for watch apps (0–5 upvotes). Press slot for a "watch app review" is **vacant in 2026** — Fratello/Worn&Wound have covered apps before, respond to data angles, not app pitches. [MEDIUM–STRONG]
- **The Discogs/Fragrantica slot is empty:** searches like "Rolex Submariner accuracy seconds per day" return dealer/strap blogs — no one ranks a crowdsourced per-model accuracy database. Fragrantica: 44.6M visits/mo, 50% from organic Google. WRotate is the only product in the niche *generating* per-model real-world rate data. [STRONG for the gap]
- Referral programs: nothing found in collector apps; the niche's substitute is public share links (Klokker, tickIQ "State of the Collection" links). [STRONG that peers converged there]

**Mechanics with numbers:**
- **Widgets:** Gratitude (journaling) reports **+25% retention among widget users** (10% of DAU adopted, driven by an in-app pinning prompt). Lumed/Wristly already ship quick-log widgets. [MEDIUM-STRONG, correlational]
- **Push:** iOS median opt-in 48.85% and falling (Airship 2026); onboarding-stage pre-permission campaigns run **up to +40%** vs category average; opted-in users show 2.9x D30 activation. Our provisional-vs-prominent finding (3% vs 49–63%) matches industry. [STRONG]
- **Win-back decays fast:** ~20–30% recovery in week 1 of lapse, <5% after day 30. Our 21–60-day re-measure reminder (5 of 78 converted) is far too late by these bands; week 1 is the window. [MEDIUM]
- **Recaps:** Spotify Wrapped 2025 hit 200M users in 24h, 500M+ shares (+41% YoY from friend comparison); HomeExchange's year-in-review hit 66.9% open at 26K users. [STRONG for the mechanic]
- **Streaks are receding** (share of apps with streak screens 14.0% → 8.1% in 2025) and only survive where the daily loop is genuine. Wear-logging qualifies; measuring doesn't. We already have streaks + earned weekends — no change proposed. [STRONG]
- **Benchmarks:** D1/D7/D30 for Lifestyle/Utility apps ≈ 23/9/5%. Email: judge on clicks, not opens (Apple MPP inflates opens); automation CTR benchmark ~7.4%, campaigns ~2.3%. Activation norm ~37–42%. [MEDIUM]

**Anti-tactics (explicit):** Product Hunt, subscriptions (the #1 complaint theme niche-wide), paid UA, press pitches without a data hook.

## 5. Proposals, ranked

Each checked against what exists. Ordered by (users affected × evidence) ÷ effort, grouped by the three asks.

### Signups

**P1 — Let a visitor measure before signing in (third carry — now the top item)**
- **Issue:** Demo views grew 287 → 445/30d (152 IPs) while signups fell 99 → 68. The measure-first persona is the majority; two standing feedback rows ask for exactly this; measurement runs on-device and costs nothing. Every 2026 entrant with traction is account-optional; Duolingo's canonical test (delaying signup) gave +20% DAU. The demo already exists — it just can't measure.
- **Options:** (a) demo mode runs ONE real measurement, result shown, Keep/History/Share gated behind "Sign in to keep this reading"; (b) also make Measure the default tab for logged-out visitors.
- **Recommendation:** (a) now, (b) with it. The live reading of *your own watch* is the strongest signup argument we possess. Metric: demo→signup conversion (instrument `demo_measure_run` in `feature_events`; PostHog funnel when a key is provided).

**P2 — Make the model pages the SEO/AI-discovery surface (the dark build's real payoff)**
- **Issue:** Nobody on the web ranks for "⟨model⟩ real-world accuracy"; AI assistants are 10% of app discovery and cite exactly this kind of page; we have 972 live models (364 with descriptions, 106 with heroes) and the only crowdsourced rate data in the niche. But today: `/w/` is one client-rendered page with a generic `<title>`, **zero model URLs in sitemap.xml**, and the aggregate accuracy number isn't on the page.
- **Options:** (a) build-time per-model static pages (or prerendered meta) emitted from `watch_models` into the published site, each with title "⟨Brand Model⟩ — real-world accuracy from owner measurements", the n≥3 aggregate rate, hero, description, and sitemap entries; (b) just sitemap + dynamic meta via a tiny edge renderer; (c) leave dark.
- **Recommendation:** (a) — the repo already builds the site from an allowlist, so a generated `w/⟨slug⟩/index.html` set fits the pipeline; start with the 364 models that have descriptions. Also: **the Watches launch broadcast is drafted but unsent** — queueing it needs your go-ahead. Metric: Google impressions for model pages (Search Console), `model_page_viewed` external users.

**P3 — Klokker rescue (hard deadline: Dec 31)**
- **Issue:** A direct competitor announced shutdown; its users can export their data and have nowhere obvious to go.
- **Recommendation:** a small "Import from Klokker" flow (their export format → add-watch pipeline), then one WatchCrunch/WatchUSeek post timed to the shutdown news cycle ("Klokker is closing — here's how to move your collection in 2 minutes"). Zero-cost, one-off window, high-intent audience. Metric: imports run.

**P4 — ASO on the existing listing + ratings flywheel (your actions, not code)**
- **Issue:** App Store search is ~half of niche discovery; tickIQ built 45K installs on it with keyword-stuffed localized titles. We have 33 ratings vs their 905; the direct Apple rating sheet shipped today (baseline recorded, compare mid-Nov).
- **Recommendation:** App Store Connect edits: title/subtitle carrying "timegrapher · watch accuracy · collection tracker", keyword field audit, screenshots showing the timegrapher first (it's what the market searches for). No code. Metric: App Store impressions → installs (App Store Connect analytics), rating count mid-Nov.

**P5 — One data-angle press pitch (hold until P2 exists)**
- The 2026 "watch app" editorial slot is vacant; Fratello/W&W respond to hands-on + data hooks. Pitch: "What ⟨N⟩ real-wrist measurements say about mechanical accuracy" — the aggregate table IS the story, and the model pages give the link target. Draft costs an afternoon; send only after P2 is live.

### Retention

**P6 — Widen the week-1 window (the starving-experiment fix)**
- **Issue:** Returned-after-d14 fell again (Jun 49% → Sep 23%). The one experiment aimed at this, `remeasure_d7`, made **12 real sends in a month** (0 by push) — its gate (first-ever kept reading, nothing after day 1, day 7 exactly) is too narrow to ever reach significance at our scale. Win-back evidence says week 1 is worth 4–6x day-30.
- **Options:** (a) widen eligibility: any kept reading (not only the first-ever), and include measure-only users who never saved — "your ⟨watch⟩ read +6 s/d Tuesday — has it held?"; (b) add a day-3 variant for users who measured but kept nothing; (c) leave it and wait ~2 quarters for significance.
- **Recommendation:** (a)+(b), same experiment framework, same ledger. At 149 actives an experiment must target a majority surface or it's decoration (see also P11). Metric: sends/month 12 → 80+, then let the judge read it.

**P7 — One-tap log + widget in the next native build (2.9) (carried twice)**
- **Issue:** Still the biggest gap vs every peer; Gratitude's widget cohort retains +25%; our 5pm push converts 49% for authorized users but requires opening the app to act.
- **Recommendation:** notification action buttons ("Wearing it again" / "Different watch") + a home-screen widget (today's watch, one-tap log, last rate). 2.9 is already waiting on your build for the key-rotation adoption — this rides along. Metric: loggers with ≥3 logs/month (currently 29 of 70) → 45%.

**P8 — Re-ask push at value moments (finish the P1-Sep job)**
- **Issue:** Authorized went 20 → 41, but 118 users sit in provisional (3% channel) and the benefit card shows once. Industry: pre-permission explainers at onboarding +40%; opted-in users 2.9x D30 activation.
- **Recommendation:** re-show the benefit card at the two value moments (right after a kept reading; right after a second wear log) with a cap (e.g. max 3 times, 14 days apart), each naming the concrete payoff. Metric: authorized 41 → 70.

**P9 — Retarget the drip + stop the unsubscribe bleed (carried from Sep P7, now urgent)**
- **Issue:** Day-14 is still "Straps & Ranking Game" (80 sends/30d), day-21 "Wishlist" (82) — the three least-used features, mailed into the exact window where cohorts die; 27 unsubscribes/30d = 4.5% of sends, each one permanently lost to the only channel that reaches the 85% non-push users.
- **Recommendation:** day-14 → "not worn in a while + Today's Pick" (the proven lever), day-21 → "your accuracy history / measure the rest" (one email, personalized with their own watch names — automations benchmark 7.4% CTR vs our ~1%). Metric: drip CTR ≥3%, unsubs <2%.

**P10 — "Your Year on the Wrist" (December) + measurement slide in the monthly recap**
- **Issue:** The recap share loop finally works (1 → 22 sharers, 93 human views/30d) and it's our only external growth surface. Measure-only users still never qualify for a recap. Wrapped-style year cards are the one mechanic with 9-figure evidence, and #mostworn is already a December ritual in the community.
- **Recommendation:** add the measurement slide now (watches measured, best reading, biggest drift — recap-eligible users 19 → 60+), build the year card for the first week of December. Metric: sharers, external card views, signups in Dec.

### Usage hygiene

**P11 — Experiment hygiene: kill the zombies, respect the freeze**
- `enhance_nudge`: 42 days, −1.3%, inconclusive — kill it and remove the branch (per the roll-out/kill rule this ships without asking).
- `follow_suggest`: 26 days, 8 follows total. Give it until day 42, then same treatment unless it moves.
- The freeze zone claimed another build (What-if + AI Picks: 4 users). Recommendation stands from Sep, now with two more data points: **no further wishlist/value/share builds this quarter**; new experiments only on surfaces ≥50% of actives touch (measure, collection, log).
- `collection_sim`/`wishlist_recommend` were shipped at 100% with empty treatment data — if the experiment system is to mean anything, manual ships should note "shipped on judgment, not data" in the decision row.

**P12 — From the research, parked unless wanted:** import/export CSV (ChronoLog's most-loved feature; also the Klokker bridge — P3 covers the import half), per-watch "history page" (tickIQ's most-requested), one-time unlock if monetisation ever comes up (subscriptions are the niche's #1 complaint — never a subscription).

## 6. Suggested order

1. **This week (JS/SQL, no asks):** P6 (widen day-7 window), P9 (drip retarget), P11 (kill enhance_nudge).
2. **Needs your go-ahead:** send the Watches launch broadcast (P2), App Store Connect ASO edits (P4).
3. **Next build cycle:** P1 (demo measurement — the signup lever), P2 (model-page SEO — the channel lever).
4. **Before Dec:** P3 (Klokker import, small), P10 (year card + measurement slide).
5. **Next native build (2.9):** P7 (widget + notification actions), P8 rides with it.
6. P5 (press pitch) only after P2 is live.

## Caveats
- PostHog click data not pulled (needs a `phx_` key): demo-screen behaviour, tab visits, funnel steps are unmeasured here. The demo→signup funnel is the single most valuable thing a PostHog pull would add.
- Email click rates undercounted (click tracking only for iOS ≥2.6 recipients).
- Sep cohort day-14 numbers quoted from the uncensored Sep 1–20 slice; Oct cohort too young for any retention column.
- "Returned after day 14" = `user_presence.last_seen_at` ≥ signup+14d (single last-seen row, so it means "was seen at least once after day 14").
- The Aug 9–14 anonymous-landing spike (~10k visits, one desktop UA) was a crawler; prior-period landing-traffic comparisons exclude it.
