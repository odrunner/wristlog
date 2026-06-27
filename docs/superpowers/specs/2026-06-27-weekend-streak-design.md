# Earn-Your-Weekend Streak (4a) — Design

**Date:** 2026-06-27
**Status:** Approved. Behind `streak_weekend` flag for founder testing, then flag removed to ship.
**Scope:** Client-only. Generalize `computeStreaksFrozen` so a fully-logged work week earns the weekend as transparent "rest days." Calendar renders rest days. No backend.

## Background

Engaged weekday loggers (e.g. `crash`/SA: logs Mon–Fri, skips weekends) have their streak capped at one work-week because a weekend is two consecutive missed days that the freeze can't bridge. Modeling (12 active streakers) showed **earn-your-weekend** is the best-feeling weekend rule: it rewards exactly the behavior we want and keeps the streak honest. crash goes **5 → ~10** under it (vs 26 for blanket weekends-free, which we rejected as too generous).

## The rule (locked)

- **Earn the weekend:** log **all five weekdays (Mon–Fri)** of a week (actual logs). Then that week's **Sat/Sun become "rest days"** — they don't break the streak and don't need logging. Logging a weekend still counts as a bonus day.
- **Freezes unchanged:** the existing 2-per-run + regen freeze still bridges a single isolated *non-rest* missed day. Rest days are free (no freeze spent).
- **Count:** the streak number counts **logged days** only; rest days are transparent (don't add, don't break).
- **Status:** if today is an earned rest weekend, the streak is **active (resting)** — not at-risk. The chip stays lit; no "log today" pressure until the next weekday.

## Key implementation insight (backward-compatible)

Reframe the walk around a precomputed **`restSet`** (earned, unlogged weekend days). Then "consecutive" means *no non-rest day missing between two logged dates*, and the existing single-day freeze bridges *one non-rest missing day*. **With `restSet` empty (flag off), this is byte-for-byte the current behavior** — so the existing freeze tests still pass and there's zero risk to shipped streaks.

### `computeStreaksFrozen(logs, today, weekendEarn)` (pure, mirror-drift, tested)
Adds a third arg `weekendEarn` (default falsy → current behavior) and a `restDays` array to the return `{ current, best, status, frozen, freezes, restDays }`.

1. **Precompute `restSet`** (only when `weekendEarn`): for each logged **Friday** whose Mon–Thu are all logged, add that week's unlogged **Sat** and **Sun** to `restSet`.
2. **`nonRestBetween(a, b)`** = count of missing days strictly between two logged dates that are **not** in `restSet` (early-exit at 2).
3. **Walk** logged dates building the run: `nonRest === 0` → extend (rest days transparent); `nonRest === 1 && freezes > 0` → freeze that one day; else → break (new run, 2 fresh freezes). Regen +1 freeze per 7 logged days (cap 2), as today.
4. **Leading edge to `today`:** logged today → `active`; `restSet.has(today)` → `active` (resting); else by `nonRestBetween(lastPresent, today)`: 0 → `at_risk` (log today); 1 + freeze → freeze + `at_risk`; ≥2 → `none`.

(Verified by hand against crash: restSet = {06-20,06-21,06-27,06-28}; the Fri 06-12 miss is a 3-non-rest-day gap that correctly breaks; current run 06-15…06-26 = **10**, status active.)

### Surfaces
- **`displayStreak`** passes the flag: `computeStreaksFrozen(logs, today, featureFlag('streak_weekend'))`. Flag off → identical to today.
- **Calendar** (`renderStreakCalendar`): render `restDays` cells distinctly (a subtle "rest" style — e.g. a muted dot / lighter tint, distinct from logged 🔥, frozen ❄️, and plain-missed), so a streak that spans weekends reads correctly. A short legend/footnote: "weekends are free once you log the full week."
- **Chip / profile:** unchanged (they show the number, which now spans earned weekends).

## Non-Goals
- No blanket weekends-free, no 2-day-bridge rule.
- Freeze-covered weekdays do **not** count toward "completing the week" — the weekend must be *logged* Mon–Fri (keeps it earned; avoids freeze/weekend collision).
- No per-user "which days are my weekend" config; weekend = Sat/Sun (fine for ~all; locale edge cases ignored for v1).
- No change to milestone badges (still real logged days; unaffected).

## Edge cases
- **Flag off:** `restSet` empty → function identical to current → no change for anyone.
- **Logs a weekend day:** it's in `loggedSet`, counts as a normal logged day (+1); never a rest day.
- **Incomplete week (missed a weekday):** that week earns no rest days; the weekend then breaks the streak normally (or a single slip is freeze-bridged as today).
- **DST / locale:** dates compared as `'YYYY-MM-DD'`; `dow` via `new Date(s+'T12:00:00').getDay()` (noon-anchored, matches `addDaysStr`).

## Testing
- **Unit (vitest)** new `tests/weekend-streak.test.js` on `computeStreaksFrozen(..., true)`: full week → weekend bridged; incomplete week → weekend breaks; rest day today → active; Monday after earned weekend, unlogged → at_risk; logged weekend counts; `restDays` contents; **regression: `computeStreaksFrozen(logs, today)` (2-arg) unchanged** (run the existing freeze tests).
- **Mirror-drift:** the rewritten `computeStreaksFrozen` stays VERBATIM across both files.
- **Full suite** green (existing streak-freeze tests must still pass — proves backward compatibility).
- **Manual UAT (founder, flag on):** toggle `streak_weekend`; confirm crash-like accounts span weekends, the calendar shows rest cells, today (Sat) reads active not at-risk; flag off reverts exactly.

## Files / changes
| Area | Change |
|---|---|
| `index.html` + `wrotate_test.js` | rewrite `computeStreaksFrozen` (weekendEarn + restSet + restDays) — byte-identical |
| `index.html` | `streak_weekend` flag; `displayStreak` passes it; `renderStreakCalendar` renders `restDays` + legend; CSS for rest cell; SW bump |
| `tests/weekend-streak.test.js` | new unit tests |
| `tests/mirror-drift.test.js` | (computeStreaksFrozen already in VERBATIM — no add) |
| `sw.js` | cache bump |

## Rollout
Behind `streak_weekend` (default off). Founder toggles on, verifies (crash spans weekends, calendar rest cells, status). Then **remove the flag** (hardcode `displayStreak` to pass `true`) to ship to all.

## Follow-ups
- Optional: a "🌙 rest day earned" micro-cue. Configurable weekend days. Surface "log the full week to bank your weekend" as a nudge.
