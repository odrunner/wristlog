# WRotate — Backlog

Each open item is one action a single session can pick up. Order = priority. Detail for the long ones is under **Notes**.

## In Progress (running on their own — nothing to do unless they stall)
- **Model spec + reference-note translation backfill** — started 2026-11-14, 6 models per 3-minute run, 367 total. Check: `SELECT count(*) FILTER (WHERE translations->'de'->>'extras' IS NOT NULL), count(*) FROM watch_models WHERE coalesce(history, description) IS NOT NULL;`
- **Knob trial `tgknob_stabfresh_1`** — running since 2026-11-09, judged by the Sunday loop; `tgknob_bphdecisive_2` and `tgknob_phaselock_1` follow from the loop's queue.
- **Experiments running:** `review_first_good_msr` (review prompt after a good measurement, since 11-02), `wn_badge` (11-08), `result_share` (11-09). The nightly judge decides; a `won`/`killed` one needs its branch removed.

## Waiting on you
- **Upload Android 1.9 (vC9)** — bundle built 2026-11-14 with the translated shell strings: `android/app/build/outputs/bundle/release/app-release.aab`.
- **Build + submit iOS 2.11** — translated permission prompts, quick actions, offline screen. In Xcode confirm the `.lproj` folders are in both targets; check the three with the phone in German.

## Up Next (prioritized)
1. **Buttons with no font rule use the browser's default font.** Add a base `button { font-family }` rule (22 button groups affected: "Measure", "Cancel", "Add to collection", close glyphs), give `#logagain-other` a variant class, add a control-font test.
2. **Measure how share-post links perform** (opens per week, second-tap "Open WRotate" rate). Decides whether to build first-tap app opening (next item in To Explore). Read-only.
3. **Translate the public `/w/` model page.** `model_page` RPC returns English; return the visitor's language the way the share pages do.
4. **Android: foreground push shows no banner.** Find out whether it lands silently (channel importance) or never posts (`onMessageReceived`); fix likely needs a new HIGH-importance channel id. Needs a Play release.
5. **Admin Users view: list only users with a record** (a watch, wear or post) instead of the last 498, so column sorting ranks real users.
6. **Purge test traffic from `page_visits`.** 23,805 of 41,643 rows are HeadlessChrome (source already stopped). Delete in batches of ~2k with a pause, never one statement. Hygiene only.
7. **Daily recommendation: stop scoring weather from the watch's saved colour.** Nobody picks that colour (747 gold / 489 slate of 1,512 are defaults). Drop it from `computeWatchRec`, then remove the dead picker and `data-watch-color` plumbing.
8. **Remove web-measurement remnants** (~100 unreachable lines in `toggleMsrListen` / `stopMsrListen`, `_tgListening`). Own commit; verify on a device build. Detail: `audit-results/2026-09-20-dead-code-audit.md` → Follow-up.
9. **Remove Standard-engine leftovers** (`msr-std-preset-section`, `msr-std-tuning-section`, the Standard branch of `_msrSettingsApplyEngine()` / `_tgAlgo()`). Field has been 100% 2.5+ since October. Own commit; verify on a device build.
10. **Sold status for watches.** `watches.sold_at` + "Mark as sold" with undo; sold watches greyed at the bottom, excluded from Today's Pick, reminders, value and the ranking game; model page "Still owned: 20 of 22". Scope agreed 2026-08-29.
11. **Translate `og:` tags and the first `<title>` on `p/` and `profile/`** (the keys are already in the dictionary; nothing applies them).
12. **Fix the 9 script-built styles the design counter misses** (`'12px'` margin in `loadModelOwnersRow`, two scroll-highlight shadows, drag-ghost `borderRadius: '10px'`).
13. **Native shell colours onto the palette** (12 literals; iOS loading/offline screens; `manifest.json` dark vs first-paint light). Rides the next native release.
14. **Tick-log archival stage 2** — rolling 30-day retention for `timegrapher_tick_logs`. Needs your sign-off first: it changes how the rollout cumulative count is computed. Design: `docs/superpowers/specs/2026-06-22-tick-log-archival-design.md`.

## To Explore (not decided, not scheduled)
- **First-tap app opening for shared post links** — Cloudflare Worker on `wrotate.com/p/` serving crawler-only OG HTML. Decide after Up Next 2.
- **Measurement repeatability, one at a time:** (a) converge on the rate's standard error instead of a dot count; (b) tighter outlier rejection on short runs; (c) show ± on the reading; (d) "measure in the same position" prompt; (e) replace the two-point bucket slope with the engine's Theil-Sen rate for the convergence decision. Background in Notes.
- **Piezo auto-BPH "reset to manual at lock"** — tried (0aaaf77) and reverted (952f3d5); re-test under good signal first.
- **Monthly collection-value digest email** — code done on branch `value-digest-parked`; see Notes.
- **Design values worth doing only before a restyle:** border widths, colour-mix percentages, icon sizes, spinner timings, 12 duplicate tokens.
- **Still English on purpose:** legal pages, `404.html`, `delete-account.html`, `manifest.json`, og:image text, native bridge error messages, "present" in model year ranges, the sign-in screen.
- Edit a comment.
- Pulsing microphone on the Measure screen.
- Advanced batch mode.
- Suggest a watch I might like from my collection, purchases and missing styles.

## Notes

### Measurement repeatability background
Measurement precision — increase repeatability (feedback: "measurements vary a lot"). Backed by analysis of 200 real-user sessions (June 3-7, 19 users / 30 watches). Findings: median repeat-spread 14.2 s/day, but the engine floor (controlled long repeats) is only ~1.5-4 s/day — e.g. qbb251's Grand Seiko 6145 measured 6× at 35-60 dots = ±1.4 s/day. The rest is run-length noise + real watch/position variation (dexter888's Submariner spanned ±41 across 20 runs incl. 60-92 dot ones = position changes, not engine). Precision curve: 15-25 dots → median dev 5.4 s/day; 26-40 → 3.5; 41-60 → 3.5 (saturates ~40 dots). DONE: raised JS convergence dot floor 20→30 (index.html `minDots`).

### Monthly value digest
**Monthly collection-value digest email — PARKED 2026-08-16, code done on branch `value-digest-parked`.** Decided to ship only the Stats tile (freshness + tap-to-Update) for now. What's parked: `send-value-digest` edge fn (SES via mailer, `dry_run` + `limit`), `value_digest_targets()` RPC + `value_digest_sends` table (already in the DB, inert), `digest` email pref + unsubscribe category, Profile → Notifications toggle, smoke check. Copy: "Your collection is worth $X — Month" · gain vs paid · most valuable · "N haven't been checked in 60+ days → Update prices" · "we don't change values without you". Audience today ≈105 (priced watch, active 90d, ≤1/25d). Deliberately deterministic (sums SAVED values, no server-side refresh) because estimates are LLM-noisy ($6.5k→$5.8k→$10k on one watch) and prices need user approval since 41aa749. To ship: merge branch, deploy `email-unsubscribe` + `send-value-digest`, cron `0 16 1 * *`, first run `{"limit":25}`; metrics = CTR vs ~5% and value-checks 7d after vs before. Only revisit an auto-refresh "your collection moved" version with a noise guard (≥10% Δ confirmed by a second lookup). Data as of 2026-08-16: 649 priced watches / 144 users, only 123 watches (20 users) have ≥2 price points.

## Done
- **2026-11-14 — Share pages + unsubscribe page on the current palette.** Colours only (the two emoji state icons stay, by decision); `tests/share-page-tokens.test.js` fails if the copy drifts from `design-system.css`. Sizes on those pages are still hand-typed.
- **Profile privacy (audit S1) — already closed 2026-09-01, confirmed live 2026-11-14.** `is_admin()` exists and all 28 policies call it; logged-out visitors read only the 9 public profile columns (`is_admin`, `timezone`, `email_prefs`, `language` return 401); signed-in members are denied the same four on other profiles; logs/watches/comments still load logged out. Source: `sql/2026-09-01-profiles-grants-lockdown.sql`.
- **2026-11-14 — Languages, the open list** (sw v1435, `274ff3e2`, `b464441c`): member-written text is never translated (`escUser()` / `i18nMine()`); known server sentences translate in toasts; `p/`, `profile/`, `open.html` follow `wr_lang` (generated `i18n/page.js`); share pages + unsubscribe error pages follow the visitor's language; model spec values + reference notes; the fun fact inside a translated broadcast; "Someone"; money grouping; native shell strings written; Enhance in German checked live; 24 stuck fun facts fixed (2,446 of 2,446); translated broadcast tested by the user (hence the "translated by AI" note).
- **2026-11-13 — Languages, audit pass** (`3191f6d5`, sw v1433): model page labels, timegrapher lines, error toast labels, notification sentences, dates, share text, What's New from November 2026, Enhance in the member's language, model-page stories. Reports: `audit-results/2026-11-13-i18n-audit.md`, `audit-results/2026-11-13-design-hardcode-audit.md`.
- **2026-11-09 — Engine-knob trials handed to the Sunday loop** (code shipped 2026-10-25, `TG_ENGINE_REV` 2; blank-rate restart bug fixed).
- **2026-11-02 — Review-prompt timing experiment started** (`review_first_good_msr`).
- **2026-10-25 — Standard-engine selector retired** (`docs/archive/standard-engine-selector-retired-2026-10-25.md`).
- **2026-09-23 — Dead-code cleanup** (23134c4, 5463df3, a222346).
- Flaky mocked e2e tests fixed 2026-11-13.
- `page_visits` test traffic stopped at the source 2026-08-14 (`trackVisit()` bails on `navigator.webdriver`).

Earlier:
Change default visibility to public
delete comment (per-comment kebab menu, double-tap confirm; commenter deletes own, post owner moderates any on their post)
Make notifications shown as closed by default, not expanded
When user hits get prices, and if they are within 7 days instead of immediately showing the same prices and not mention anything. mention that price is still valid and can be updated in x days.
Reorganize collection to have Brand then next to it model name second row paid purchase then reference and url. then also check if we can do better than fetch. not sure fetch is used much. 
When user hits enhance on existing collection, the enhanhcment shoudl show what they are so that user gets confidence that they won't have what they entered overriden. right now they have to trust it's a good thing. show me first how you'd do before doing it. 
Change the collection detail page bottom images to gold. we should use amber to highlight AI work, but save and delete should be back to how they are in other modals
Want to have user enter their user name before they add a watch. I suspect that would make it more ownership of the site and usage. right now we don't require at all. think and plan of how we do it. 
Have an option of unsubscribe directly from email
show facts about watches on the feed when user clicks on anyone watches they post
in the admin dashboard, i want to see if a user is an active and details. so when i click on the name instead of the profile, i want a modal that has info about the user, basics like watches, wears, wishlist, measurements (success rate including), enhancements, vlaue check. and also last login, repeat or not, feedbcak asked, given. by them? go build
multiple pictures in a post
if someone used advanced settings show that it's not default anymore
measurement advance settings
measurement v2
