# Live Streak Counter — Design

**Date:** 2026-06-22
**Status:** Approved (design); implementation plan pending
**Scope:** Web app client only (`index.html` + `wrotate_test.js` test mirror). **No backend, schema, edge function, or badge change.**

## Problem

WRotate rewards 7- and 30-day streaks with badges, but never shows the user their **current** streak. There's no live "🔥 N day streak" number like Reddit/Duolingo — the day-to-day hook that makes a habit feel alive. The only streak math today computes the *maximum historical* run for badge-awarding (`index.html:5352-5363`); no active/current streak is computed or displayed.

## Goal

Show the user their **current activity streak** as a live "🔥 N" counter on two surfaces — their own profile and the feed (the landing page) — that updates immediately when they log activity.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Streak semantics | Consecutive distinct **log days** ending at the most recent log. Stays shown as `N` while the last log is **today or yesterday** ("alive through yesterday"); resets to 0 once a full day is missed. |
| What counts as a day | **Any** log entry that day (all `use_case`s — wear **and** measurement; it's app activity, not strictly wearing). Matches the existing badge streak — **no badge change**. |
| Dates | The browser's **local** date (matches how `logs[].date` is stored — `'YYYY-MM-DD'` local, via `todayStr()`). |
| Surfaces | (1) Own profile stats row; (2) top of the feed page (the landing). Own-only/private. |
| States | Hidden at 0; solid 🔥 when logged today (`active`); dimmed flame + "· log today" when alive-but-not-logged-today (`at_risk`). |

## Non-Goals

- No reminder/push (separate next spec).
- No backend, DB schema, edge function, or pg_cron.
- No change to the streak **badges** (their all-log-days logic already agrees with this counter).
- No public/social surfacing (not shown on other users' view of your profile).
- No "longest streak" display (badges already cover the historical best).

## Architecture

Pure client-side. One pure function computes the streak from the already-loaded `logs` array; one helper renders the chip; two call sites place it. Recompute is cheap (small array) and happens through the existing render flow — no caching, no denormalization.

### Component 1 — `computeCurrentStreak(logs, today)` (pure)

Added to **both** `wrotate_test.js` (test mirror, exported) and `index.html` (production), kept byte-identical and registered in `tests/mirror-drift.test.js` (the repo's production↔mirror guard).

```js
// logs: [{ date: 'YYYY-MM-DD', ... }]  (all use_cases count)
// today: 'YYYY-MM-DD' local date string (caller passes todayStr())
// returns { count: number, status: 'none' | 'active' | 'at_risk' }
function computeCurrentStreak(logs, today) {
  const dates = [...new Set((logs || []).map(l => l.date).filter(Boolean))].sort(); // ascending
  if (dates.length === 0) return { count: 0, status: 'none' };
  const latest = dates[dates.length - 1];
  const yesterday = addDaysStr(today, -1);
  // Streak is only "alive" if the most recent activity was today or yesterday.
  if (latest !== today && latest !== yesterday) return { count: 0, status: 'none' };
  // Count the consecutive run ending at `latest`, walking backward one day at a time.
  let count = 1;
  let cursor = latest;
  const present = new Set(dates);
  while (true) {
    const prev = addDaysStr(cursor, -1);
    if (present.has(prev)) { count++; cursor = prev; } else break;
  }
  const status = latest === today ? 'active' : 'at_risk';
  return { count, status };
}
```

- `addDaysStr(dateStr, delta)` — a new pure date-string helper (none exists today; existing code uses `Date.setDate` on Date objects). Parse `'YYYY-MM-DD'` anchored at **noon local** (`new Date(dateStr + 'T12:00:00')`, the pattern `fmtDate`/`fmtMonYear` already use), `setDate(getDate() + delta)`, then reformat to `'YYYY-MM-DD'` from the local y/m/d exactly like `todayStr`. The noon anchor avoids DST/midnight-boundary drift. Added to `wrotate_test.js` + `index.html`, mirror-registered.
- Walking the date set backward (rather than diffing adjacent sorted entries) makes the "ending at latest" semantics explicit and handles gaps cleanly.

### Component 2 — `renderStreakChip(streak, variant)` (presentation)

Returns an HTML string for a given `{count, status}`:
- `status === 'none'` → `''` (renders nothing).
- `status === 'active'` → solid flame + `count`.
- `status === 'at_risk'` → dimmed/outline flame + `count` + a subtle "· log today" cue.
- `variant` selects markup/CSS class for the surface: `'profile'` (a `profile-stat` cell with a "Day streak" label) vs `'feed'` (a compact centered chip).

Production-only (DOM/markup), in `index.html`. A pure sub-part (e.g. the label/aria text) may be unit-tested if it carries logic; otherwise this is exercised via the surfaces.

### Component 3 — Surfaces

**Profile (own only):** in `renderProfilePageHTML` where `statsHtml` is built (`index.html:6749`, the `.profile-stats-row`), when `isOwn`, compute the streak and prepend/append a `profile-stat` cell via `renderStreakChip(streak, 'profile')`. Omitted entirely when `count < 1`.

**Feed (landing):** a persistent container `<div id="feed-streak-chip"></div>` inserted into `#page-feed` right after its `.page-header` (`index.html:2697`), centered to the feed's 470px column. A new `renderStreakChips()` function computes the streak once and sets `#feed-streak-chip`'s innerHTML via `renderStreakChip(streak, 'feed')`.

### Data flow / recompute

- `renderStreakChips()` is called: (a) on app load once `logs` are populated, and (b) whenever `logs` change — i.e. wherever a wear/measurement log is added or deleted and the app re-renders (the existing data-generation/render path). Logging today flips `at_risk`→`active` and bumps the count live.
- The profile stat recomputes whenever the profile page re-renders (it's built inside `renderProfilePageHTML`).
- Both read the same `logs` global and call `computeCurrentStreak(logs, todayStr())`.

### Error handling / edge cases

- Empty/absent `logs` → `{count:0, status:'none'}` → nothing rendered.
- Multiple logs same day (e.g. several watches, or a wear + a measurement) → one distinct date → counts once.
- Logged-out / no user → feed chip simply renders nothing (no `logs`); profile stat only on own profile.
- Day-boundary correctness relies on local dates consistently (both `logs[].date` and `today` are local `'YYYY-MM-DD'`), so no UTC drift.

## Testing

- **vitest** (`tests/` — e.g. a new `tests/streak.test.js` or an addition to an existing stats test) against the `wrotate_test.js` exports:
  - logged today, 5-day run → `{5, 'active'}`
  - last log yesterday only (today not logged) → `{N, 'at_risk'}`
  - last log 2+ days ago → `{0, 'none'}`
  - single day = today → `{1, 'active'}`
  - empty logs → `{0, 'none'}`
  - multiple watches same day → counts as 1
  - measurement-only day counts (mixed use_cases)
  - a gap then a recent run → counts only the run ending at latest
  - `addDaysStr` across month/year boundaries.
- **mirror-drift**: register `computeCurrentStreak` (and `addDaysStr` if newly added) so production↔mirror stay identical.
- **SW cache bump** (`sw.js` `wristlog-vNN`) for the HTML/JS change.
- E2E render check: optional — decided in the plan (assert the feed chip shows for a seeded multi-day `logs` set).

## Files touched

| File | Change |
|---|---|
| `wrotate_test.js` | Add exported `computeCurrentStreak` (+ `addDaysStr` if not already present) |
| `index.html` | Production `computeCurrentStreak`/`addDaysStr` (mirror); `renderStreakChip`; `renderStreakChips()`; profile stats-row chip (`:6749`); `#feed-streak-chip` container after the feed header (`:2697`); CSS for the chip + at-risk styling; call `renderStreakChips()` on load + on log change; SW bump in `sw.js` |
| `sw.js` | Cache version bump |
| `tests/streak.test.js` (or existing) | Unit tests above |
| `tests/mirror-drift.test.js` | Register the new shared function(s) |

## Follow-up (out of scope, next spec)

- **Daily streak reminder push** — server-side (pg_cron → new bulk-push edge function) that nudges users whose streak is at risk. Depends on: capturing per-user **timezone** (server runs UTC; `logs.date` is local), a **push preference / quiet-hours** model, and a "send-push-to-many" path that doesn't exist yet. Reuses this spec's streak definition.
