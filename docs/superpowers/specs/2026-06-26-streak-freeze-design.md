# Streak Freeze — Design

**Date:** 2026-06-26
**Status:** Approved (design). Behind `streak_freeze` flag for founder testing, then flag removed to ship to all.
**Scope:** Client-only. A freeze-aware streak computation (pure, derived from logs — no storage) + calendar ❄️ rendering + freeze count + a freeze-saved toast. No backend, no DB.

## Background

The streak chip + month calendar are live. Streaks break on a single missed day, which is discouraging. A **freeze** auto-covers an isolated missed day so the streak survives — the strongest post-day-7 retention mechanic (research: streak-freeze → ~48% longer streaks). The founder is personally motivated (two recent one-day misses).

**Key property:** because the freeze rules are deterministic, the set of frozen days is a **pure function of the user's logs** — no per-user state needs storing. We compute a freeze-aware streak instead of the naive one. So this is entirely client-side.

## Goal

Make an isolated missed day not break the streak, computed purely from logs, surfaced on the calendar (❄️ days + freeze count) and via a "a freeze saved your streak" toast.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Model | Every streak run starts with **2 freezes**. An **isolated** missed day (logged day on both sides, or a single leading miss) is auto-covered by a freeze. **2+ consecutive missed days break** the streak (freezes cover slips, not lapses). |
| Regen | Earn **+1 freeze per 7 logged days** within a run, capped at 2. |
| Storage | **None** — frozen days + freeze count are computed from `logs` each render (pure function). |
| Retroactive | Because it's derived from logs, it **heals existing isolated misses on launch** (the founder's two misses get covered, current streak jumps). |
| Badges | **Unchanged** — milestone streak badges still require **real consecutive logged days** (the existing inline computation is left as-is). The *displayed* (freeze-protected) streak may exceed the badge-earning streak; that's intentional. |
| Surfaces | Calendar: frozen days render as **❄️** cells + a **"❄️ N freezes"** line. Chip: shows the now-protected number (no other change). A one-time **toast** when a freeze covers a recent miss. |
| Gating | Admin flag `streak_freeze` (default off); display falls back to the naive streak when off. Removed to ship to all. |

## Non-Goals

- No purchased/gifted freezes, no manual equip.
- No bridging 2+ consecutive misses.
- Nothing server-side; no DB column; no change to `computeStreaks` or the badge computation.

## Architecture

### Component 1 — `computeStreaksFrozen(logs, today)` (pure, mirror-drift, tested)
Returns `{ current, best, status, frozen, freezes }`:
- `current`, `best`, `status` (`'active'|'at_risk'|'none'`) — freeze-aware, same shape as `computeStreaks` plus:
- `frozen` — array of `'YYYY-MM-DD'` dates auto-covered by a freeze (for the calendar).
- `freezes` — freezes available in the current run (for display); `2` when there's no active run.

Algorithm (over sorted unique logged dates, using `addDaysStr`):
- Walk the dates building a run. Consecutive day → extend; every 7th logged day in the run → `freezes++` (cap 2).
- A one-day gap (`addDaysStr(last, 2) === next`) with a freeze available → freeze `addDaysStr(last, 1)`, `freezes--`, extend the run (frozen day + the next logged day).
- Otherwise (2+ day gap, or no freeze) → the run breaks; a new run starts with 2 freezes. Track `best` across runs.
- **Leading edge to today:** latest present day `== today` → `active`; `== today-1` → `at_risk` (existing grace); `== today-2` with a freeze → freeze `today-1`, `at_risk`; else → `none` (current 0). `freezes` returned as `2` when status is `none`.

Byte-identical in `index.html` + `wrotate_test.js`, registered in the mirror-drift `VERBATIM` list.

### Component 2 — `displayStreak(logs, today)` (index.html only; the flag seam)
```
displayStreak = featureFlag('streak_freeze')
  ? computeStreaksFrozen(logs, today)
  : { ...computeStreaks(logs, today), frozen: [], freezes: 0 }
```
The chip, calendar, and profile streak line all call `displayStreak` instead of `computeStreaks`. Flag off → naive streak, no ❄️, no freeze count (zero behaviour change). On ship, `displayStreak` always uses the frozen path.

### Component 3 — Surfaces
- **Chip** (`updateStreakChip`): `streakChipState(displayStreak(...), true)` — number is freeze-protected. No other change.
- **Calendar** (`renderStreakCalendar`): use `displayStreak`; build a `frozenSet`; render a cell as ❄️ when `frozenSet.has(c.date)` (it isn't `logged`); add a **"❄️ N freezes"** line (shown only when the flag is on). New `.streak-cal-cell.frozen` CSS (icy tint).
- **Profile Achievements** (`badgeWallProfileSection`): switch its streak line to `displayStreak`.
- **Freeze-saved toast:** on boot (flag on), if `displayStreak().frozen` contains `addDaysStr(today,-1)` or `addDaysStr(today,-2)` (a freeze covering a recent miss) and `localStorage` hasn't recorded a toast for that date → `toast('❄️ A freeze saved your N-day streak — log today to keep it going')` and record the date. One-time per frozen date.

### Component 4 — Flag
`streak_freeze: { label: 'Streak: freeze (admin)', default: false }` in `FEATURE_FLAGS`. Admin Dev tab auto-renders the toggle.

## Edge cases

- **Flag off:** `displayStreak` returns naive streak + `frozen:[]`, `freezes:0` → no ❄️, no freeze line, no toast. Invisible until shipped.
- **Badges:** untouched — a frozen day never counts toward a milestone badge.
- **2+ consecutive misses:** streak breaks even with 2 freezes available.
- **No/short logs:** `freezes` = 2, `frozen` = [].
- **Historical frozen days:** frozen days from older runs remain in `frozen` so the calendar shows past ❄️ consistently.
- **DST / local dates:** all date math via `addDaysStr` (noon-anchored) + `'YYYY-MM-DD'` string compares, consistent with `computeStreaks`.

## Testing

- **Unit (vitest)** `tests/streak-freeze.test.js` on `computeStreaksFrozen`: no logs (freezes 2); all-consecutive-today (active, no frozen); one isolated gap healed; two isolated gaps healed (uses 2 freezes); a third isolated gap with no freezes left → break; 2 consecutive misses → break; leading-edge miss (last log = today-2) → frozen + at_risk; last log = today-3 → none; regen restores a freeze after 7 logged days.
- **Mirror-drift:** `computeStreaksFrozen` added to `VERBATIM`.
- **Badge invariance:** confirm the existing `tests/badges.test.js` / streak-badge logic is unchanged (badges still on real logs).
- **Full suite** (`npm test`) green.
- **Manual UAT (founder, flag on):** toggle `streak_freeze`; confirm the founder's two misses show ❄️ on the calendar and the current streak now spans them; freeze count shows; the toast fires once; chip number reflects the protected streak; flag off restores the naive streak.

## Files / changes

| Area | Change |
|---|---|
| `index.html` | `computeStreaksFrozen` (verbatim); `displayStreak`; `streak_freeze` flag; chip/calendar/profile → `displayStreak`; calendar ❄️ cell + freeze line + `.frozen` CSS; freeze-saved toast; SW bump |
| `wrotate_test.js` | `computeStreaksFrozen` (byte-identical, exported) |
| `tests/streak-freeze.test.js` | New unit tests |
| `tests/mirror-drift.test.js` | Add `computeStreaksFrozen` to `VERBATIM` |
| `sw.js` | Cache bump |

## Rollout

Ships behind `streak_freeze` (default off) — invisible until the founder toggles it on and validates (especially that the two misses heal and badges are unaffected). Then the **flag-removal follow-up** makes `displayStreak` always freeze-aware for everyone.

## Follow-ups (out of scope)

- #4 C social-visible streaks (needs server-side streak).
- Optional: surface freeze count on the chip; "freeze used" as a bell notification.
