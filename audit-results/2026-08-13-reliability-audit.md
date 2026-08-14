# Reliability / Bugs Audit — 2026-08-13

Fresh audit. Findings verified in a real browser or against the live database.

**Baseline health is good:** 1,954 unit tests pass (93 files, 3.09s), the global
error handlers are wired (`window.onerror` + `unhandledrejection`,
`index.html:32465-32476`), and the service worker uses network-first for navigations
with a cache fallback, so a bad deploy does not strand users offline.

---

## R1 — HIGH (NEW): The app boots to an empty shell if site storage is blocked.

> **FIXED 2026-08-13** (a82fa38) — `window.safeLS` / `safeSS` added ahead of the pre-paint theme block; all 178 app call sites rewritten. With storage blocked: 2 errors / 84 chars → **0 errors / 809 chars**, identical to storage enabled. Regression tests in `e2e/storage-blocked.mock.spec.js`.

`localStorage` is touched **111 times with no `try`/`catch` within six lines**, and
there is no safe wrapper anywhere in the codebase (no `lsGet`/`lsSet`/`safeStorage`).
The first hit is on the boot path: `featureFlag()` at `index.html:6084-6088` calls
`localStorage.getItem()` directly, and it is called during init.

When storage access throws — Safari with "Block all cookies", some enterprise and
embedded-webview configurations, certain storage-partitioned third-party contexts —
the exception is uncaught and init dies partway through.

Proven in Chromium against the local dev server, with `localStorage` made to throw
`SecurityError` on access:

```
                     page errors   visible text
storage enabled          0            809 chars   (feed renders)
storage blocked          2             84 chars   (nav chrome only)
```

Blocked-storage output is just `"Wrotate / Feed / Track / Collection / Wishlist /
Stats / Post / People / Clubs / Pull to refresh"` — the navigation shell with no
content behind it. The user sees a broken app, and the only feedback is the generic
`toast('Something went wrong. Try refreshing.')`, which is wrong advice: refreshing
will fail identically, forever.

**Fix:** one wrapper, used everywhere.

```js
const safeLS = {
  get(k)    { try { return localStorage.getItem(k); }    catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  remove(k) { try { localStorage.removeItem(k); } catch {} },
};
```

Swap the 111 call sites (mechanical, and the test suite covers the behaviour around
most of them). Features that genuinely require persistence should degrade to an
in-memory object for the session rather than throwing. Worth an E2E test that boots
the app with storage poisoned, so this cannot regress.

---

## R2 — MEDIUM (NEW): Unhandled-rejection toast leaks internals to users.

> **FIXED 2026-08-13** (ac97017) — users now see "Connection problem — some things may not have loaded." or "Something didn't load properly."; full detail still goes to `console.error`, verbose form behind the `tg_debug` flag.

`index.html:32470-32476`:

```js
toast('BG fail: ' + msg + (stack ? ' @ ' + stack.slice(0, 60) : ''), 'error');
```

Every unhandled promise rejection shows the user a raw error message plus 60
characters of stack trace. This is a debugging aid that shipped. It is confusing for
users ("BG fail: Failed to fetch @ at loadFeed (https://wrotate.com/index…") and it
discloses internal function names and paths.

Note this is also the mechanism by which R1 surfaces — so users with storage blocked
get two of these on load.

**Fix:** keep the full detail in `console.error`, show the user a plain message.
Gate the verbose variant behind the existing `tg_debug` profile flag or a feature
flag so it stays available when you need it.

---

## R3 — MEDIUM (NEW): No double-submit protection on write actions.

> **OPEN** — still 0 in-flight guards across 475 buttons.

34 `disabled = true` assignments against 477 buttons, and **zero** in-flight guards
(`grep -cE '_saving|isSaving|_busy'` → 0). Most async write handlers can be fired
repeatedly before the first request resolves.

The realistic consequence on a phone on a slow connection is duplicate rows — double
wear logs, double posts, double friend requests — because the user taps again when
nothing appears to happen. Some of these are protected by DB constraints; most are
not.

Worth checking the data before deciding how much this matters: query for same-user
same-second duplicates in `logs` and `wear_logs`. If duplicates exist in production,
this moves up the list. If they don't, a standard guard on the write paths is still
cheap insurance.

**Fix:** a small `withBusy(btn, fn)` helper that disables the control and restores it
in a `finally`, applied to the write handlers.

---

## R4 — MEDIUM (NEW): The broadcast drain still has no attempt counter.

> **FIXED 2026-08-13** (9ccb9f9, deployed) — **the finding was partly wrong**: the 22-recipient drop was already fixed, transient failures already stayed `pending`. The real gap was the missing counter. `broadcast_queue.attempts` now counts *individually* permanent verdicts; at 3 the row retires and is logged. A tripped batch still retires nobody on strike one. 5 tests cover the distinction.

Carried forward from `CLAUDE.md` and confirmed still present in
`supabase/functions/send-broadcast/`. Two known-bad behaviours remain:

- A row marked `failed` is **never re-selected** — a recipient dropped permanently
  (this cost 22 people on 2026-07-25).
- There is **no attempt counter**, so a genuinely dead address retries indefinitely
  and the whole batch defers to `pending` whenever any non-retryable error appears.

These two interact badly: the safe behaviour (defer the batch) means one permanently
undeliverable address can stall its batch on every run.

**Fix:** add `attempts int default 0` to `broadcast_queue`; increment per attempt;
move a row to `failed` only at a threshold (3), and log which recipients were dropped
and why. This has a real send-path blast radius, so build it behind the existing
`quota_only` introspection call and confirm counts before a live drain.

---

## R5 — LOW: `.single()` throws where `.maybeSingle()` is meant.

> **OPEN** — still 11 `.single()` vs 15 `.maybeSingle()`.

11 `.single()` calls against 15 `.maybeSingle()`. `.single()` rejects when the row
count is not exactly 1, so any of the 11 sitting on a "row may legitimately be
absent" path becomes an unhandled rejection (and, per R2, a stack-trace toast).

The profile-creation path at `index.html:8144` handles this correctly — it re-selects
and checks. Audit the other 10 and convert the ones where zero rows is a normal
outcome.

---

## R7 — HIGH (NEW): The production schema is not in version control.

> **FIXED 2026-08-13** (5c62494) — `sql/schema.sql` now in the repo, generated by `scripts/dump-schema.py` from system catalogs (`supabase db dump` needs Docker, which is not installed). Verified 56/56 tables, 244/244 policies, 54/54 functions. Re-dump after any `db query --linked` change.

Found while planning the S1/S2 rollback. Migration history diverged from the repo in
May and never reconverged:

- `supabase/migrations/` holds 18 files; the remote has ~35 entries with no local
  counterpart, and ~14 local files were never applied remotely
- The last migration in remote history is **2026-05-14**
- Everything since — three months of schema change, plus the 72 ad-hoc files in
  `sql/` — was applied via `supabase db query --linked`, which records nothing

The sharpest illustration: of the 7 RLS policies the S1/S2 fix touches, most are
defined in **no tracked file at all**. `watches_public_read` and `profiles_select`
appear only in `sql/2026-08-13-privacy-rls-rollback.sql` — a file generated from the
live database during this audit. Before that file existed, the only authoritative
definition of those policies was the running instance.

There are 244 policies in `public`. The great majority are in the same position.

Two consequences:

1. **Disaster recovery is not possible from the repo.** If the project were lost,
   the schema could not be rebuilt — and per `CLAUDE.md`, PITR was declined and the
   off-Supabase backup project was abandoned on 2026-08-13 after causing an outage.
   There is no other copy.
2. **Supabase branching is unusable.** A branch builds from `supabase/migrations/`,
   so it comes up without the current policies. This is why branch-testing the S1 fix
   was rejected in favour of read-only simulation plus a transactional apply.

**Fix — cheap and low-risk, because it is read-only:** dump the live schema to the
repo and keep it current.

```bash
npx supabase db dump --linked -f sql/schema.sql            # schema only, no data
npx supabase db dump --linked --role-only -f sql/roles.sql
```

A schema-only dump reads catalogs, not table contents, so it does **not** repeat the
bulk-read pattern that caused the 2026-08-13 outage — that was `PostgREST` assembling
30 MB blobs, an entirely different operation. Commit the result, and re-dump after any
`db query --linked` change so the file stays authoritative. A weekly cron on the Mac
Mini that dumps and commits on diff would keep it honest without discipline.

This does not require reconciling migration history — that is a larger job and not
necessary. A current `schema.sql` in the repo solves the DR gap on its own.

---

## R6 — NOTE: single-host scheduling remains the largest structural risk.

> **OPEN.**

Unchanged and worth restating: every scheduled job (`rollout-check`, `cost-report`,
`weekly-review`) runs on one Mac Mini. If it is off, asleep, or the LaunchAgent fails
to reload after an edit, jobs silently do not run. The `pg_cron` jobs
(`run-email-campaigns`, `drain-broadcast-queue`, `send-wear-reminders-hourly`) are
server-side and unaffected — which is the right split, since those are the ones that
touch users.

The scripts email a traceback on uncaught failure, but there is no alert for the
"never ran at all" case. A dead-man's-switch — a cheap daily check that alerts when a
log file's mtime is older than expected — would close the gap.

## Priority

1. **R7** — one `db dump` command closes a total DR gap. Do it before the S1/S2 fix,
   so the pre-change schema is captured in the repo.
2. **R1** — a whole class of users gets a broken app. Mechanical fix, high value.
3. **R2** — trivial fix, and it is what R1 looks like to users.
4. **R4** — real recipients silently dropped; needs care because it touches sending.
5. **R3, R5** — cheap hardening.
6. **R6** — structural, worth a dead-man's switch when convenient.
