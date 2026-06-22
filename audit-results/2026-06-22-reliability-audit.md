# Reliability / Resiliency Audit — WRotate

**Date:** June 22, 2026
**Auditor:** Claude (automated deep-dive)
**Scope:** Error handling, service worker, data integrity, offline/flaky-network behavior, scheduled Python jobs, edge-function robustness (incl. the new multi-drip campaign feature), client/DB state desync. Verified against current source (`index.html` 24,946 lines; `sw.js` v786; `supabase/functions/*`; `scripts/*.py`; live LaunchAgents/logs).
**Previous audits:** `2026-06-12-reliability-audit.md` (N1–N12 + carried RM/RL) and `2026-06-12-resiliency-audit.md` (RES-H1/H2, RES-M1–M7, RES-L1–L6). This pass marks each prior item **FIXED / PARTIAL / OPEN** with current-source evidence and adds NEW findings.

## Status Legend
🔴 Open · 🟡 Partial / Monitoring · 🟢 Fixed · ⚪️ Accepted

---

## (a) Prior Findings — Verified Status (this audit)

| Prior ID | Issue | Status | Evidence (current source) |
|----------|-------|--------|---------------------------|
| N1 | `may_onward_NofM` unordered/untracked → dup/missed emails | 🟢 FIXED (verified) | History-based exclusion (`excludeAlreadyEmailed`) + `nextBatchSlice`; `.order("created_at")` on profiles. Residual lag caveat only (see C2). |
| N2 | run-campaign `slice(0, sent)` mis-records on partial failure | 🟢 FIXED (verified) | run-campaign/index.ts:159-164 — per-batch `upsert(..., {onConflict:"campaign_id,user_id", ignoreDuplicates:true})` inside the `res.ok` branch; `batch.map(...)`, not the prefix slice. |
| N3 | Deep Test/piezo not exempt from auto-stop + share popup | 🔴 STILL OPEN | The 3 gates still check **only** `!_micBatchActive`: index.html:23471 (`_q2Tick` plateau stop), 22821 (legacy auto-stop), 24329 (share-popup). No `_deepTestActive`/`_pzBatchActive`. |
| N4 | No mutual exclusion across pz/mic/sweep/deep runners | 🔴 STILL OPEN | Each entry point checks only its own flag: runPiezoBatch (`_pzBatchActive` 21933), runMicBatch/runMicSweep (`_micBatchActive` 22015/22106), runDeepTest (`_deepTestActive` 22044). No shared mutex. |
| N5 | runMicSweep double-tap race (flag set after await) | 🔴 STILL OPEN | index.html:22106 guard check → `await` tuning fetch at 22117 → `_micBatchActive = true` only at 22135. The await window between guard and flag is unchanged; two taps both pass. |
| N6 | Unknown/typo segment silently broadcasts to everyone | 🔴 STILL OPEN | `validateBroadcastInput` (send-broadcast/lib.ts) validates subject/html/cohort/campaign_id but **not** `segment`; unknown segment falls through `batchSegment` returning the full opted-in list. High blast radius. |
| N7 | Cancelled Deep Test still persists a partial result | 🔴 STILL OPEN | index.html:22044 cancel sets flag false, loop breaks, but execution continues past `finally` (22086) to the `measureInsert('timegrapher_results', …)` at 22096 if `pooledRates` is non-empty. No `wasCancelled` skip. |
| N8 | rollout-check: internal sessions counted; silent partial pagination | 🟡 PARTIAL | Failure-email + history-line-replace landed. **Still open:** `v2_sessions_all/_today` increment regardless of `is_internal` (rollout-check.py:125-143); mid-pagination error still silently `break`s (`fetch_paginated` 53-67). See RES-L4a / R3. |
| N9 | Native `error` event doesn't cancel batch loops | 🔴 STILL OPEN | The native error handler still resets only `_msrListening`/UI; `_micBatchActive`/`_deepTestActive`/`_pzBatchActive` are not cleared, so unattended loops keep inserting stale-data rows. |
| N10 | watch-value rate limit non-atomic; no Anthropic timeout | 🔴 STILL OPEN | Unchanged read-then-update + no AbortController. Bounded (20/day, single user). |
| N11 | Test email lacks footer; dry_run ignores batch slice | 🔴 STILL OPEN | Unchanged in send-broadcast/index.ts. |
| N12 | Tuning poll can clobber swept knob mid-run | 🔴 STILL OPEN | Unchanged; narrow trigger (table edit mid-sweep). |
| RES-H1 | Measurement writes fire-and-forget, no retry | 🟢 FIXED (verified) | `measureInsert`/`queueMeasureWrite`/`flushMeasureWrites` (5961-5995) back all 5 background writes; flush on `online` (24816), boot (24623), modal open. **Gap remains** on in-session tick-log flushes — see R1. |
| RES-H2 | Analytics layer: /tmp logs, missed runs, no alerting | 🟡 PARTIAL | Persistent logs ✅, rollout `RunAtLoad=true`+same-day guard ✅, failure email ✅. **nightly-analysis plist still has no `RunAtLoad`** → a Monday-5am asleep/off = silently skipped weekly report (R2). Alert channel depends on the backend it monitors (R4). |
| RES-M2 | Remote tuning applied with no range clamp / kill switch | 🔴 STILL OPEN | `peak_ratio_threshold`/`buffer_seconds` still applied via `Number(...)` with no clamp; SELECT-only RLS is the only guard. |
| RES-M3 | Tick-log flush clears buffer before insert; no `.catch()` | 🟡 PARTIAL | Stop-time flush (24171/24191) now uses `measureInsert` (retry). **The periodic 3s flush (22450) and BPH-change flush (23983) still clear the buffer first and use bare `.then(() => {})`** → telemetry holes + "BG fail" toast storm. See R1. |
| RES-M4 | run-campaign double-send window; sequential getUserById | 🟡 PARTIAL | Per-batch recording fixed (= N2). **Sequential `getUserById` loop remains** (index.ts:112-117) — send-broadcast parallelizes ×50, run-campaign was not updated. Wall-clock risk on large cohorts. |
| RES-M5 | No documented backup/rollback story | 🔴 STILL OPEN | No `pg_dump`/restore docs; rollback procedure only in CLAUDE.md fragments. |
| RES-M6 | Multi-hour sweeps no checkpoint; can finish with 0 rows | 🟡 PARTIAL | RES-H1 retry queue now buffers failed inserts (helps a lot), but the completion toast still says "done — check data" with no success/failure count (22160); no resume on crash. |
| RES-M7 | Analytics trusts anon-writable `timegrapher_tick_logs` | 🔴 STILL OPEN | INSERT policy still `public WITH CHECK (true)` per prior live check; scripts parse forgeable JSON. |
| RM3 | saveMsrReading / persistMsrReading no double-submit guard | 🔴 STILL OPEN | `persistMsrReading` (24368-24392) never disables `msr-save-btn` (3565) during the awaited insert — fast double-tap inserts two `timegrapher_results` rows. `saveTimegrapherManual` (22907) likewise. |
| RM5 | loadMyProfile upsert can clobber trigger-created profile | 🟡 STILL OPEN (low likelihood) | index.html:6220-6231 — still `upsert({…client defaults}, {onConflict:'id'})`; only runs when the initial `.single()` returns no row, so the clobber needs a trigger-vs-fetch race. |
| RL1 | Fire-and-forget `.then(() => {})` without `.catch()` | 🟡 STILL OPEN | 18 occurrences in index.html (was 20). The hot ones during measurement are the tick-log flushes (R1). |
| RL4 | extract-url-meta: no fetch timeout / body-size cap | 🔴 STILL OPEN (low, admin-only) | Unchanged. |
| RL6 | SW cache version manual bump | ⚪️ Accepted | sw.js:4 `wristlog-v786` (was v771 on Jun 12 → +15 in 10 days; cadence healthy). |

**Prior-finding summary:** Fixed & verified: N1, N2, RES-H1 (core). Partial: N8, RES-H2, RES-M3, RES-M4, RES-M6, RM5, RL1. Still open: N3, N4, N5, N6, N7, N9, N10, N11, N12, RES-M2, RES-M5, RES-M7, RM3, RL4.

---

## (b) NEW Findings

### NEW-1 — HIGH: Two active drip campaigns with the same `delay_days` both email the same users on the same day (multi-drip feature has no cross-campaign dedup)
**Severity:** High · **Confidence:** High · **Category:** Idempotency / new-feature interaction · 🔴 NEW

**Files:** supabase/functions/run-campaign/index.ts:64-108 (per-campaign loop, dedup keyed on `campaign_id` at :97); index.html:14659-14673 (`createCampaign` — the new "+ New campaign" button, commit 70eab29).

The June drip-editor change lets an admin create multiple keep-warm campaigns. `run-campaign` loops every active campaign and dedups per `campaign_id` (`email_campaign_sends … .eq("campaign_id", campaignId)`, :94-98). There is **no cross-campaign dedup**: if two active drips share a `delay_days` (e.g. both `7`), the same signup-window cohort matches both, and a user receives **both emails on the same day**. The UI does nothing to prevent overlapping delays (the delay input is a free 1–90 number, index.html:14591), and new campaigns default to `delay_days: 30` (14666) — so two "30-day" drips collide by default if a second is created and activated.

**Impact:** Real users get 2+ keep-warm emails the same day; over weeks, a thicket of overlapping drips spams a cohort. This is the dominant risk introduced by the new feature.

**Fix:** Either (a) enforce unique `delay_days` among active drips (UI validation + a partial unique index on `email_campaigns(delay_days) WHERE is_active AND campaign_type='drip'`), or (b) dedup in run-campaign across *all* drips for the day — track "user got a drip today" and send at most one. (a) is cleaner given the keep-warm intent.

### NEW-2 — MEDIUM: run-campaign ignores errors on the `internal_accounts` and `alreadySent` queries → mass re-send / internal-account leak on a transient DB error
**Severity:** Medium · **Confidence:** High · **Category:** Unchecked error → silent fallthrough · 🔴 NEW

**File:** supabase/functions/run-campaign/index.ts:57-60 (internal accounts), :94-100 (already-sent).

Both destructure only `data`, ignoring `error`. If the `email_campaign_sends` SELECT (:94) transiently fails, `alreadySent` is `null` → `splitAlreadySent` treats **no one** as already-sent → the entire signup window is re-emailed (duplicate blast). Same shape for `internal_accounts` (:57): a failed fetch yields an empty exclusion set, so internal/test accounts can receive the drip. send-broadcast has the identical pattern on its internal-accounts and cohort-already-sent queries (NEW-3).

**Fix:** Check `error` on both; on error, log loudly and `continue`/abort the campaign for this run rather than proceeding with an empty exclusion set.

### NEW-3 — MEDIUM: send-broadcast tracking uses non-idempotent `insert` (not `upsert`) and ignores errors on support queries
**Severity:** Medium · **Confidence:** Medium · **Category:** Idempotency inconsistency · 🔴 NEW

**File:** supabase/functions/send-broadcast/index.ts (per-batch tracking insert ~:270-279; internal-accounts/cohort-already-sent queries ~:143, :149-153).

The June 12 per-batch-recording fix landed in run-campaign as an `upsert(onConflict, ignoreDuplicates)` but send-broadcast's cohort tracking still uses a plain `.insert()`. On a re-run where any user slipped through, the array insert can hit a unique-constraint violation and fail the **whole batch's** tracking insert (all-or-nothing), losing tracking for users who sent fine → duplicate cohort emails next run. Additionally the internal-accounts and cohort-already-sent SELECTs ignore `error` (same class as NEW-2), so a transient failure re-includes internal/already-sent users.

**Fix:** Align send-broadcast to the run-campaign pattern: `upsert(..., {onConflict, ignoreDuplicates:true})` for the tracking insert; check errors on the exclusion-set queries.

### NEW-4 — MEDIUM: Periodic in-session tick-log flush still drops data and triggers a "BG fail" toast storm on flaky network
**Severity:** Medium · **Confidence:** High · **Category:** Telemetry loss + UX degradation on bad network · 🔴 NEW (sharpens RES-M3, now partially fixed)

**File:** index.html:22446-22454 (3s periodic flush) and :23982-23984 (BPH-change flush).

The June 12 RES-H1/M3 work routed the *stop-time* tick-log flush through `measureInsert` (retry queue), but the **periodic 3-second flush** — which is the bulk of tick-log writes during a live measurement — still does `_tgTickDebugBuffer = []` **before** the insert (:22449) and uses a bare `db.from('timegrapher_tick_logs').insert(...).then(() => {})` (:22450-22453) with no `.catch()` and no requeue. On a dead/flaky connection during a measurement:
1. Each failed insert loses that 3s segment of tick data permanently (holes that degrade nightly analysis + 2.0 rollout `psBE=` detection).
2. The unawaited thenable's rejection bubbles to the global `unhandledrejection` handler (:24827-24833), which toasts **"BG fail: …"** to the user every ~3s while measuring offline.

**Fix:** Route these two flushes through `measureInsert` (or a requeue-on-failure helper) exactly like the stop-time flush — buffer on failure, swallow the rejection.

### NEW-5 — MEDIUM: rollout-check / nightly-analysis silently undercount on a mid-pagination error (page 2+ fails → partial data returned as complete)
**Severity:** Medium · **Confidence:** High · **Category:** Silent metric corruption · 🔴 NEW (extends N8)

**File:** scripts/rollout-check.py:53-67 (`fetch_paginated`); scripts/nightly-analysis.py:532-547.

Both paginators only treat an error as fatal on page 1 (`if not rows:`). If page 1 returns 1000 rows and page 2 returns an error dict (auth expiry, transient 5xx, gateway timeout), the loop `break`s and returns the rows so far **as if complete** — no exception, so `notify_failure` never fires. This becomes likely as the cumulative window grows past 1000 rows (tick logs are multiple rows per session and the window keeps growing). The rollout history line and the weekly email then reflect partial data with no warning.

**Fix:** Raise on a mid-pagination error (when `rows` is non-empty) so the top-level try/except emails the traceback, rather than silently `break`ing.

### NEW-6 — LOW: nightly-analysis has no missed-run recovery (`RunAtLoad` absent) and can't be naively enabled (it emails every run with no same-week guard)
**Severity:** Low–Medium · **Confidence:** High · **Category:** Infra resiliency · 🔴 NEW (carries the unfixed half of RES-H2)

**File:** `~/Library/LaunchAgents/com.wrotate.nightly-analysis.plist` (no `RunAtLoad` key; `Weekday=1` Hour 5).

rollout-check got `RunAtLoad=true` + a same-day history guard; nightly-analysis did not. If the Mac Mini is asleep/off at Monday 05:00, launchd does not run the missed calendar job → the whole weekly report is silently skipped, no alert. It can't simply be set `RunAtLoad=true` like rollout did, because the script **emails a report on every run** and has no same-week guard — a reboot would fire a duplicate weekly email.

**Fix:** Add a last-run timestamp/marker file the script checks (skip if it already ran this ISO week), then set `RunAtLoad=true`.

### NEW-7 — LOW: Failure-alert channel depends on the same backend it monitors (total Supabase outage = no alert)
**Severity:** Low · **Confidence:** High · **Category:** Alerting blind spot · 🔴 NEW

**File:** rollout-check.py:`notify_failure` (auth POST + send-report call); nightly-analysis.py same.

`notify_failure` re-auths and calls the `send-report` edge function to email the traceback. If Supabase/the edge runtime is fully down — the failure mode you most want alerted on — the alert POST also fails and the script only writes `[notify_failure] cannot alert` to the local log. No out-of-band path.

**Fix:** Add a dead-man's-switch (e.g. healthchecks.io ping on success; it pages on *absence* of a ping, independent of Supabase). Cheapest robust fix and also catches the script not running at all (NEW-6).

### NEW-8 — LOW: `createCampaign` / `saveCampaign` / broadcast-send buttons lack a double-submit guard
**Severity:** Low · **Confidence:** Medium · **Category:** Double-submit · 🔴 NEW

**File:** index.html:14659 (`createCampaign`), 14682 (`saveCampaign`); admin-only.

`createCampaign` does an unguarded `await insert` (no button disable) — a fast double-tap creates two "New keep-warm campaign" rows (and with NEW-1, two same-delay drips that double-email). Admin-only so impact is bounded, but combined with NEW-1 it's the easy path to the duplicate-email bug.

**Fix:** Disable the button during the await (same pattern wanted for RM3).

### NEW-9 — LOW: Global `onerror` shows a raw "Something went wrong" toast on every uncaught error
**Severity:** Low · **Confidence:** Medium · **Category:** UX noise on failure · 🔴 NEW

**File:** index.html:24822-24826.

Any uncaught error (including benign third-party/extension errors or a single transient hiccup) pops a user-facing "Something went wrong. Try refreshing." toast. Combined with NEW-4's "BG fail" storm, a flaky measurement session can spray error toasts. Consider rate-limiting/deduping these global-handler toasts (e.g. at most once per N seconds, suppress cross-origin script errors).

---

## (c) Verified-Solid / Caveats (this audit)

- **N2 genuinely fixed** — run-campaign records per successful batch via idempotent upsert; the prefix-slice misattribution is gone (index.ts:159-164).
- **RES-H1 core fixed** — `measureInsert` retry queue (cap 300, localStorage-persisted) backs all 5 background measurement writes; flushed on online/boot/modal-open. Solid recovery for the network-blip case.
- **Service worker is resilient (v786)** — network-first navigations with 5s race → cache fallback → final `.catch(caches.match)` (sw.js:35-49); SWR for assets with `.catch(() => cached)` (53-64); cross-origin never cached (:31); old caches deleted on activate (:15-23). Cache cadence healthy.
- **C2 (caveat, not a bug):** `_NofM` history-based dedup (N1 fix) is correct as designed but lag-sensitive — if two batches run inside the Resend webhook-ingestion window, batch 1's `sent` events may not be in `email_events` yet and batch 2 can re-include them. Documented in code; operational constraint (allow minutes between batches).
- **Same-day rollout history guard correct** — `write_history_line` replaces today's line if present (verified: one line/day in `wrotate-rollout-history.log`), so `RunAtLoad=true` re-runs don't duplicate (fixes prior RES-L4).
- **Deployed script copies match repo** — `diff` exit 0 for both `~/.local/bin/wrotate-{rollout,nightly-analysis}.py`. Persistent logs present at `~/.local/share/wrotate-logs/`.
- **User-data offline path remains hardened** — localStorage-first, persisted dirty/delete queues, backoff retry, online resync (unchanged from prior audit).

---

## Summary Table

| ID | Sev | Finding | File:Line | Status |
|----|-----|---------|-----------|--------|
| NEW-1 | High | Two same-delay active drips double-email a cohort (no cross-campaign dedup) | run-campaign/index.ts:64-108; index.html:14659 | 🔴 NEW |
| N6 | High | Unknown/typo broadcast segment → email everyone (no whitelist) | send-broadcast/lib.ts (validateBroadcastInput) | 🔴 Carried |
| N3 | Med | Deep Test/piezo not exempt from auto-stop + share popup | index.html:23471,22821,24329 | 🔴 Carried |
| N4 | Med | No mutual exclusion across pz/mic/sweep/deep runners | index.html:21933,22015,22044,22106 | 🔴 Carried |
| N5 | Med | runMicSweep double-tap race (flag set after await) | index.html:22106,22117,22135 | 🔴 Carried |
| NEW-2 | Med | run-campaign ignores internal/alreadySent query errors → re-send/leak | run-campaign/index.ts:57-60,94-100 | 🔴 NEW |
| NEW-3 | Med | send-broadcast tracking `insert` not `upsert`; support queries ignore errors | send-broadcast/index.ts:~143,~270 | 🔴 NEW |
| NEW-4 | Med | Periodic tick-log flush drops data + "BG fail" toast storm offline | index.html:22446-22454,23982-23984 | 🔴 NEW |
| NEW-5 | Med | Scripts silently undercount on mid-pagination error | rollout-check.py:53-67; nightly:532-547 | 🔴 NEW |
| RES-M4 | Med | run-campaign sequential getUserById → wall-clock timeout risk | run-campaign/index.ts:112-117 | 🟡 Carried (half) |
| RES-M2 | Med | Remote tuning applied with no range clamp / kill switch | index.html (sendMsrTuning/poll) | 🔴 Carried |
| RES-M5 | Med | No documented backup/rollback story | repo-wide | 🔴 Carried |
| RES-M7 | Med | Analytics trusts anon-writable timegrapher_tick_logs | DB policy; scripts | 🔴 Carried |
| RM3 | Med | saveMsrReading/persistMsrReading no double-submit guard | index.html:24368,3565 | 🔴 Carried |
| N7 | Low | Cancelled Deep Test still persists a partial result | index.html:22090-22099 | 🔴 Carried |
| N9 | Low | Native error event doesn't cancel batch loops | index.html (native error handler) | 🔴 Carried |
| N8 | Low | rollout: internal sessions counted | rollout-check.py:125-143 | 🟡 Carried (half) |
| NEW-6 | Low | nightly-analysis no missed-run recovery (needs same-week guard) | nightly-analysis plist | 🔴 NEW |
| NEW-7 | Low | Alert channel depends on the backend it monitors | scripts notify_failure | 🔴 NEW |
| NEW-8 | Low | createCampaign/saveCampaign no double-submit guard | index.html:14659,14682 | 🔴 NEW |
| NEW-9 | Low | Global onerror toasts on every uncaught error | index.html:24822-24826 | 🔴 NEW |
| N10–N12, RES-M6, RM5, RL1, RL4 | Low | (unchanged — see section a) | various | 🔴/🟡 Carried |

**New this audit: 1 High, 4 Medium, 4 Low. Still-open carried: 1 High (N6), 6 Medium, several Low.**

---

## Priority Fix Order

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | NEW-1 — unique `delay_days` among active drips (UI + partial unique index) | 20 min | Stops the new multi-drip feature from double-emailing a cohort |
| 2 | N6 — whitelist `segment` server-side (reject unknown) | 10 min | Removes "typo → email everyone" footgun (High blast radius) |
| 3 | NEW-4 — route periodic + BPH tick-log flush through `measureInsert` | 15 min | Stops telemetry holes + "BG fail" toast storm on flaky network |
| 4 | NEW-2 / NEW-3 — check errors on exclusion queries; send-broadcast upsert | 20 min | Stops transient-error mass re-send / internal-account leak |
| 5 | N3 + N4 — add `!_deepTestActive`/`!_pzBatchActive` to 3 gates; single runner mutex | 15 min | Deep Test runs full length; closes concurrent-runner races (also covers N5) |
| 6 | NEW-5 — raise on mid-pagination error in both scripts | 10 min | Metrics undercount becomes a visible alert, not silent corruption |
| 7 | RM3 + NEW-8 — disable Save / campaign buttons during await | 10 min | No duplicate readings/campaigns |
| 8 | RES-M4 — parallelize run-campaign getUserById (match send-broadcast ×50) | 15 min | Removes wall-clock timeout risk on large cohorts |
| 9 | NEW-6/NEW-7 — same-week guard + RunAtLoad on nightly; dead-man's-switch | 30 min | Weekly report can't be silently skipped; outages get alerted |
| 10 | N7, N9, RES-M2, RES-M5, RES-M6/M7, N10–N12, RM5, RL1/RL4 | as scoped | Long-tail robustness |

---

## Test Gaps (changed/at-risk paths with no coverage)
- **Multi-drip dedup** (NEW-1): no test asserts that two active drips with the same delay_days don't both fire — extract the cross-campaign dedup into lib.ts and test it.
- **Periodic tick-log flush requeue** (NEW-4): RES-H1 added a queue harness for the 5 wrapped writes, but the two unwrapped in-session flushes aren't exercised.
- **Segment whitelist** (N6): no test sends an unknown segment and asserts a 400.
- **Pagination mid-error** (NEW-5): no test feeds page-2-error to `fetch_paginated` and asserts it raises.
- **Runner orchestration** (N3/N4/N5/N7): the stop gates, mutex, and cancel-persist path remain untested (helpers are mirrored+tested; orchestration is not).

## Auditor Notes
- N1 and N2 (the two June-12 High items) are genuinely fixed and re-verified against current source. The June-12 resiliency High items are *half*-fixed: RES-H1 core landed but the in-session tick-log flush gap (NEW-4) and the nightly-analysis missed-run gap (NEW-6) survived.
- The single highest-leverage new risk is NEW-1: the new "create multiple keep-warm campaigns" UI shipped without cross-campaign dedup, so overlapping delays double-email real users. Pair the fix with NEW-8 (double-submit guard) since the duplicate-campaign path also creates the collision.
- Three findings (N3+N4+N5) collapse to one fix: a single `_tgRunnerActive` mutex plus extending the three auto-stop/share gates would close all three at once — the same recommendation as June 12.
