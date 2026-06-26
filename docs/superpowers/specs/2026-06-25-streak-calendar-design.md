# Streak Calendar Popup — Design

**Date:** 2026-06-25
**Status:** Approved (design). Extends the top-bar streak chip; same `streak_chip` flag.
**Scope:** Client-only. A month-calendar modal opened by tapping the header streak chip. Pure grid builder + a modal render. No backend.

## Background

The top-bar streak chip (shipped behind `streak_chip`, default off) currently routes taps to the Track page — but the universal pattern is "tap a streak → *see* your streak" (Duolingo calendar, GitHub grid). The founder chose a **month calendar popup**. This gives the chip a satisfying payoff: a calendar of logged days with the current run visible, which makes the streak tangible and worth caring about — the whole point of the chip.

## Goal

Tapping the streak chip opens a month-calendar modal showing which days were logged, the current run highlighted, with month navigation and the current/best streak in the header.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Trigger | Repoint `streakChipTap()` from Track → `openStreakCalendar()`. |
| Surface | A `.overlay/.modal` popup (the app's standard modal), not a page. |
| View | One month grid (7-col), logged days flamed/filled, today outlined, future days dimmed. |
| Navigation | `‹ ›` to page months; next disabled at the current month (no future). |
| Header | "🔥 N-day streak" (+ "· best M" if best > current); "Start a streak · best M" / "Start a streak" when none. |
| Gating | Behind the existing `streak_chip` flag — the chip is the only entry, so no new flag. |
| Data | `new Set(logs.map(l => l.date))` (local `'YYYY-MM-DD'`). Pure, client-side. |
| Close | Register in `_overlayCloseMap` → backdrop-click + Esc close for free, plus a Close button. |

## Non-Goals

- No GitHub-style heatmap (the month calendar was chosen), no year view.
- No streak freeze / loss-aversion framing (deferred #4 A+B).
- No calendar embedded in the profile yet (the builder is reusable if we add it later).
- No backend / stored streak.

## Architecture

### Component 1 — Pure grid builder (testable, mirror-drift)
`streakCalendarGrid(loggedDates, year, monthIndex, today)` → an array of cells: `null` for leading blanks (days before the 1st), then `{ day, date, logged, isToday, isFuture }` for each day of the month. `loggedDates` accepts a Set or array; `today` is `'YYYY-MM-DD'`. Pure, byte-identical in `index.html` + `wrotate_test.js`, registered in the mirror-drift `VERBATIM` list, unit-tested. The renderer chunks the array into weeks of 7.

### Component 2 — Modal element + CSS
A `#streak-calendar-modal` `.overlay.hidden` with a `.modal` card: a title row, a month-nav row (`‹  June 2026  ›`), a weekday header (S M T W T F S), a 7-column day grid (reusing the `.dow-grid` grid pattern), and a Close button. New CSS for `.streak-cal-grid` day cells: `.logged` (warm/gold fill), `.today` (gold outline), `.future` (dimmed), blanks empty.

### Component 3 — Render + open/close + nav
- `openStreakCalendar()` — set the displayed month to today's month, render, remove `hidden`.
- `closeStreakCalendar()` — add `hidden`.
- `renderStreakCalendar()` — compute `computeStreaks(logs, todayStr())` for the header; build the grid via `streakCalendarGrid(loggedSet, y, m, todayStr())`; render the header, month label, weekday row, day cells; wire `‹ ›`.
- `streakCalShift(delta)` — change the displayed month (clamped so it can't go past the current month forward), re-render.
- `streakChipTap()` → `openStreakCalendar()`.
- Register `'streak-calendar-modal': closeStreakCalendar` in `_overlayCloseMap`.

## Edge cases

- **Flag off:** chip hidden → modal unreachable. No exposure until the flag ships.
- **No logs / never logged:** header shows "Start a streak"; the grid renders with no flamed days. (The chip itself is hidden for never-loggers, so this is mostly for the "logged before, none now" case.)
- **Streak spanning a month boundary:** the run shows flamed in each month; paging back reveals the earlier part. (A known tradeoff of the month view vs a heatmap — accepted.)
- **Future days** in the current month: dimmed, not interactive, never `logged`.
- **DST / local dates:** dates are compared as `'YYYY-MM-DD'` strings, consistent with `todayStr()` and `computeStreaks`.

## Testing

- **Unit (vitest)** `tests/streak-calendar.test.js` on `streakCalendarGrid`: leading-blank count = first-of-month weekday; total cell count = blanks + days-in-month; a known logged date flagged `logged`; `isToday` / `isFuture` relative to a passed `today`; Set and array inputs both accepted. (Use a fixed month, e.g. Jan 2026 — Jan 1 2026 is a Thursday → 4 leading blanks, 35 cells.)
- **Mirror-drift:** `streakCalendarGrid` added to `VERBATIM`; guard confirms byte-identical copies.
- **Full suite** (`npm test`) stays green.
- **Manual UAT (founder, flag on):** tap the chip → calendar opens; logged days flamed; today outlined; `‹ ›` pages months and next is disabled at the current month; backdrop/Esc/Close all dismiss. Test accounts only.

## Files / changes

| Area | Change |
|---|---|
| `index.html` | `streakCalendarGrid` (verbatim); `#streak-calendar-modal` markup + `.streak-cal-*` CSS; `openStreakCalendar`/`closeStreakCalendar`/`renderStreakCalendar`/`streakCalShift`; repoint `streakChipTap`; register in `_overlayCloseMap`; SW bump |
| `wrotate_test.js` | `streakCalendarGrid` (byte-identical, exported) |
| `tests/streak-calendar.test.js` | New unit tests |
| `tests/mirror-drift.test.js` | Add `streakCalendarGrid` to `VERBATIM` |
| `sw.js` | Cache bump |

## Rollout

Ships behind the existing `streak_chip` flag (default off) on merge — invisible until the founder toggles the chip on. When the chip+calendar are validated, the **same flag-removal follow-up** unhides both for everyone.

## Follow-ups (out of scope)

- Embed the same calendar in the profile (reuse `streakCalendarGrid`).
- #4 A+B streak freeze + loss-aversion framing (freezes would show on the calendar as a distinct cell state).
