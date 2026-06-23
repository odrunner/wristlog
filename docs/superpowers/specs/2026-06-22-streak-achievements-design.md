# Streak Achievements — Design (v2)

**Date:** 2026-06-22
**Status:** Approved (design); implementation plan pending
**Supersedes:** `2026-06-22-live-streak-counter-design.md` (the homepage live-counter version, shipped then **reverted** — `da15807`). This v2 keeps the proven streak logic but moves the surface to the profile's achievements area and adds milestone badges.
**Scope:** Web app client only (`index.html` + `wrotate_test.js`). Reuses the **already-shipped** badge + `badge_earned` notification system. **No backend, schema, or edge-function change.**

## Background / why v2

The v1 homepage streak chip was reverted for two reasons: (1) it didn't look good on the feed, and (2) the founder saw "9" and thought it was wrong. Debugging proved **the 9 was correct** — their account (`d70b1a85…`) has a real gap on 2026-06-13 (no log row dated 06-13; a ~43h `created_at` gap spanning that day, Pacific), so the consecutive run June 14→22 is genuinely 9. The streak math is sound; only the *presentation* and *forgiveness model* needed rework.

Reddit's model informed the redesign: a strict consecutive-day streak that lives in an **Achievements section on the profile** (not the feed), with a small live progress indicator plus **milestone badges** at tiers (5/10/20/30/50/100/365…). We mirror that, reusing our badge system.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Headline metric | **Current consecutive streak** (Reddit-style, strict — a missed day resets to 0). Plus **best** (max historical) streak shown alongside. |
| What counts as a day | Any log entry that day (all `use_case`s — wear + measurement), local `'YYYY-MM-DD'` dates. Matches the existing streak badges. |
| Surface | **Profile only**, at the **top of the achievements/badge section** (`badgeWallProfileSection()`). **Not** the homepage/feed. Own-profile only (that section is already own-only). |
| Milestones | Consecutive-streak badges at **5, 10, 20, 30, 50, 100, 365** days (existing 7 & 30 kept as bonus tiers → effective set 5,7,10,20,30,50,100,365). Keyed off **best/max** streak (earned once, kept forever). |
| Milestone notifications | **Automatic** — each milestone is a badge, and earning a badge already fires the bell + push via the shipped `badge_earned` system (batched when several land at once). No new notification code. |
| Forgiveness | None for now (strict). A grace/"streak freeze" is a documented future option. |

## Non-Goals

- No homepage/feed surface (that was the reverted v1).
- No streak freeze / grace days (future).
- No backend, DB, edge function, or pg_cron.
- No public display on *other* users' profiles (the achievements section is own-only).
- No change to the `badge_earned` notification mechanism (reused as-is).
- The separate **daily reminder push** remains a future spec.

## Architecture

Pure client-side, reusing existing systems. One pure function computes current + best streak; the profile achievements section renders a header from it; new entries in the badge registry + the existing badge-award pass turn streak milestones into badges that self-notify.

### Component 1 — `computeStreaks(logs, today)` (pure)

Added to **both** `wrotate_test.js` (exported) and `index.html`, byte-identical, registered `VERBATIM` in `tests/mirror-drift.test.js`. Reuses `addDaysStr` (added in v1's Task 1 — but that was reverted, so it is re-introduced here).

```js
// logs: [{ date: 'YYYY-MM-DD', ... }] (all use_cases). today: local 'YYYY-MM-DD'.
// returns { current: number, best: number, status: 'none'|'active'|'at_risk' }
function computeStreaks(logs, today) {
  const dates = [...new Set((logs || []).map(l => l.date).filter(Boolean))].sort();
  if (dates.length === 0) return { current: 0, best: 0, status: 'none' };
  const present = new Set(dates);
  // best = longest consecutive run anywhere
  let best = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    if (addDaysStr(dates[i - 1], 1) === dates[i]) { run++; best = Math.max(best, run); }
    else run = 1;
  }
  // current = run ending at the latest date, only if that date is today or yesterday
  const latest = dates[dates.length - 1];
  const yesterday = addDaysStr(today, -1);
  if (latest !== today && latest !== yesterday) return { current: 0, best, status: 'none' };
  let current = 1, cursor = latest;
  while (present.has(addDaysStr(cursor, -1))) { current++; cursor = addDaysStr(cursor, -1); }
  return { current, best, status: latest === today ? 'active' : 'at_risk' };
}
```

`addDaysStr(dateStr, delta)` — noon-anchored (`new Date(dateStr + 'T12:00:00')`) local date shift, reformatted like `todayStr`. Pure; mirror-registered.

### Component 2 — Achievements-section streak header (presentation)

In `badgeWallProfileSection()` (`index.html:5439`, own-profile only), prepend a streak header built from `computeStreaks(logs, todayStr())`:
- `status === 'active'` → `🔥 {current}-day streak` + `· best {best}` (when `best > current`).
- `status === 'at_risk'` → dimmed flame + `🔥 {current}-day streak · keep it going` (+ best).
- `status === 'none'` (current 0): `Start a streak` (action-agnostic — any activity counts, not just logging; show `best {best}` if `best ≥ 2`). Keeps the section honest without a punishing "0".

Production-only markup in `index.html`; correctness of which branch shows is driven by the unit-tested `computeStreaks`.

### Component 3 — Milestone streak badges (reuse badge system)

Add to `BADGE_REGISTRY` (habit category) new consecutive-streak badges. Existing: `80` seven_day_streak, `81` thirty_day_streak. New refs (next free in the habit band): **`83` five_day_streak, `84` ten_day_streak, `85` twenty_day_streak, `86` fifty_day_streak, `87` hundred_day_streak, `88` year_streak (365)**. Each: name, flavor text, unlock condition ("Log activity N days in a row").

In `checkAndAwardBadges` the existing habit block already computes `maxStreak` inline for badges 80/81 (`index.html:5350-5363`). **Extend that block, do not refactor it** (keep the proven inline max-streak loop untouched to preserve 80/81 behavior): widen the guard `if (!alreadyEarned(80) || !alreadyEarned(81))` to fire whenever *any* streak badge is unearned (e.g. `if ([5,7,10,20,30,50,100,365 refs].some(r => !alreadyEarned(r)))`), then add `if (!alreadyEarned(REF) && maxStreak >= N)` checks for each new ref (5→83, 10→84, 20→85, 50→86, 100→87, 365→88) alongside the existing 7→80 / 30→81 lines. Awarding flows through the existing `awardBadge` → `newlyEarned` → `notifyBadgesEarned` path, so milestones notify (bell + batched push) with **no new notification code**. (The display uses `computeStreaks`; the award block keeps its own inline max-streak — both correct; not unified to avoid risk to shipped logic.)

### Data flow

- The achievements header recomputes whenever the profile re-renders (it's inside `badgeWallProfileSection()`), which already happens on profile open. No new hooks, no feed coupling.
- Milestone badges are evaluated in the existing `checkAndAwardBadges` passes (wear/measurement/post/retroactive) — unchanged trigger points.
- Retroactive scan (`retroactiveBadgeScan`) will back-award the new milestone badges to existing users on next load (e.g. the founder's best ≥ ~40 earns 5/7/10/20/30 at once → one batched push).

## Edge cases / errors

- Empty `logs` → `{0,0,'none'}` → header shows the "start a streak" state; no badges.
- Multiple logs same day → one distinct date (deduped).
- `best` ≥ `current` always (best is the global max; current is a specific run). Header only appends "best N" when it adds information (`best > current`).
- Local-date consistency (logs + today both local) → no UTC drift; `addDaysStr` noon-anchored across DST/month/year.

## Testing

- **vitest** (`tests/streak.test.js`) against `wrotate_test.js`:
  - active run (current+best, status active), at_risk (yesterday), broken (current 0, best preserved), single day, empty, same-day dedup, run-ending-at-latest vs older longer cluster (current small, best large), `addDaysStr` boundaries.
  - **best**-specific: a long past run + short current run → `best` = long, `current` = short.
- **Badge registry tests** (`tests/badges.test.js`): the new refs exist with required fields; registry count updated.
- **mirror-drift**: register `computeStreaks` + `addDaysStr` VERBATIM.
- **SW cache bump**.
- No automated E2E (thin render; logic unit-tested). Manual UAT on the dev server: own profile achievements header shows current/best; confirm the founder's retroactive milestone badges + batched push.

## Files touched

| File | Change |
|---|---|
| `wrotate_test.js` | `computeStreaks` + `addDaysStr` (exported) |
| `index.html` | `computeStreaks`/`addDaysStr` (mirror); streak header in `badgeWallProfileSection()`; new milestone badges in `BADGE_REGISTRY`; extend the habit streak block in `checkAndAwardBadges` to award them off `computeStreaks(...).best`; achievements-header CSS; SW bump in `sw.js` |
| `sw.js` | Cache version bump |
| `tests/streak.test.js` | `computeStreaks` unit tests |
| `tests/badges.test.js` | New milestone badge registry assertions |
| `tests/mirror-drift.test.js` | Register `computeStreaks` + `addDaysStr` |

## Follow-ups (out of scope)

- **Streak freeze / grace days** (forgiveness) — reduces the "one miss resets" sting.
- **Daily reminder push** — server-side (timezone capture + push prefs + bulk push). Separate spec; reuses this streak definition.
- Optionally surfacing the streak on the public/other-user profile view (currently own-only).
