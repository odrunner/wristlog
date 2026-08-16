# WRotate usage review — 2026-08-15

Fresh production numbers (internal accounts excluded, queried twice for determinism), compared against the 2026-06-28 snapshot in `WROTATE-FEATURES.md` §1A–1D. Then ranked proposals.

## 1. Headline movement since 28 Jun (7 weeks)

| Metric | 28 Jun | 15 Aug | Read |
|---|---|---|---|
| Registered users | 364 | **515** | +41%; signups 99/30d vs 98 the prior 30d — flat, all direct traffic (no UTM) |
| Active 30d / 7d (app opens) | 98 / 48 | **137 / 65** | growing with the base |
| Wear-loggers, last 30d | 24 | **72** | **3×** — weekly loggers went 6–10 → 30–36 the week reminders launched (06-22) |
| Wear logs, last 30d | — | 564 | 31% back-dated (people catch up) |
| Users who ever measured | 109 | 172 | but measurements/30d **229 → 232: flat** while users grew 41% |
| Wishlist users / items | 11 / 39 | 17 / 51 | 13 items in 7 weeks despite gallery, folders, share links; **0 share links minted** |
| Follows / users who follow anyone | 53 / — | 72 / **23** | still thin; 8 avatars, 9 bios in 515 profiles |
| Likes / comments | 628 / 171 | 1,769 / 256 | 87% of public posts get a like, 10% a comment |
| Value-check users (ever / 30d) | 94 | 146 / 51 | 53% of monthly actives have used it — the most-used feature among actives after cataloguing |
| Club posts | 0 | 0 | unchanged |

## 2. What the new data says

**Reminders work; push works 2.5× better than email, and almost nobody gets push.**
- Push reminders: 651 sent to 34 users → **32%** followed by a log within 30h. Email: 217 sent to 123 users → **13%**.
- The in-app push primer (2.3 build): shown 52 ×, **clicked 2, dismissed 49** (4%). Copy is generic ("Don't miss out on updates… reactions, reminders, badges").
- Only 36 of 137 monthly actives hold a device token.

**Logging got broad, not deep.** Of the 72 loggers this month, 42 logged exactly once; 18 logged 10+; median = 1. Top-5 users = 33% of logs. 22% of active loggers' watches have never been logged.

**Timegrapher: a distinct "just let me measure" persona.** In-app measurement-page feedback: "Remove requirement to register/login" · "Show amplitude and beat error. Forget the social stuff." · "Less questions. Just measure." · "Measurement variation is too large." Latest feature request: "an informational video on measuring — I cannot figure out where on the phone/watch." 64 of 172 measurers measured once and never again. `position` is null on all 825 results; only 10 have notes.

**Fun facts landed.** 501 of 1,406 logs carry a fact; 115 users saw one, 31 clicked (27% of viewers).

**AI photo add is heavy and doubted.** 3,326 identify/enhance/detect attempts by 197 users; user feedback: "identification misses more than it hits — take more pictures, case back, angles." Enhance errors 5%.

**Cohorts:** July signups log in week 1 at 28% (April–June: 11–17%) — activation improved. But July's return-after-14-days is 25% vs June's 42%, and the share of signups granting push fell 39% → 21%.

**Visibility mix (30d):** public 57%, private 35%, followers 7%, close-friends **1%** (was 30% overall). Occasion left blank on 36% of logs (was 44%).

**Still dormant:** Ranking Game 8 users, straps 42 watches, tags 103, clubs 0 posts, receipts ~0.

**Feedback channel:** 40 of 50 `feedback` rows are brand-list requests (all resolved). Real product feedback arrives ~1/month.

## 3. Proposals, ranked by users affected × effort

### P1 — Fix the push opt-in leak (JS only)
- **Issue:** push is the best re-engagement channel we have (32% → log) and the primer that unlocks it converts at 4%.
- **Options:** (a) rewrite the primer around the one concrete benefit, shown right after the first log: "Get a 5pm nudge to log what you wore today" + the user's own watch thumbnail; (b) move the ask into the Reminders settings row only; (c) fire the OS dialog cold again.
- **Recommendation:** (a). Log `shown/clicked` per copy variant; target ≥25%. Also check why only 34 of 143 token-holders receive pushes (14-day-active rule) before touching anything else.

### P2 — Make the second log as easy as the first
- **Issue:** 42 of 72 monthly loggers logged once. The reminder gets them in; nothing makes repeating trivial.
- **Options:** (a) reminder push deep-links to a one-tap "Wearing the [last watch] again? Log it" sheet; (b) "Log again" chip on Track for yesterday's watch; (c) iOS widget (native, next build).
- **Recommendation:** (a)+(b) — both web/JS, same one-tap sheet. Metric: % of monthly loggers with ≥3 logs (now 42%).

### P3 — Measurement onboarding: show where to put the phone
- **Issue:** measurements/30d are flat while the user base grew 41%; 37% of measurers never measure twice; the newest feedback literally asks for a how-to video.
- **Options:** (a) 8-second looping clip / 3-frame placement guide before the first measurement (dismiss forever); (b) inline "position" chooser (dial up / crown down…) that also populates the never-used `position` column; (c) surface amplitude + BE by default on Pro V2.
- **Recommendation:** (a) now, (b) with it (timegrapher users think in positions, and it turns repeat measurements into a comparable set). (c) is already tracked in the tg lock-validation work.

### P4 — NEW: monthly "Your collection moved" value digest
- **Issue:** value-check is used by 53% of monthly actives and `price_history` already accrues; nothing brings people back for it.
- **Options:** (a) monthly email: total value, top movers, one CTA to Stats; (b) portfolio value tile + delta on Stats; (c) both.
- **Recommendation:** (c) — email infra, quotas and Stats surface all exist. Metric: open→click on the digest vs the current ~5% CTR.

### P5 — NEW: "Wear this next" (rotation, the thing the app is named for)
- **Issue:** 22% of active loggers' watches have never been logged; Track shows history, not a suggestion.
- **Options:** (a) "Neglected" chip on Track: watch not worn in 30/60 days, one tap to log; (b) a Sunday "your rotation this week" card in the feed/promo slot; (c) full scheduler.
- **Recommendation:** (a). Tiny build, on-brand, measurable (share of logs on watches unworn ≥30 days).

### P6 — Timegrapher without an account (product decision)
- **Issue:** the "just measure" persona is explicit in feedback; 221 demo views/30d vs 99 signups.
- **Options:** (a) let demo mode run a measurement, gate only Save/History; (b) keep gating; (c) separate lite app.
- **Recommendation:** (a) if you're willing — measurement runs on-device so it costs nothing, and the reading itself is the strongest signup argument. Metric: demo→signup on measurement screens.

### P7 — Multi-photo identification
- **Issue:** the AI add path is heavily used and user-reported as unreliable; we don't record whether the user *accepted* the identification.
- **Options:** (a) log accept/edit after identify first; (b) allow 2–3 photos (dial + caseback); (c) show confidence and ask to confirm brand.
- **Recommendation:** (a) this week, then (b) if the accept rate is < 60%.

### P8 — Social graph seed
- **Issue:** 23 people follow anyone; 8 avatars. Where the graph exists, engagement is high (87% of public posts liked).
- **Options:** (a) auto-import Google/Apple avatar at signup; (b) "follow back" nudge on the like/comment notification; (c) contacts import (asked in March).
- **Recommendation:** (a)+(b) — small; skip (c) for now.

### P9 — Wishlist: stop building, measure the email
- **Issue:** rebuild + share links didn't move usage (13 items, 0 shares in 7 weeks). The day-21 wishlist email and the seeded promo are just starting.
- **Recommendation:** freeze wishlist for 30 days; if wishlist users < 30 by mid-September, demote it (fold into collection as a "want" state) rather than iterate.

### P10 — Kill list
Clubs (0 posts, ever), Ranking Game (8 users), close-friends visibility (1% of recent logs), receipts. **Recommendation:** hide Clubs and Ranking Game from nav for new accounts; keep data. Reclaims nav space and Help surface.

## 4. Suggested order
P1 → P2 → P3 (all JS, ship this week and next; each has a metric) → P4/P5 (new functionality, one at a time) → P6 decision → P7 → P8. Freeze P9, cut P10.

## Caveats
- iOS share is proxied by `device_tokens` (only users who granted push) — undercounts iOS.
- PostHog click data was not re-pulled (needs a `phx_` key); §1D of `WROTATE-FEATURES.md` is still the click-level source.
- Cohort return-rates for July are partly right-censored.
