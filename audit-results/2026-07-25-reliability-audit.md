# WRotate Reliability Audit — 2026-07-25

**Scope:** 76 commits since 2026-07-19. Focus on the paths that send real email,
drive the daily/weekly analytics loop, gate native features, and paginate the feed.

**Method:** live DB queries to quantify every claim, full unit + mocked E2E runs,
and a diff-level read of the analytics scripts against their consumers.

---

## R1 — The win-back email segment uses a wear rule that disagrees with `isWearEntry` — **Medium** — **FIXED 2026-07-25 (DEPLOYED)**

`supabase/functions/send-broadcast/lib.ts:129`

The canonical definition of a wear, established by the 2026-07-19 remediation and
used by Stats, Track, Year in Review and Monthly Review:

```js
// index.html:7091
function isWearEntry(l) {
  return !!(l && l.watchId) && l.useCase !== 'measurement';
}
```

`filterOneAndDoneChurned` implements only half of it:

```ts
if ((l.use_case ?? "") === "measurement") continue;   // wears only
```

The `watch_id` requirement is missing — the function does not even `select` the
column. A post with no watch attached therefore counts as a wear.

**Measured against production data:**

```
watch-less non-measurement logs:      77
segment as shipped:                   30 users
segment under isWearEntry:            29 users
users wrongly INCLUDED:                3
users wrongly EXCLUDED:                2
```

So ~10% of the segment is misaddressed in both directions. The concrete failure: a
user whose only log is a watch-less post gets an email headed *"Your watches miss
you"* despite never having logged a wear — and a genuine one-and-done wearer who
also made one watch-less post is scored as `wearCount = 2` and never contacted, which
is precisely the user the campaign exists for.

This is the same failure mode the last audit self-diagnosed (#5/#6): a wear rule
re-implemented at a new call site instead of routed through the single definition.

**Fix:** add `watch_id` to the select and `if (!l.watch_id) continue;` to the loop.
Two Deno tests already cover this function — extend them with a watch-less row.

**Secondary, lower confidence:** recency is computed from `created_at`, while
`isWearEntry` consumers use `logs.date` (the wear date). For "has this user gone
quiet" activity recency is defensible, so I am not calling it a defect — but the two
fields diverge for backdated logs and the choice should be deliberate.

---

## R2 — The daily rollout tracker undercounts 2.0 adoption by 28%; the fix landed in only one of the two consumers — **Medium** — **FIXED 2026-07-25**

`scripts/rollout-check.py:57,172` vs `scripts/weekly-measurement-review.py`

Commit `337340e` (today) found that fast-converging Pro V2 sessions bypass the
phase-separated beat-error path and so never emit `psBE=`, and fixed the weekly
review to accept either marker:

```python
# weekly-measurement-review.py — FIXED today
if "psBE=" not in blob and "[TGALGO" not in blob: continue
```

`rollout-check.py` — which produces the number the user reads when they ask *"how's
2.0 adoption"* — was not updated and still keys on `psBE=` alone:

```python
V2_MARKER = "psBE="
...
"is_v2": V2_MARKER in blob,
```

**Measured over the last 30 days:**

```
sessions with psBE= (counted as 2.0):        1,107
sessions with [TGALGO but NOT psBE=:           437   ← invisible
true 2.0+ sessions:                          1,544
undercount:                                   28.3%

distinct external users counted:               105
distinct external users actually on 2.0+:      118   (11% undercount)
```

The 28.3% matches almost exactly the ~29% the weekly-review commit message cites, so
this is the same defect, fixed in one consumer and left in the other.

The script *does* track `v21` (`[TGALGO`) and `beta` separately, so the data is not
lost — but the headline `is_v2` rollout number, and the quality metrics derived from
`v2_meas` (rate sanity, convergence outcome, repeatability), are all computed from
the undercounted set.

**Second-order:** `facts = dict(cached)` reuses cached per-session dicts whose
`is_v2` was computed under the old rule, so changing `V2_MARKER` alone will not
reclassify history. The cache needs invalidating (or `is_v2` recomputing on load).

**Fix:** mirror the weekly-review predicate, then invalidate the fact cache once.
Remember to `cp scripts/rollout-check.py ~/.local/bin/wrotate-rollout-check.py`.

---

## R3 — The mocked E2E suite is red: 5 failures from a stale harness key, recorded as "flaky" — **Medium** — **FIXED 2026-07-25** (uncovered 3 more, also fixed)

`e2e/helpers.js:184`, `e2e/app.mock.spec.js:1943`, `e2e/uat-full.int.spec.js:365,389`

```
5 failed
  Boot popovers (mocked) › new-features overlay stays hidden after boot
  Post location (mocked) › composer shows Home/Work/Travel chips and a free-text input
  Post location (mocked) › tapping a preset chip fills the input and selects the chip
  Post location (mocked) › edit-post prefills the location from the stored value
  Comment deletion (mocked) › post owner sees delete menu ... and can delete it
155 passed (2.5m)
```

All five share one cause. Commit `ad656af` bumped the suppression key in the app:

```js
// index.html:14064
const key = 'wrotate_newfeatures_v3';   // was _v2
```

but the four E2E sites that pre-set that key still write `wrotate_newfeatures_v2`.
So `maybeShowNewFeatures()` now un-hides a full-screen overlay 800 ms into every
mocked test. The dedicated regression-guard test fails **correctly** — that test
exists precisely to catch this — and the other four fail because the overlay
intercepts their clicks:

```
<div ... id="new-features-modal"> intercepts pointer events
- retrying click action
```

This is not flakiness; it is deterministic and one-line fixable. It matters because
subsequent commit messages (`c50d128`: *"6 mocked failures are pre-existing/flaky,
confirmed vs baseline"*) treated it as background noise, which is how a red suite
stops being informative. It also violates the project rule *"Run tests before
committing — all tests must pass."*

**Fix:** update the four occurrences of `wrotate_newfeatures_v2` to `_v3`. Better:
have the harness clear/set the key by prefix so the next bump cannot desync.

*(Unit suite is clean: **1481 passed, 69 files**.)*

---

## R4 — `parseFloat` on the iOS version string breaks at 2.10 — **Medium** — **FIXED 2026-07-25** (needs web deploy)

Four gates compare a version *string* as a float:

| line | gate |
|---|---|
| `index.html:10901` | push primer availability (`>= 2.3`) |
| `index.html:24646` | `_native21()` — Pro V2 beta toggle (`>= 2.1`) |
| `index.html:25277` | Pro V2 beat-error display (`>= 2.3`) |
| `index.html:26307` | `tg_quality_v2` engine selection (`>= _TG_V2_MIN_BUILD`) |

The value is a hardcoded string from the native shell:

```swift
// ios/Wrotate/Wrotate/WebView.swift:130
window._iosAppVersion = '2.3';
```

`parseFloat('2.10')` is `2.1`, which is `< 2.3`. When the app reaches version 2.10,
the push primer, the Pro V2 beat-error display and the V2 engine gate all silently
turn themselves off — no error, no log, just features quietly disappearing on the
newest build. `parseFloat('2.25') === 2.25 < 2.3` fails the same way today.

Given the current cadence (2.0 → 2.1 → 2.3, with 2.3 pending), 2.10 is a handful of
releases away.

**Fix:** one shared `iosAtLeast(major, minor)` helper that splits on `.` and compares
componentwise, used by all four sites.

---

## R5 — `loadMoreFeed` can dead-end the feed early — **Low** — **FIXED 2026-07-26**

`index.html:10670`

Each page is fetched, merged, sorted, `.slice(0, 50)`-ed, and only *then* filtered
for blocked users, club membership and visibility. If a whole page filters down to
nothing:

```js
if (batch.length === 0) { feedHasMore = false; mountFeedLoadMoreSentinel(); return; }
```

infinite scroll stops permanently, even though older visible posts exist further
back. The realistic trigger is ~50 consecutive public posts from a single blocked
user. Low frequency, but the failure is silent and indistinguishable from "you've
reached the end".

**Fix:** on an empty post-filter batch, advance the cursor to the oldest *fetched*
row and retry once (bounded), rather than terminating.

**Verified sound in the same function:** the composite `date`/`created_at` keyset
(`feedKeysetFilter`) is correct; per-source `limit(50)` before a global sort cannot
starve a source, since the global top-50 is necessarily contained in the union of
each source's top-50; `dedupeNewFeedLogs` dedupes both against shown ids and within
the batch; and cursor advancement uses the last *surviving* item, so rows filtered
out at the tail are re-fetched rather than skipped.

---

## C1 — Pro V2 harmonic-reject guard: the median of two windows is just the larger one — **Medium (native, pre-ship)** — **FIXED 2026-07-25** (ships in 2.3)

`ios/Wrotate/Wrotate/TimegrapherEngine.swift:1487` (commit `61198c0`, queued for the
2.3 build — not yet in users' hands, which is why this is worth catching now)

```swift
let sorted = rates.map { $0.rate }.sorted()
let median = sorted[sorted.count / 2]
let longest = rates.max { $0.secs < $1.secs }!.rate
if rates.count >= 2 && abs(longest - median) > tgAgreeBand {
    return median
}
return longest
```

With `tgMaxWindowSec = 16.0` (the default) the candidate windows are `[2, 4, 8, 16]`,
but on a short or noisy session only two may pass the `abs(rate) <= 200` gate.

At `rates.count == 2`, `sorted[1]` is simply `max(rate₀, rate₁)` — there is no
majority for a median to express. If the 16 s window reads lower than the 2 s window
by more than the 12 s/day band, the guard discards the long-window estimate and
returns the **short**-window one. That inverts the intent twice over: the short
window is both the noisier estimate and the one more prone to harmonic lock, and the
guard's own rationale ("one window reading ~2x off") gives no reason to believe the
outlier is the longer one.

The `>= 2` threshold is doing the damage; the logic is sound from three windows up.

**Fix:** require `rates.count >= 3` before the guard can override, and take the true
median (average the two middles on even counts). On a clean watch this remains the
intended no-op.

This is worth resolving before the 2.3 build ships, since the guard's whole purpose
is to make low-BPH readings *more* trustworthy.

---

## Status

| Severity | Count |
|---|---|
| Medium | 4 (R1, R2, R3, R4) + 1 native pre-ship (C1) |
| Low | 1 (R5) |

**Suggested order:** R3 (one-line, unblocks the suite) → R1 (email goes to real
users) → C1 (before the 2.3 build) → R2 → R4 → R5.

---

## R-INC1 — SES sandbox silently dropped the tail of the Pro V2 broadcast — **High** — **FIXED 2026-07-26 (DEPLOYED)**

`supabase/functions/send-broadcast/index.ts` · found 2026-07-26, not by this audit

**What happened.** The 2026-07-19 migration (`49daeb5` → `93c36df`) switched every
email sender in the tree from Resend to AWS SES v2 (`us-west-2`). AWS production
access was never requested or granted, so the account is still in the SES sandbox,
where any recipient that is not a verified identity is rejected outright.

Deployed state had drifted apart from the tree: `run-campaign`, `send-email` and
`send-wear-reminders` were still on Resend only because their last deploy predated
the migration commit. `send-broadcast` did get the SES build, and the nightly
`drain-broadcast-queue` run at **2026-07-25 21:30 UTC** claimed the final 22
pending rows of the Pro V2 broadcast. SES rejected all 22 with
`Email address is not verified. The following identities failed the check in
region US-WEST-2`. Those rows were classified as permanent failures and set to
`status='failed'` — a status the drain never re-selects, so they were dropped for
good. The first 379 of the 401-row queue had already gone out on Resend between
07-17 and 07-24 (confirmed: every `email_events` row for that subject has a null
`sns_message_id`).

**Why it was invisible.** Nothing alerts on `broadcast_queue.status='failed'`, and
the queue draining to zero pending looks identical to the queue completing.

**Fix.** New `_shared/resend.ts`, interface-compatible with `_shared/ses.ts` (same
result shape, same retryable classification, same batch contract), so the
transport is a one-import switch in either direction. `send-broadcast` now imports
it; the SES client stays in the tree for when AWS approves production access. All
hardening added since the migration is retained (row claiming, crashed-drain
reaper, retryable-vs-permanent handling, per-row error capture).

The 22 rows were reset to `pending` after verifying none had unsubscribed, been
suspended, become internal, or already received the subject.

**Verification.** 405 deno + 1497 vitest pass; the deployed bundle was re-fetched
from the Management API and contains zero SES references; live `quota_only` drain
returns `{provider: "resend", pending: 22}`.

**Follow-up, same day — `run-campaign`, `send-email`, `send-wear-reminders` moved
to Resend-primary (`c542cda`).** These three held undeployed SES code, so the next
`functions deploy` on any of them would have moved drip campaigns, notification
email and wear reminders onto sandbox SES. They now import `_shared/resend.ts`.
Not redeployed — production was already running their pre-migration Resend code,
so the tree change removes the hazard without altering live behavior.

**Still open — carried forward:**
- `new-user-alert`, `report-notify` and `send-report` are deployed on SES. They
  only reach verified admin addresses, so they work today, but they are one
  recipient change away from the same silent failure.
- No alert exists on `broadcast_queue.status='failed'`. A queue that drains to
  zero pending looks the same whether it completed or gave up.
- The SES transition is still the intended destination. When AWS grants production
  access, each of the four user-facing senders flips back via the two-line import
  swap marked in its header comment — no code was deleted.
