# Reliability Audit — WRotate

**Date:** June 12, 2026
**Auditor:** Claude (automated deep-dive)
**Scope:** New tg code in index.html (phase-lock A/B plumbing, adaptive stop / Quick-Accurate, Deep Test, generalized knob sweep), iOS native engine (`TimegrapherEngine.swift` phase-lock + phase-separated BE), broadcast/email batching (`send-broadcast`, `run-campaign`), edge-function refactors (share-post / share-collection / watch-value / send-report lib.ts), LaunchAgent scripts (`scripts/rollout-check.py`, `scripts/nightly-analysis.py`), carried-forward items from the May 30 audit.
**Previous audit:** May 30, 2026 (`2026-05-30-reliability-audit.md`); ~13.6k lines changed since May 31 (commits e66e9ac…6d19123 and the tg-quality-v2 series).

All findings below were verified against current source this audit (file:line cited). Remote DB schema for new tables/columns (`deep_test_chunks`, `timegrapher_results.rate_std`, `timegrapher_tuning.sweep_*/phase_lock*`) was confirmed via `supabase db query`. Full unit suite passes: **1144/1144** (vitest, 44 files).

---

## Status Legend
🔴 Open · 🟡 Partial / Monitoring · 🟢 Fixed · ⚪️ Accepted

---

## (a) Carried-Forward Items from May 30

| Prior ID | Issue | Status | Evidence (verified this audit) |
|----------|-------|--------|--------------------------------|
| RH-A | Duplicate like/comment_like notifications (no dedup) | 🟢 FIXED 2026-05-31 | Partial unique index `uniq_like_notif` (commit 597c2e0); already marked fixed in the May 30 report. |
| RH4 | `sendFollowRequest` no in-flight guard | 🟢 FIXED 2026-05-15 (commit 33d84b2) | Guard + button disable + notif existence check now present (index.html:8489-8516: `_followInFlight.has(userId)`, `btn.disabled = true`, `finally` cleanup). **Note:** the May 30 audit carried this as open in error — the fix landed May 15. |
| RH2 | `loadFollowing` ignored Supabase `.error`, zeroed follow sets | 🟢 FIXED 2026-05-15 (commit 81a89fb) | index.html:7185-7194 — checks `results[0].error || results[1].error` and returns without overwriting `following`/`myFollowers`. Also carried in error on May 30. |
| RH3 | `postComment` cleared input before DB confirm | 🟢 FIXED (verified 2026-06-12) | index.html:11277-11279 — insert first, `input.value = ''` only inside `if (!error)`. On failure the text stays in the box and a toast shows. |
| RC1 | cloudSync race / `_syncRetryTimer` not cleared at entry | 🟢 FIXED (verified) | index.html:5957-5958 — `clearTimeout(_syncRetryTimer); _syncRetryTimer = null;` at function entry; `_syncInFlight` guard with retry scheduling (5961-5964). |
| RM1 | `_pendingDeletes` top-level `JSON.parse` boot crash | 🟢 FIXED 2026-05-31 | index.html:5934 — `let _pendingDeletes = [];` with guarded hydration. |
| RM5 | `loadMyProfile` upsert `onConflict:'id'` can clobber trigger-created profile | 🔴 STILL OPEN | index.html:6160-6171 — both the create and the username-conflict retry still use `upsert(..., { onConflict: 'id' })` with client defaults (could overwrite OAuth-trigger fields). Same shape as May 15/30. |
| RM3 | `saveMsrReading` / `saveTimegrapherManual` no double-submit guard | 🔴 STILL OPEN | Button `msr-save-btn` (index.html:3560) is enabled after measurement (24133-24134) and `persistMsrReading()` (24194-24218) never disables it during the awaited insert — fast double-tap still inserts two `timegrapher_results` rows. `saveTimegrapherManual` (22772) likewise. |
| RM-NEW1 | Publish while video poster extraction in-flight (`'__LOADING__'`) | 🟡 PARTIAL / STILL OPEN | `saveEditPost` now disables the Save button **during the save** (index.html:10278-10279), but neither the new-post nor edit-post publish path checks for `'__LOADING__'` previews (only render sites at 10081/10125/10546/10611 reference it). Publishing while a poster is still extracting remains possible. |
| RL1 | Fire-and-forget `.then(() => {})` without `.catch()` | 🟡 STILL OPEN (improved) | 20 occurrences of `.then(() => {})` remain in index.html. New code is better — postComment notification inserts now chain `.catch()` (11287-11304). No shared `fireAndForget` helper yet. |
| RL4 | `extract-url-meta` fetch: no timeout, no body-size cap | 🔴 STILL OPEN | supabase/functions/extract-url-meta/index.ts:66-72 (fetch, no `AbortController`), :81 (`await pageRes.text()` unbounded). Admin-only, so severity stays Low. |
| RL6 | SW cache version manual bump | ⚪️ Accepted (process followed) | sw.js:4 `wristlog-v771` (was v698 on May 30 — +73 bumps in ~2 weeks; cadence healthy). |

**Carried-forward summary: 6 fixed, 3 still open (RM5, RM3, RM-NEW1), 1 partial (RL1), 1 open-low (RL4), 1 accepted (RL6).**

---

## (b) New Findings

### N1 — HIGH: `may_onward_1of2/2of2` broadcast batches have no stable ordering and no send tracking → users can get the email twice (or never)
**Severity:** High · **Status:** 🟢 **FIXED 2026-06-12** · **Category:** Email dedup / batch boundary

> **Fix shipped 2026-06-12** (deployed + smoke-tested): `_NofM` batches now use **history-based exclusion** instead of positional slicing — `parseBatchSuffix` + `excludeAlreadyEmailed` + `nextBatchSlice` (send-broadcast/lib.ts). Before sending, the function excludes everyone who already received an email with the same subject (`email_events`, `event_type='sent'`, 14-day lookback), then batch n of m takes `ceil(remaining/(m−n+1))` — the last batch takes everything left. No overlap and no skip is structurally guaranteed (covered by new deno tests, including a two-round partition test and a re-click test); the profiles query also gained `.order("created_at")`. Chosen over the campaign_id-tracking option because `email_campaign_sends.campaign_id` is an FK to `email_campaigns` and the broadcast UI sends no campaign_id — history exclusion needs no UI/schema change AND correctly completes the in-flight June 12 campaign (batch 1, 55 recipients, went out 20:33 UTC under the old rule; batch 2 will now exclude exactly those 55). Caveats noted in code: keep the subject identical across a campaign's batches; allow a few minutes between batches for webhook ingestion.

**Files:** supabase/functions/send-broadcast/index.ts:107-123, 196-197; supabase/functions/send-broadcast/lib.ts:115-132; index.html:2919-2920 (UI options), 14147 (segment passthrough).

The new May-1-to-now segment is sent as two halves (`may_onward_1of2`, then `may_onward_2of2`, typically minutes-to-hours apart). Each request **rebuilds the recipient list from scratch** and slices it:
- The `profiles` query (index.ts:107-110) has **no `.order()` clause** — Postgres returns rows in unspecified order, which can differ between the two requests (plan changes, concurrent writes, vacuum).
- `batchSegment` (lib.ts:115-125) slices `[(n-1)*ceil(len/m), n*ceil(len/m))` of whatever order arrived.
- New signups between the two sends change `len`, shifting the boundary even if the order were stable.
- Unlike cohort blasts, date-windowed segments write **nothing** to `email_campaign_sends` (tracking is gated on `cohort && campaign_id`, index.ts:238), so there is no dedup backstop.

Result: a user near the boundary can appear in both halves (duplicate email) or in neither (never receives it). The batch math itself is correct *within one snapshot* (deno tests cover that); the bug is cross-request instability.

**Fix (pick one):**
1. Add `.order("id")` (or `created_at,id`) to the profiles query — cheap, removes the ordering instability (boundary can still shift with new signups), **and**
2. Track sends for date-windowed segments too: pass a `campaign_id` for these sends and reuse the existing `email_campaign_sends` insert + exclusion (the mechanism already exists for cohorts — extend the `cohort &&` conditions to `(cohort || segGte) && campaign_id`). That makes re-clicks and overlaps harmless.

### N2 — HIGH: `run-campaign` records the wrong users as "sent" on partial batch failure → permanent skips + future duplicates
**Severity:** High · **Status:** 🟢 **FIXED 2026-06-12** · **Category:** Partial-failure handling

> **Fix shipped 2026-06-12** (deployed + smoke-tested): the trailing `recipients.slice(0, sent)` insert is gone; each batch is now recorded immediately inside the `res.ok` branch via `upsert(..., { onConflict: "campaign_id,user_id", ignoreDuplicates: true })` with the error checked and logged. Failed batches are never recorded; a crash between batches loses at most the in-flight batch's records (and the upsert makes any replay duplicate-tolerant).

**File:** supabase/functions/run-campaign/index.ts:144-177.

Sends go out in batches of 100; `sent`/`failed` accumulate across batches (153-163). Afterwards the function records sends as:
```ts
const sendRecords = recipients.slice(0, sent).map(r => ({ campaign_id, user_id: r.uid }));   // :172
```
If batch 1 (recipients 0-99) **fails** and batch 2 (100-199) **succeeds**, `sent = 100` and the function records recipients **0-99** — the exact users who did NOT get the email — as sent. On the next cron run, the failed users are excluded forever (recorded as sent) and the actually-emailed users 100-199 are re-sent (duplicate). Any mid-list batch failure corrupts the tracking this way.

**Fix:** record per successful batch, not by prefix-slice — inside the `res.ok` branch, `sendRecords.push(...batch.map(...))`; insert the accumulated list (or insert per batch immediately, as send-broadcast already does at index.ts:238-247).

### N3 — MEDIUM: Deep Test doesn't suppress the auto-stop controllers or the share popup → runs truncated, possible zero-chunk results, popup mid-test
**Severity:** Medium (admin-flag feature, but defeats the feature's purpose) · **Status:** 🔴 Open · **Category:** Flag-interaction / state machine

**Files:** index.html:23298 (`_q2Tick` stop gate), 22686 (legacy auto-stop gate), 24155 (share-popup gate), 21908-21967 (`runDeepTest`).

This is a recurrence of the exact bug fixed for mic batch in commit 9912046 ("stop mic batch hanging after first run"): that fix added `!_micBatchActive` exemptions to both auto-stop paths and the share popup — but **Deep Test (added later, d5e8a85) uses its own `_deepTestActive` flag and got no exemption**:

- `_q2Tick` (23298): `if (_msrListening && !_micBatchActive && _msrListenStart)` — during a Deep Test run on a v2 build (or with `tg_quality_v2` on, which admins have), the plateau controller fires `stopMsrListen('plateau')` as soon as incrSettle settles (Quick mode: eps 0.7/hold 5 → typically ~30-60s), truncating the intended 90s (`dt_run_secs`) run. `extractCleanChunks` needs warmup (≥15s) + window (10s) + `segMinSec` (15s); a run truncated at ~35s can yield **zero clean chunks**, degrading or emptying the Deep Test result.
- Legacy path (22686): `!_micBatchActive && !_tgV2Convergence()` — on a non-v2 build with only `deep_test` enabled, runs are stopped at converged/45s `maxDuration` instead, with `duration_timeout` incrementing `_msrConsecutiveFailures` (23986) and popping troubleshoot tips mid-test.
- Share popup (24155): `... && !_micBatchActive` — a converged plateau stop during the first Deep Test run on an unprompted watch opens the share modal mid-test.

**Fix:** add `&& !_deepTestActive` to all three gates (23298, 22686, 24155) — the same one-line treatment `_micBatchActive` got. Consider `_pzBatchActive` at 23298 too: piezo batch runs (28s) are equally exposed to the v2 plateau stop since `_q2Tick` is invoked for all sources (22345).

### N4 — MEDIUM: No mutual exclusion across the four batch runners → concurrent orchestrators interleave start/stop
**Severity:** Medium (admin-only buttons) · **Status:** 🔴 Open · **Category:** Race condition

**Files:** index.html:21797-21828 (`runPiezoBatch`/`_pzBatchActive`), 21879-21897 (`runMicBatch`/`_micBatchActive`), 21908-21915 (`runDeepTest`/`_deepTestActive`), 21970-21976 (`runMicSweep`, shares `_micBatchActive`).

Each runner only checks **its own** flag. Tapping **Deep Test** while a Mic Sweep/Batch is running (both buttons are visible together in the dev panel, 3443-3444) starts a second loop: both call `toggleMsrListen()`/`stopMsrListen()` on the shared single session, each loop's sleep/stop interleaves with the other's, and both insert rows (`measurement_batch_runs` + `deep_test_chunks`) snapshotted from the same corrupted session. Same for Piezo Batch vs the mic runners.

**Fix:** a single `_tgRunnerActive` (string: 'pz'|'mic'|'sweep'|'deep'|null) checked at the top of all four entry points; toast "another run is active" and return.

### N5 — MEDIUM: `runMicSweep` double-tap race — guard set only after an `await`
**Severity:** Medium · **Status:** 🔴 Open · **Category:** Race condition

**File:** index.html:21970-22001.

`runMicSweep` checks `if (_micBatchActive) { …cancel…; return; }` at entry (21972), then `await`s the `timegrapher_tuning` fetch (21983) **before** setting `_micBatchActive = true` (22001). Two taps within that ~100-500ms window both pass the guard and start two concurrent sweeps (interleaved runs, doubled inserts, the second sweep's `finally` clears `q2_sweep_active` while the first still runs). `runMicBatch` (21892) and `runDeepTest` (21926) set their flags synchronously and don't have this window.

**Fix:** set `_micBatchActive = true` before the tuning-table fetch (and clear it in the early-return error paths, or move the validation before the flag).

### N6 — MEDIUM: Unknown/typo'd broadcast segment silently falls back to "send to everyone"
**Severity:** Medium · **Status:** 🔴 Open · **Category:** Footgun / input validation

**Files:** supabase/functions/send-broadcast/index.ts:87, 120-121; lib.ts:20-23, 115-131.

`segment` is never validated against a whitelist. A typo'd segment (e.g. `may_onwards_1of2`, or a future segment name sent from an older/newer client) makes `segmentDateGte()` return `null` → **no date filter** → all opted-in users are eligible; `batchSegment` then either slices half of the entire user base (suffix still parses) or returns the full list (`_3of2` → `num > count` → unchanged, index lib.ts:120-124). `validateBroadcastInput` checks cohorts but not segments. Today the only caller is the admin dropdown, but the server should not rely on that.

**Fix:** reject requests whose `segment` isn't `all`, a known base in `SEGMENT_DATE_GTE`/`never_measured`/`batch_1..3`, or `<known-base>_<n>of<m>` with `n<=m` — return 400 like unknown cohorts do (lib.ts:47-49).

### N7 — LOW: Cancelled Deep Test still saves a partial result
**Severity:** Low · **Status:** 🔴 Open · **Category:** Surprising state on cancel

**File:** index.html:21910 (cancel sets `_deepTestActive = false`), 21956-21966.

The cancel tap exits the run loop, but execution continues past the `finally` to `medianStd(pooledRates)` and — if any chunks were pooled — **inserts a `timegrapher_results` row** (`source: 'deep_test'`) and toasts "Deep Test saved". A user who cancelled run 2 of 6 gets a low-n "result" persisted to the watch's accuracy history. Mic batch, by contrast, just toasts "cancelled" (21896).

**Fix:** capture `const cancelled = !_deepTestActive` … actually track cancellation explicitly (e.g. set a local `wasCancelled = true` in the loop-break path) and skip the persistence + show "Deep Test cancelled".

### N8 — LOW: `rollout-check.py` — session counts include internal accounts; silent partial pagination; no-network = traceback + history gap
**Severity:** Low · **Status:** 🔴 Open · **Category:** Metrics correctness / script robustness

**File:** scripts/rollout-check.py:121-128, 50-64, 34-47 (deployed copy verified **identical** to repo copy).

- `v2_sessions_all`/`v2_sessions_today` increment for every `psBE=` session regardless of `is_internal` (121-126); only the **user** sets exclude internal accounts. The docstring (and CLAUDE.md) promise internal accounts are excluded from the numbers — the "/ N sessions" halves of the report can be inflated by admin test sessions.
- `fetch_paginated` (56-59): a mid-pagination error object breaks the loop and returns the partial rows **silently** when `rows` is non-empty → undercount with no warning.
- `curl_json` uses `subprocess.run(check=True, timeout=30)` — network/DB down at 9am → unhandled `CalledProcessError`, no history line appended (trend gap), no retry. Same failure mode in nightly-analysis.py (line 67).

**Fix:** gate the session increments on `not is_internal` (or count uid-less sessions separately); print a `WARN partial page` when breaking mid-pagination; wrap `main()` in a try/except that writes a dated `FAILED: <err>` line to the history file so gaps are visible.

### N9 — LOW: Mic batch/sweep/deep loops don't abort on a native `error` event → stale-data rows for remaining runs
**Severity:** Low · **Status:** 🔴 Open · **Category:** Error path leaves loop running

**Files:** index.html:22755-22768 (native error handler), 21852-21876 (`_micRunBatchLoop`).

The native `error` event (e.g. mic permission revoked mid-batch) sets `_msrListening = false` and resets the UI but does **not** clear `_micBatchActive`/`_deepTestActive`. The batch loop then proceeds: each remaining iteration calls `toggleMsrListen()` (which may immediately error again), sleeps the full `runMs`, and inserts a `measurement_batch_runs` row snapshotting the **previous run's** `_msrScatterData` — N duplicate rows of stale data, unattended (these loops are designed to run unattended).

**Fix:** in the `error` branch, also set `_micBatchActive = false; _deepTestActive = false; _pzBatchActive = false` (and let the loops' cancel paths handle button labels).

### N10 — LOW: `watch-value` rate limit is non-atomic; no timeout on the Anthropic fetch
**Severity:** Low · **Status:** 🔴 Open · **Category:** Race / missing timeout

**File:** supabase/functions/watch-value/index.ts:91-113 (read-then-update of `rate_limits` — two concurrent requests both read count N, both write N+1 → undercount), :142-156 (no `AbortController`; a hung upstream burns the whole edge wall-clock). Both are bounded-impact (limit 20/day, single-user endpoint).

**Fix:** an atomic `increment_rate_limit` RPC (or `UPDATE ... SET request_count = request_count + 1 RETURNING`), and a ~30s AbortController on the Anthropic call.

### N11 — LOW: Broadcast test email differs from production sends (no footer); `dry_run` count ignores the batch slice
**Severity:** Low · **Status:** 🔴 Open · **Category:** Preview/production divergence

**File:** supabase/functions/send-broadcast/index.ts:100-103 (test path sends `safeHtml` with **no** `unsubFooter` — the admin approves an email that won't match what users get), :186-194 (`dry_run` returns `will_send: cappedRecipients.length` **before** `batchSegment` is applied at :197 — a dry run of `may_onward_1of2` reports the full ~108, not the ~54 the send will target). The double-footer bug itself is fixed (verified: `buildFinalBroadcastHtml` index.html:13928-13938 omits the preview footer; server appends the real one at index.ts:214).

**Fix:** append a footer (with a sample/self unsub URL) to the test send; apply `batchSegment` before the `dry_run` return.

### N12 — LOW: Tuning poll can clobber the swept knob mid-run
**Severity:** Low · **Status:** 🔴 Open · **Category:** Flag interaction

**File:** index.html:22247-22269 (`startTuningPoll`), 23729-23744 (`_q2ApplyOverrides`).

If the `timegrapher_tuning` row's `updated_at` changes while a sweep run is in flight, the 3s poll rewrites `msr-tune-tick-detect-mult` from `resolveTdm(localOverride, table, 0.3)` (22260-22261) and re-sends tuning — overwriting the active swept value (the sweep stores its value in `q2_sweep_active` + the DOM input, not in `q2_tick_detect_mult`). `_q2ApplyOverrides` re-asserts the sweep value only at the **next** run start, so the remainder of the current run measures with the wrong knob, and the row is still tagged `sweep_value=<swept>`. Narrow trigger (requires a table edit mid-sweep — but remote-driving the table mid-sweep is exactly the new workflow).

**Fix:** in the poll, skip the tdm/phase-lock input rewrite when `localStorage.q2_sweep_active` is set (or re-apply `_q2ApplyOverrides()` after the poll's `sendMsrTuning()`).

---

## (c) Verified-Solid (positive findings, checked this audit)

- **`q2_sweep_active` stale-flag bug (past incident) — cleanup now complete:** cleared on boot (index.html:21655 in `initApp`), cleared in the sweep's `finally` (22021), re-applied per run start via `_q2ApplyOverrides` (23737-23744), knob restored after sweep (22022). try/finally wrapping verified (22003-22024).
- **Native phase-lock carry-state resets are complete:** `plHaveCand/plBestDist/plMissCount/plApplyCarry/plPendingCarry` reset on recalibration (TimegrapherEngine.swift:583), on phase-recovery resync (:891), on reject-reset (:958), and in `activateTickDetection` (:1146), which every session passes through (manual: start():473; auto: on BPH lock). Carry application is single-consumer (:555). Phase-separated BE buckets reset alongside (:422, :959, :1147). BPH-correction path re-locks cleanly (:711-714).
- **`stopped` native echo correctly ignored for measure sessions** (index.html:22738-22744) — prevents the stale-echo-kills-new-session race.
- **Mic batch exemptions from auto-stop/share-popup work** (`!_micBatchActive` at 22454, 22686, 23298, 24155) — the gap is only Deep Test/piezo batch (N3).
- **Mirror-drift guard test** (tests/mirror-drift.test.js) — VERBATIM mirrors (incrSettle, `_q2Ls`, extractCleanChunks, medianStd, computeRobustRate, resolveTdm, resolveSweepKnob, parseSweepValues) are byte-compared between index.html and wrotate_test.js and CI-fails on drift. Excellent regression net for the dual-implementation pattern.
- **LaunchAgent script copies:** `~/.local/bin/wrotate-rollout-check.py` and `wrotate-nightly-analysis.py` are **byte-identical** to the repo copies (verified by diff). All three plists present.
- **Schema verified in remote DB:** `deep_test_chunks.deep_test_id`, `timegrapher_results.rate_std`, `timegrapher_tuning.{sweep_knob,sweep_values,sweep_runs,sweep_secs,phase_lock,phase_lock_window,tick_detect_mult}` all exist.
- **Email footer standardization is consistent** across send-broadcast (lib.ts:138-139), run-campaign (lib.ts:44), send-email (lib.ts:118); double-footer in sends fixed (buildFinalBroadcastHtml passes no footer; server appends).
- **`_iosAppVersion` gating** injected at `didFinish` before any measurement can start (WebView.swift:130); old shells never set it → clean legacy fallback.
- **send-broadcast / confirm flow:** `_broadcastSending` + button disable guard against double-send (index.html:14125-14128); explicit confirm dialog with segment label (14110-14122).

---

## Test Gaps (changed code paths with no coverage)

| Area | Gap |
|------|-----|
| `_q2Tick` adaptive-stop controller | No tests for the stop gates (batch/deep-test/piezo exemptions, cap path, converged-phase setting). The incrSettle math is tested; the **orchestration** (which is where N3 lives) is not. |
| `runDeepTest` / `runMicSweep` / `_micRunBatchLoop` | Orchestrators untested (helpers `extractCleanChunks`/`medianStd`/`resolveSweepKnob`/`parseSweepValues` are mirrored + tested). Cancel paths (N5, N7) and runner mutual exclusion (N4) have zero coverage. |
| Edge-function lib tests not in pre-commit path | `npm test` (vitest) does **not** run `deno test supabase/functions/` (`npm run test:functions` is a separate script and isn't in the CLAUDE.md pre-commit command `npm test && npm run test:e2e`). The new lib.test.ts suites only run if invoked explicitly. |
| run-campaign send-recording | lib.test.ts exists but the `recipients.slice(0, sent)` recording logic (N2) lives in index.ts, outside the tested lib. Extract `recordableSends(batches, results)` into lib.ts and test the partial-failure case. |
| Batch-segment cross-request stability | deno tests cover single-snapshot slicing only; nothing asserts ordering of the profiles query (N1). |
| E2E | No mocked-e2e coverage of the measure flow, Deep Test, or sweeps (e2e/ covers feed/composer/EULA/presence paths). Acceptable for native-bridge code, but the JS state machine could be driven with a stubbed `_tgNativeCallback`. |

---

## Summary Table

| ID | Severity | Finding | File:Line | Status |
|----|----------|---------|-----------|--------|
| N1 | High | `may_onward_NofM` batches: unordered query + no send tracking → duplicate/missed emails | send-broadcast/index.ts, lib.ts | 🟢 FIXED 2026-06-12 (history-based exclusion + next-chunk batches) |
| N2 | High | run-campaign `slice(0, sent)` mis-records sends on partial batch failure → skips + duplicates | run-campaign/index.ts | 🟢 FIXED 2026-06-12 (per-batch upsert recording) |
| N3 | Medium | Deep Test not exempt from auto-stop/share-popup → truncated runs, popup mid-test | index.html:23298,22686,24155 | 🔴 Open |
| N4 | Medium | No mutual exclusion across pz/mic/sweep/deep runners | index.html:21797-21976 | 🔴 Open |
| N5 | Medium | runMicSweep double-tap race (guard set after await) | index.html:21972-22001 | 🔴 Open |
| N6 | Medium | Unknown segment silently broadcasts to all opted-in users | send-broadcast/index.ts:87,120-121 | 🔴 Open |
| N7 | Low | Cancelled Deep Test still persists a partial result | index.html:21956-21966 | 🔴 Open |
| N8 | Low | rollout-check.py: internal sessions counted; silent partial pagination; crash = history gap | scripts/rollout-check.py:121-128,56-59 | 🔴 Open |
| N9 | Low | Native `error` event doesn't cancel batch loops → stale-data rows | index.html:22755-22768,21852-21876 | 🔴 Open |
| N10 | Low | watch-value rate limit non-atomic; no Anthropic fetch timeout | watch-value/index.ts:91-113,142 | 🔴 Open |
| N11 | Low | Test email lacks footer; dry_run ignores batch slice | send-broadcast/index.ts:100-103,186-197 | 🔴 Open |
| N12 | Low | Tuning poll can clobber swept knob mid-run | index.html:22260-22261 | 🔴 Open |
| RM5 | Medium | loadMyProfile upsert can clobber trigger profile | index.html:6160-6171 | 🔴 Carried |
| RM3 | Medium | saveMsrReading double-submit | index.html:24194-24224,3560 | 🔴 Carried |
| RM-NEW1 | Medium | Publish during `__LOADING__` poster extraction | index.html:10274+,10125,10546 | 🟡 Carried |
| RL1 | Low | 20 fire-and-forget writes w/o `.catch()` | index.html (multiple) | 🟡 Carried |
| RL4 | Low | extract-url-meta no timeout/size cap | extract-url-meta/index.ts:66-81 | 🔴 Carried |

**New: 2 High (both FIXED 2026-06-12), 4 Medium, 6 Low. Carried still-open: 3 Medium, 2 Low. Fixed since May 30 (verified): RH-A, RH4, RH2, RH3, RM1, RC1.**

---

## Priority Fix Order

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | ~~N2 — run-campaign per-batch send recording~~ ✅ DONE 2026-06-12 | 10 min | Stops dedup-table corruption (permanent skips + duplicate emails) |
| 2 | ~~N1 — batch dedup for date-windowed segments~~ ✅ DONE 2026-06-12 (via email_events history exclusion, not campaign tracking) | 20 min | Eliminates duplicate/missed broadcast emails across batches |
| 3 | N3 — `!_deepTestActive` (and `!_pzBatchActive`) in the 3 gates | 5 min | Deep Test runs full length; no popup mid-test |
| 4 | N6 — whitelist `segment` server-side | 10 min | Removes the "typo → email everyone" footgun |
| 5 | N4 + N5 — single runner mutex; set sweep flag before await | 15 min | Closes concurrent-runner races |
| 6 | RM3 — disable `msr-save-btn` during persist | 5 min | Prevents duplicate readings (3rd carry) |
| 7 | N9 — clear runner flags on native error event | 5 min | Stops unattended stale-data inserts |
| 8 | N8 — rollout script: exclude internal sessions, log failures to history | 10 min | Rollout numbers match their stated definition |
| 9 | RM5 / RM-NEW1 / RL1 / RL4 / N7 / N10-N12 | as scoped | Long-tail robustness |

---

## Auditor Notes

- The May 30 report carried RH4 and RH2 as open, but both were fixed on **May 15** (commits 33d84b2, 81a89fb) — the prior audit verified against stale line references. Both re-verified fixed against current source this audit.
- The N3 finding is the same bug class as commit 9912046's mic-batch hang ("Run 1 auto-stopped at convergence… popped the share modal"). When adding a new runner flag, every `!_micBatchActive` exemption must be extended — the proposed single `_tgRunnerActive` mutex (N4) would make this a one-place check and prevent the next recurrence.
- Unit suite: 1144/1144 pass (`npm test`, 2026-06-12). Deno lib tests were not executed as part of this audit (not in the npm pipeline — see Test Gaps).
