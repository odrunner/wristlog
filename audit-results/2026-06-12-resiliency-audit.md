# Resiliency Audit — WRotate

**Date:** June 12, 2026
**Auditor:** Claude (automated)
**Scope:** Failure / degradation / recovery behavior — offline handling, dependency outages, data-loss protection, recovery paths, infra (LaunchAgents, single-machine dependencies), backups/rollback.
**Note:** This is the **first dedicated resiliency audit** of this codebase. Prior reliability audits (latest `2026-05-30-reliability-audit.md`) covered correctness-under-error (races, unchecked `.error`, double-submits); this pass focuses specifically on *what happens when things fail and how the system recovers*. Overlapping items are referenced, not re-reported.

Surfaces read this audit: `sw.js` (full), `index.html` (cloud sync 5848–6032, save layer 11860–11898, init/online handling 21652–21728, batch/sweep/Deep Test 21790–22060, remote tuning poll 22241–22270, tick-log telemetry 22295–22320 & 23977–24040, measurement save 24190–24230, offline/global handlers 24626–24685), `supabase/functions/run-campaign/index.ts` (full), `scripts/rollout-check.py`, `scripts/nightly-analysis.py`, all three `com.wrotate.*` LaunchAgent plists, `ios/Wrotate/Wrotate/WebView.swift` + `TimegrapherBridge.swift` (failure paths), live RLS policies on `timegrapher_tuning` / `timegrapher_tick_logs` / `deep_test_chunks` / `measurement_batch_runs` (queried remote DB), `tests/sw.test.js`.

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 0 | — |
| High | 2 | RES-H1, RES-H2 |
| Medium | 7 | RES-M1 … RES-M7 |
| Low | 6 | RES-L1 … RES-L6 |

**Overall posture: YELLOW.** The *user-data* path (collection, wear logs, wishlist) is genuinely offline-first and well-hardened: localStorage-first boot, persisted dirty/delete queues, exponential-backoff retry, online-event resync. The weak spots are everything *around* that core: measurement telemetry and Deep Test/sweep results are single-shot fire-and-forget writes with no retry or local buffer (silent permanent loss on a network blip), and the entire scheduled-analytics layer lives on one Mac Mini with no missed-run recovery, no failure alerting, no log retention across reboots, and an unbacked-up history file. There is no documented backup or rollback procedure anywhere in the repo.

| ID | Severity | Finding | Where |
|----|----------|---------|-------|
| RES-H1 | High | Measurement telemetry & Deep Test/batch results: single-shot fire-and-forget inserts, no retry/queue → silent permanent data loss | index.html:21865, 21938, 21962, 24017 |
| RES-H2 | High | Scheduled analytics: single Mac Mini, missed runs silently skipped, no failure alerting, history file not backed up, /tmp logs lost on reboot | LaunchAgent plists, rollout-check.py:26 |
| RES-M1 | Medium | "Nightly" analysis is actually weekly (Mondays) — CLAUDE.md/plist drift; daily-briefing workflow reads up-to-7-days-stale (or missing) log | nightly plist, nightly-analysis.py:1-2 |
| RES-M2 | Medium | Remote tuning row applied to all native users with no range validation and no kill switch | index.html:22247-22270, 23747-23793 |
| RES-M3 | Medium | Tick-log flush clears buffer before insert is confirmed; no `.catch()` | index.html:22312-22319, 23997-24001 |
| RES-M4 | Medium | run-campaign: double-send window on crash/timeout; send-record bookkeeping wrong on mid-batch failure — 🟡 MOSTLY FIXED 2026-06-12 (per-batch upsert recording; sequential getUserById wall-clock risk remains) | run-campaign/index.ts |
| RES-M5 | Medium | No documented DB backup/restore story or deploy rollback procedure | repo-wide |
| RES-M6 | Medium | Sweeps/Deep Test (up to multi-hour unattended) have no checkpoint/resume; can complete with zero rows saved and no visible signal | index.html:21970-22027 |
| RES-M7 | Medium | Analytics pipeline (nightly + rollout) trusts the anon-writable `timegrapher_tick_logs` table | DB policies; scripts/*.py |
| RES-L1 | Low | `saveLog` aborts entirely when photo upload fails — wear log can't be saved offline with a photo attached | index.html:14348-14353 |
| RES-L2 | Low | `withTimeout` doesn't abort the underlying fetch; `bootDemoMode` fetch has no timeout at all | index.html:5513-5527, 5584 |
| RES-L3 | Low | SW precache `addAll` is all-or-nothing; manual cache bump (carried RL6, accepted) | sw.js:9-12, sw.js:4 |
| RES-L4 | Low | Rollout history file gets duplicate lines on same-day re-runs | rollout-check.py:150-152 |
| RES-L5 | Low | Test-account credentials hardcoded in both scheduled scripts — rotation silently breaks both jobs | rollout-check.py:23-24, nightly-analysis.py:23-24 |
| RES-L6 | Low | Dev-server log unbounded (8.8 MB and growing), no rotation | devserver plist |

---

## HIGH

### RES-H1 — Measurement telemetry and Deep Test/batch results are single-shot, fire-and-forget writes: a network blip = silent, permanent data loss

**Severity:** High · **Category:** Data-loss protection · **NEW**

**Evidence (all verified this audit):**
- Deep Test chunk inserts — `db.from('deep_test_chunks').insert({...}).then(({ error }) => { if (error) console.warn(...) })` (index.html:21938-21941). No retry, no local buffer, error only in console.
- Deep Test **final result** insert into `timegrapher_results` — same pattern (index.html:21962-21965). The on-screen readout shows the result, "Deep Test saved" toasts only on success; on failure the aggregate of a 5–10-minute multi-run test is gone with only a `console.warn`.
- Mic batch / sweep rows — `db.from('measurement_batch_runs').insert({...}).then(({ error }) => console.warn(...))` (index.html:21865-21872). Each 90-second run's data is one unretried insert.
- Session summary — `db.from('timegrapher_tick_logs').insert({... type:'session_summary' ...}).then(() => {})` at stop (index.html:24017-24038). **No error handler at all.** If this one insert fails, the session never existed as far as the nightly analysis and the 2.0 rollout tracker are concerned (both scripts key on `session_summary` lines — scripts/rollout-check.py, scripts/nightly-analysis.py).

Contrast with the user-data path, which has a persisted dirty-set + pending-delete queue with backoff retry (index.html:5912-6032). None of that machinery covers the measurement tables. The phone doing unattended sweeps on flaky Wi-Fi is precisely the degraded-network scenario this code runs in.

**Note:** the user-facing manual save (`persistMsrReading`, index.html:24209-24214) is acceptable — it awaits, toasts the error, and the modal keeps its values so the user can retap Save. The gap is everything automated/background.

**Recommended fix.** A minimal shared retry helper for measurement writes: on insert error or thrown network exception, push `{table, row}` onto a localStorage-persisted queue (mirroring `_pendingDeletes`) and flush it on `online` / next app boot / next measure-modal open. For Deep Test specifically, also keep `pooledRates`/chunks in localStorage until the final insert confirms, so a killed tab mid-test can at least report what it had.

### RES-H2 — Scheduled-analytics layer: one Mac Mini, no missed-run recovery, no failure alerting, unbacked-up history, logs vanish on reboot

**Severity:** High · **Category:** Infra resiliency · **NEW**

**Evidence:**
- All three jobs (`com.wrotate.devserver`, `com.wrotate.nightly-analysis`, `com.wrotate.rollout-check` in `~/Library/LaunchAgents/`) run on the single Mac Mini. Production hosting (auto-deploy from GitHub) is unaffected, but **all measurement analytics and rollout tracking stop silently if the machine is off, logged out, or wedged after a macOS update.**
- `com.wrotate.rollout-check.plist` has `RunAtLoad=false` and `StartCalendarInterval` Hour 9. launchd runs a missed calendar job on wake from *sleep*, but **not** across a reboot/shutdown spanning 9am — that day's line in the adoption trend is simply missing, and nothing flags it.
- Both job plists send stdout+stderr to `/tmp` (`/tmp/wrotate-rollout.log`, `/tmp/wrotate-nightly-analysis.log`). **/tmp is cleared on reboot** (and periodically by macOS), so "show the daily analysis" (CLAUDE.md workflow: read `/tmp/wrotate-nightly-analysis.log`) breaks entirely after any reboot until the next Monday-5am run.
- `~/.local/share/wrotate-rollout-history.log` (rollout-check.py:26, append at :150-152) is the **only** copy of the 2.0 adoption trend. It is not in the repo, not synced, not backed up. One disk failure erases the rollout history.
- Script failures are invisible: `curl_json` uses `subprocess.run(..., check=True)` (rollout-check.py:43-46) — any curl failure raises, the traceback lands in the /tmp log, and **no one is alerted** (the nightly script emails a report on success, but neither job reports its own failure).

**Recommended fix.** (1) Move both jobs' logs out of /tmp (e.g. `~/.local/share/wrotate-logs/`) or have the scripts append their output to a persistent file the way rollout history already does. (2) Set `RunAtLoad=true` on rollout-check with a same-day-already-ran guard (it already has the history file to check), so a reboot doesn't lose the day. (3) Back up `wrotate-rollout-history.log` — cheapest: have the script also upsert the daily line into a small Supabase table (the DB is the system of record anyway). (4) Add a failure hook: wrap each script's `main()` in try/except that sends the existing report email with the traceback on failure.

---

## MEDIUM

### RES-M1 — "Nightly/daily" analysis actually runs weekly (Mondays) — config and docs have drifted

**Severity:** Medium · **Category:** Infra / observability drift · **NEW**

**Evidence:** `com.wrotate.nightly-analysis.plist` has `StartCalendarInterval` with **`Weekday=1`**, Hour 5 — Mondays only. The script's own docstring agrees: *"Weekly timegrapher measurement analysis — runs via launchd every Monday at 5am"* (scripts/nightly-analysis.py:1-2). But CLAUDE.md states *"A Python script runs daily at 5am"* and the label/log name still say "nightly". Confirmed empirically: `/tmp/wrotate-nightly-analysis.log` last modified Mon Jun 8 05:00 (today is Fri Jun 12). Anyone (or any agent) following CLAUDE.md's "show the daily analysis" instruction is reading data up to 7 days stale — or a missing file post-reboot (RES-H2) — and the LOOKBACK_DAYS=7 window only works because of the weekly cadence, which the docs contradict.

**Recommended fix.** Pick one: restore daily (`remove Weekday`) or update CLAUDE.md + label + log name to "weekly". Either way, make the docs match the plist.

### RES-M2 — Remote tuning table drives every native user's measurement engine with no client-side validation or kill switch

**Severity:** Medium · **Category:** Remote-config dependency · **NEW**

**Evidence:** During every measurement, all users poll `timegrapher_tuning` row 1 every 3s (index.html:22247-22270). `peak_ratio_threshold` and `buffer_seconds` are applied **unconditionally** (not flag-gated, lines 22256-22257) and shipped to the native engine via `sendMsrTuning()` (index.html:23747-23793) with **no range clamping** — `Number(...)` of whatever arrives. A fat-fingered admin SQL update (`peak_ratio_threshold = 0`, `buffer_seconds = 100000`) degrades every in-flight native measurement within 3 seconds, and the only recovery is another SQL update. Mitigations verified: RLS on the table is SELECT-only for clients (confirmed by live `pg_policies` query — no INSERT/UPDATE policy, so only service-role/SQL-console writes), and the *fetch-failure* path is fine — `catch (e) {}` keeps the last/default values, defaults are baked into the HTML inputs, and the sweep-config fetch has an explicit localStorage+default fallback (index.html:21983-21990).

**Recommended fix.** Clamp at the client: a small `_clamp(v, lo, hi, def)` applied to each remote field before use (e.g. `peakRatioThreshold` ∈ [1, 10], `bufferSeconds` ∈ [5, 120]). Optionally add a `tuning_enabled` boolean to the row as an explicit kill switch that falls back to baked defaults.

### RES-M3 — Tick-log flush clears the buffer before the insert is confirmed, with no `.catch()`

**Severity:** Medium · **Category:** Telemetry loss / degraded-network behavior · **NEW**

**Evidence:** The 3-second flush does `_tgTickDebugBuffer = []` **before** `db.from('timegrapher_tick_logs').insert(...).then(() => {})` resolves (index.html:22312-22319); same pattern for the final flush at stop (index.html:23997-24001) and the BPH-change flush (23808-23812). On a failed insert that segment of the tick log is gone — these logs feed the nightly analysis and the 2.0 rollout marker detection (`psBE=`), so holes degrade both. Additionally, a thrown network error from the unawaited thenable surfaces as an unhandled rejection → the global handler toasts **"BG fail: …"** to the user (index.html:24650-24656), repeatedly, every ~3s while measuring on a dead connection (same class as May 30 RL1).

**Recommended fix.** Flush via a helper that restores the batch into the buffer on failure (capped — security audit N21 already wants a buffer cap) and swallows the rejection: `.then(({error}) => { if (error) requeue(batch); }).catch(() => requeue(batch))`.

### RES-M4 — run-campaign: crash/timeout mid-send double-sends; send-record bookkeeping is wrong on mid-batch failure

**Severity:** Medium · **Category:** Edge-function failure behavior · **NEW** (extends the send-broadcast note in the May 30 reliability audit)

> 🟡 **MOSTLY FIXED 2026-06-12** (deployed): sends are now recorded **per successful batch** inside the `res.ok` branch via `upsert(..., { onConflict: "campaign_id,user_id", ignoreDuplicates: true })` with the error checked and logged — the prefix-slice misattribution and the silent-insert failure are gone, and a crash between batches now loses at most one batch's records (replay is duplicate-tolerant thanks to the upsert). Remaining: the sequential `getUserById` loop (wall-clock risk on large cohorts) — see also the same loop in send-broadcast (already parallel ×50 there).

**Evidence (supabase/functions/run-campaign/index.ts):**
- Sends are recorded in `email_campaign_sends` only **after all batches finish** (lines 171-177). The per-user `auth.admin.getUserById` loop (112-117) is sequential — N round-trips — so a large cohort risks the edge wall-clock limit; if the function is killed after Resend batches went out but before the insert, the next daily run re-sends to everyone (the dedup at lines 94-102 sees nothing).
- `recipients.slice(0, sent)` (line 172) assumes failures only occur in trailing batches. If batch 1 of 3 fails and batches 2-3 succeed, the first 200 recipients are recorded as sent (100 of whom weren't) and the last 100 actual recipients are not recorded (→ re-send next run).
- The `insert(sendRecords)` result is unchecked (line 176) — a failed insert is silent and guarantees a full double-send next run.

**Recommended fix.** Record per batch, immediately after each successful Resend call, using that batch's actual recipients; check the insert error and log loudly. Replace the per-user `getUserById` loop with a single `auth.admin.listUsers` page or an RPC join to cut wall-clock risk.

### RES-M5 — No backup or rollback story anywhere in the repo

**Severity:** Medium · **Category:** Backups / recovery · **NEW**

**Evidence:** Searched repo-wide: no backup scripts, no `pg_dump`, no restore docs; `sql/` contains only schema/seed files; `docs/` has only the test-coverage plan. The only data export in the repo is `wristlog-data.json`, dated **Feb 25** — 3.5 months stale. Whether the Supabase project has PITR or only daily snapshots is not verifiable from the repo and is undocumented. Rollback for a bad deploy is likewise undocumented — the working procedure (note stable hash → `git revert`/reset → bump `sw.js` cache → push) exists only as convention in CLAUDE.md fragments and memory (`project_stable_builds.md`). For the SW side, rollback is actually safe (nav is network-first, activate deletes old caches — sw.js:15-23, 35-49), but nobody has written down that a rollback push **must still bump the cache version forward**, or iOS/standalone clients with the bad version cached can keep it for up to 5s-timeout offline windows.

**Recommended fix.** (1) Confirm and document the Supabase backup tier (PITR vs daily) in CLAUDE.md or `docs/`. (2) Add a tiny scheduled export (the Mac Mini already runs jobs) dumping critical tables (`profiles`, `watches`, `logs`, `timegrapher_results`, `notifications` schema) to a dated local file — even weekly beats a February JSON. (3) Write a 10-line `docs/rollback.md`: revert commit, bump SW cache forward (never backward), push, run smoke test.

### RES-M6 — Multi-hour unattended sweeps / Deep Tests have no checkpoint or resume; total silent failure is possible

**Severity:** Medium · **Category:** Recovery / long-running task · **NEW**

**Evidence:** `runMicSweep` (index.html:21970-22027) runs values × runs × runMs — the remote-config defaults (4 values × 12 runs × 90s + gaps) is ~75+ minutes; larger configs run for hours. There is no checkpoint: a crash, force-close, or tab kill loses the position entirely (the `q2_sweep_active` marker is deliberately *cleared* on next boot, index.html:21653-21655 — correct for safety, see Positive Findings, but it means no resume). Every row insert is fire-and-forget (RES-H1), and **nothing counts failures**: if RLS, auth expiry (a multi-hour run can outlive a refresh failure), or network kills every insert, the sweep happily runs to completion and toasts "Mic sweep done — check data" (index.html:22026) with zero rows saved. The phone-lock risk is partially mitigated — the native bridge disables the idle timer while the engine runs (TimegrapherBridge.swift:192, 229) and the inter-run gap is only 4s — but app backgrounding still suspends the JS loop silently.

**Recommended fix.** Track insert successes/failures in `_micRunBatchLoop`; if failures > 0, surface the count in the completion toast and console. Persist `{batchId, vi, runIdx}` to localStorage each run so a crashed sweep can offer "Resume sweep at value 3/4, run 7/12?" on next open. Optionally guard with `navigator.wakeLock` on web.

### RES-M7 — Analytics pipeline trusts an anon-writable table

**Severity:** Medium · **Category:** Pipeline resiliency (overlaps security) · **NEW** (security audits flagged size caps — N20/N21 — but not the pipeline-trust angle)

**Evidence:** Live policy check: `timegrapher_tick_logs` has `INSERT` policy "Anyone can insert tick logs" `WITH CHECK (true)` for role **public** (and public SELECT). The nightly analysis and rollout tracker parse this table's `messages` (including embedded `user_id` from `session_summary` JSON, scripts/rollout-check.py, nightly-analysis.py) to produce adoption and quality metrics. Anyone with the anon key (it's in the page source and committed in both scripts) can insert forged `session_summary` rows — inflating 2.0 adoption numbers, skewing the quality briefing, or bloating the table until the scripts' paginated fetches time out. The scripts have no schema validation on parsed JSON beyond key access with `.get()`.

**Recommended fix.** Require `authenticated` role on the INSERT policy at minimum (the app only writes these while signed in); ideally stamp `user_id` server-side via a column default `auth.uid()` instead of trusting JSON content, and have the scripts cross-check it.

---

## LOW

### RES-L1 — `saveLog` aborts entirely when the photo upload fails
**Evidence:** index.html:14348-14353 — `catch(e) { toast('Photo upload failed — ' + e.message, 'error'); return; }`. Offline (or storage outage), a wear log with a photo can't be saved at all, even though the logs table itself is fully offline-capable via the dirty-queue. The modal stays open so the text isn't lost (Low, not High).
**Fix:** On upload failure, offer "Save without photo?" or queue the photo file (object URL) for retry on `online`.

### RES-L2 — Timeouts don't abort the underlying request; demo login has none
**Evidence:** `withTimeout` (index.html:5513-5519) is a `Promise.race` — the losing fetch keeps consuming the connection. `authedFetch` (5521-5527) at least bounds the UI wait (30s default), but `bootDemoMode`'s fetch to `/functions/v1/demo-login` (index.html:5584) has **no timeout** — a hung edge function leaves the demo button waiting indefinitely (error path exists for thrown errors, 5596-5598, but not for a stall).
**Fix:** Thread an `AbortController` through `authedFetch`; wrap the demo-login fetch in `withTimeout(..., 15000)`.

### RES-L3 — SW: precache is all-or-nothing; manual cache bump (carried)
**Evidence:** `caches.open(CACHE).then(c => c.addAll(PRECACHE))` (sw.js:9-12) — if any of the 6 precache URLs ever 404s after a refactor (`/p/`, `/profile/`), `addAll` rejects and the **new SW never installs**; users silently stay on the old SW version. Impact is muted because navigations are network-first (sw.js:35-49), which is also why the manual version bump (sw.js:4, `wristlog-v771`; May 30 RL6, ⚪️ accepted) remains Low: forgetting a bump only risks stale assets *offline*, not online.
**Fix:** Precache individually (`Promise.allSettled` over `cache.add`) treating only `/` + `/index.html` as mandatory.

### RES-L4 — Rollout history gets duplicate lines on same-day re-runs
**Evidence:** `~/.local/share/wrotate-rollout-history.log` currently ends with **three** `2026-06-12` lines (script re-run after edits). Append at rollout-check.py:150-152 has no same-day dedup; trend consumers must dedup manually.
**Fix:** Before appending, drop an existing line with today's date (read-filter-write, file is one line/day).

### RES-L5 — Hardcoded test-account credentials in both scheduled scripts
**Evidence:** `AUTH_EMAIL`/`AUTH_PASS` (`test@wrotate.com` / password) committed in scripts/rollout-check.py:23-24 and scripts/nightly-analysis.py:23-24 (and pushed to GitHub). Resiliency angle: rotating that password (e.g. after the security finding that it's public) silently breaks both jobs, and with RES-H2's lack of alerting, nobody notices. Security angle belongs to the security audit.
**Fix:** Read creds from `~/.config/wrotate/env` (pattern already used for the Supabase access token per CLAUDE.md); fail loudly (email) if missing.

### RES-L6 — Dev-server log unbounded
**Evidence:** `/tmp/wrotate-devserver.log` is 8.8 MB and growing; `KeepAlive=true` restarts on crash (good) but nothing rotates the log. /tmp clearing on reboot is the only "rotation" — which simultaneously destroys crash history you might want.
**Fix:** Point logs at `~/.local/share/wrotate-logs/devserver.log` and add a monthly `truncate -s 1M` (or newsyslog entry).

---

## Positive Findings (verified this audit)

- **User-data path is genuinely offline-first.** Boot hydrates from localStorage (`watches/logs/wishlist/elo` at index.html:11761-11765); `save()` writes localStorage synchronously and debounces network sync (11881-11890); failed cloud loads **keep** the local cache per-table instead of zeroing it (5876-5882); deletes survive offline via the persisted `_pendingDeletes` queue (5932-5946, flushed pre-load at 5856-5866 and pre-upsert at 5974-5982); dirty IDs persist across restarts (5912-5926); cloudSync has in-flight guard, per-table success-gated clearing, exponential backoff capped at 60s, and a user-facing toast after 3 failed retries (5954-6032). The May 30 verify-item is confirmed fixed: `_syncRetryTimer` is cleared at cloudSync entry (5957-5958). `online` events trigger banner-hide + resync in both handlers (21720-21728, 24635-24642).
- **Crash self-heal for sweep state.** `initApp` explicitly removes a stale `q2_sweep_active` marker left by a force-close so a swept knob value can't silently poison the next user measurement (index.html:21652-21655) — exactly the right recovery posture (clear, don't resume, for correctness-critical state).
- **Remote-config fallbacks are sound.** Sweep config fetch is try/caught with localStorage + hardcoded defaults (21982-21999); `parseSweepValues` drops non-finite/zero/negative junk (23166-23169); `resolveTdm` validates positive-finite with default fallback (23171-23177); unknown knob names abort with a toast (21991-21995); the tuning poll swallows failures and keeps last-known values (22269). `timegrapher_tuning` is SELECT-only for clients (live RLS check) — users cannot poison it.
- **Boot/“stuck UI” safety nets.** Independent 6s global skeleton net with refresh UI for the signed-out case (24668-24685); Track A/B loader timeouts (5s/3s, 21686/21717); visibilitychange recovery resets feed guards and re-pulls data after long background (24604-24623); global `onerror` + `unhandledrejection` handlers (24645-24656).
- **Service worker design is resilient.** Network-first navigations with 5s race fallback to cache and final catch (sw.js:35-49); stale-while-revalidate for assets with `.catch(() => cached)` (53-64); cross-origin (Supabase/OAuth) never cached (31); old caches deleted on activate (15-23); SW registration failure swallowed (index.html:24661); SW behavior is unit-tested (tests/sw.test.js) including version-bump sync. A forgotten cache bump degrades gracefully (fresh HTML still fetched online).
- **`_pendingDeletes` boot-crash parse (May 30 RM1) confirmed fixed** — guarded try/catch + `Array.isArray` (index.html:5935-5939).
- **iOS wrapper failure paths exist:** offline screen with reload on `didFailProvisionalNavigation`/`didFail` (WebView.swift:47, 166-178); idle timer disabled during measurement so unattended runs don't sleep the screen (TimegrapherBridge.swift:192-199, 229-236).
- **Manual measurement save is loss-safe:** `persistMsrReading` awaits, toasts the error, and leaves the modal populated for retry (24194-24217).
- **Dev server self-restarts** (`KeepAlive=true`, RunAtLoad) — survives crashes and reboots.

---

## Priority Fix Order

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | RES-M1 — fix nightly plist/docs drift (decide daily vs weekly) | 5 min | Daily-briefing workflow stops lying |
| 2 | RES-H2 — persistent log paths + RunAtLoad guard + history backup to Supabase + failure email | 1–2 h | Analytics layer survives reboots; failures become visible |
| 3 | RES-H1 — localStorage retry queue for measurement-table inserts (start with `session_summary` + Deep Test result) | 1–2 h | Stops silent loss of the data the whole quality initiative depends on |
| 4 | RES-M3 — requeue tick-log batch on failed flush + `.catch()` | 20 min | Telemetry holes + BG-fail toast storm gone |
| 5 | RES-M6 — failure counter + honest completion toast in batch loop | 20 min | Multi-hour sweeps can no longer succeed with zero rows |
| 6 | ~~RES-M4 — per-batch send recording in run-campaign + checked insert~~ ✅ DONE 2026-06-12 (getUserById loop still sequential) | 30 min | Closes the email double-send window |
| 7 | RES-M2 — clamp remote tuning values client-side | 30 min | Bad admin SQL can't degrade all users' measurements |
| 8 | RES-M5 — document backups + rollback; periodic export job | 1 h | First real recovery story |
| 9 | RES-M7 — tighten tick-log INSERT policy to authenticated | 15 min | Analytics pipeline no longer trusts anon writes |
| 10 | RES-L1/L2/L4/L5/L6 — small hardening items | ~1 h total | — |

---

## Auditor Notes

- Every finding cites code/config read this audit; RLS claims were verified against the live database (`pg_policies`), and the LaunchAgent claims against the actual installed plists and live log timestamps (`/tmp/wrotate-nightly-analysis.log` mtime Jun 8 05:00 = last Monday; three duplicate Jun 12 lines in the rollout history file).
- Deployed script copies in `~/.local/bin/` were diffed against `scripts/` — **identical** (no drift today), but nothing enforces the copy step; consider a checksum check inside the scripts that warns when repo and deployed copies diverge.
- Overlap policy: composer/notification races, unchecked `.error` reads, and double-submit guards remain tracked in the reliability audit series (May 30) and were not re-audited here. send-broadcast's post-send tracking-insert gap noted there is the same failure class as RES-M4.
