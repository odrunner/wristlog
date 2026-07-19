# Wear leaderboard with time ranges — design

**Date:** 2026-07-19
**Requested by:** Steve (via user)

> "Can you do new feature for WRotate leaderboard where you can filter to 1m, 3m,
> YTD, 1Y (in addition to implicit all time view). In other words my AP RO is
> second to last. But that's going to happen with new watches. So it would be
> insightful to see shorter time ranks/(filters)"

Plus, from the user: show a simple "% of all time" on the Track list.

## The problem

An all-time wear ranking permanently punishes recently acquired watches: a watch
bought last month cannot catch up with one owned for three years, so it sits at
the bottom regardless of how heavily it is being worn *now*. Shorter windows
answer the question Steve actually has — "what am I reaching for lately?"

## What exists today

- **Stats** already has a period filter (`#report-period`: All Time / 30 / 90 /
  365) driving `filteredLogs()`, which feeds every section on the page.
- **Stats → Collection Report** is a dense sortable financial table (wears, cost
  per wear, market value, price delta). Wear-ranking is possible there by
  sorting, but buried.
- **Track** shows a watch list with all-time `N wears`, sorted by **most recently
  worn** — it doubles as the logging picker (tap → log a wear).
- **Collection → Ranking Game** is Elo-based preference ranking. Out of scope:
  there is no match-history table, only a single `elo_rating` column per watch,
  so Elo cannot be filtered by time without capturing new data going forward.

Steve's "new watches will rank low" reasoning only holds for a **wear-count**
ranking. Track displays all-time counts but sorts by recency, so no wear-count
leaderboard exists yet anywhere in the app.

## Decisions taken

| Question | Decision |
|---|---|
| Which list is "the leaderboard"? | Wear counts (not Elo) |
| Where does it live? | Stats — its own card. Track's logging picker is left alone |
| Form? | New "Most Worn" ranked card, not more columns on the Collection Report |

## Design

### A. Period filter — extend the existing control

`#report-period` gains YTD and adopts Steve's labels. One filter drives the whole
page; the leaderboard does not add a second control.

| Label | Value | Window |
|---|---|---|
| All Time | `all` | everything |
| 1M | `30` | trailing 30 days |
| 3M | `90` | trailing 90 days |
| YTD | `ytd` | **new** — Jan 1 of the current year → today |
| 1Y | `365` | trailing 365 days |

`filteredLogs()` currently computes the cutoff with `parseInt(p)` days, which
`ytd` breaks. Replaced by a pure `periodCutoff(period, today)` returning a
`YYYY-MM-DD` string, or `null` for all-time.

Every existing Stats section inherits YTD for free.

### B. New "Most Worn" card (Stats)

Rendered by `renderWearLeaderboard(fl)`, called from `renderStats()` between
`renderStatsRow(fl)` and `renderCollectionReport(fl)`, so it appears directly
under the stat row and above the Collection Report.

```
#1   [img]  Rolex Submariner        14 wears   23%
#2   [img]  Omega Speedmaster       11 wears   18%
#2   [img]  Tudor Black Bay         11 wears   18%
…
#9   [img]  AP Royal Oak             1 wear      2%
#10  [img]  Cartier Tank             0 wears     —
```

- Sorted by wears in the selected window, descending.
- **Watches with 0 wears in the window are still listed, at the bottom.** This is
  the point of the feature: Steve wants to see position move as the window
  changes. Their share renders as `—`, not `0%`.
- Ties use competition ranking (1, 2, 2, 4).
- `%` is share of that window's total wears, rounded to a whole number. Rounded
  values are not forced to sum to 100.
- Empty state when the window contains no wears at all.
- Row markup follows the existing `.watch-option` / avatar pattern (thumbnail or
  colour+initials fallback), so it inherits mobile styling.

### C. Track — "% of all time"

The row subtitle becomes `12 wears · 8%`, where the percentage is the watch's
share of **all-time** total wears. Track has no period filter, so this is
deliberately all-time.

Suppressed when total wears is 0 (renders `0 wears`, no percentage), to avoid a
meaningless `0%` on a brand-new collection.

Sort order of the Track list is unchanged — it remains recency-sorted for
logging.

### D. Wear counting — one definition

`wearsForWatch()` (Track) counts **unique dates** per watch from `_logsByWatch`,
which **excludes** measurement-share posts (`useCase === 'measurement'`). The
leaderboard uses this same definition.

### E. Pre-existing inconsistency (confirmed fix)

`filteredLogs()` filters raw `logs` by date only and does **not** exclude
measurement posts, so the Stats Collection Report counts them as wears while
Track does not. The same watch can show different wear counts on the two pages.

Impact measured: **4 logs across 3 users.**

**Rule (confirmed by the user):** a measurement share is not a wear, so it must
not count towards wears — but it *may* still count towards streaks, badges and
other engagement signals.

That maps exactly onto the existing code split, so the fix is narrow:

- `filteredLogs()` feeds only the wear-oriented Stats sections (stat row,
  Collection Report, day-of-week, use-case chart). Excluding measurement there
  aligns Stats with Track.
- Streaks (`displayStreak` / `computeStreaksFrozen`) and badge checks read the
  raw `logs` array directly and are **left untouched**, so measurement keeps
  counting towards them.

This distinction matters. Two of the four measurement logs are the only log on
their date, and one of them (user `ae5ff73d`, 2026-06-13) sits at the end of a
Jun 10-13 run. Excluding measurement from streaks would have shortened that
user's best streak from 4 days to 3. Scoping the change to `filteredLogs()`
avoids any such regression.

**Follow-up, since confirmed and shipped:** Track's "worn today" badge and the
"✓ … logged" date notice both read raw `logs` and lit up for a measurement-only
day. Both now route through a single shared predicate:

```js
function isWearEntry(l) {
  return !!(l && l.watchId) && l.useCase !== 'measurement';
}
```

`filteredLogs()`, `wearLeaderboard()`, `wornToday`, `renderWornNotice()` and the
post-creation "wear logged" toast all use it, so "is this a wear" has exactly one
definition. A unit test asserts no second inline `useCase !== 'measurement'`
check reappears. Streaks and badges still read the raw `logs` array and are
deliberately unaffected.

## Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `periodCutoff(period, today)` | Period value → cutoff date string or null | — |
| `wearLeaderboard(watches, logs, cutoff)` | Ranked rows `{id, wears, pct, rank}` | — |
| `renderWearLeaderboard(fl)` | DOM for the Stats card | the two above |
| `filteredLogs()` | Applies the period filter page-wide | `periodCutoff` |
| Track row subtitle | All-time count + share | `wearLeaderboard` |

Track reuses `wearLeaderboard(watches, logs, null)` — the all-time call — and
reads each row's `pct`, rather than introducing a second percentage helper. One
definition of "share of wears" serves both pages.

`periodCutoff` and `wearLeaderboard` are pure, live in `wrotate_test.js`,
are mirrored into `index.html`, and are registered in `tests/mirror-drift.test.js`
— matching the existing `campaignGroupOf` / `buildBrandList` pattern.

## Edge cases

- Empty collection → card hidden entirely.
- No wears in the selected window → empty state, no rows.
- Every watch tied → all rank #1, equal shares.
- Single watch with wears → #1, 100%.
- Logs referencing deleted watches → ignored; only current collection ranks.
- YTD during the first days of January → window shorter than 1M; that is correct
  and intentional, not clamped.
- Rounding: a watch with a tiny share shows `0%` rather than `—`; `—` is reserved
  for genuinely zero wears, so the two are distinguishable.

## Testing

**Unit** (`tests/wear-leaderboard.test.js`)
- `periodCutoff`: all/30/90/365 arithmetic; `ytd` returns Jan 1 of the given
  year; `ytd` on Jan 1 itself; leap-year boundary; unknown value falls back to
  all-time rather than throwing.
- `wearLeaderboard`: descending order; competition ranking on ties; zero-wear
  watches last; percentages; unique-date counting (two logs same day = one
  wear); measurement posts excluded; deleted-watch logs ignored.

**E2E** (`e2e/wear-leaderboard.mock.spec.js`)
- The card renders without throwing (unit tests on helpers would not have caught
  the `ONBOARDING` ReferenceError shipped earlier this session — the render path
  itself must be exercised).
- Switching the filter re-ranks the rows.
- A zero-wear watch appears last with `—`.
- Track rows show `N wears · P%`.

## Out of scope

- Time-filtered **Elo** ranking — needs a match-history table with timestamps;
  historical matches are unrecoverable.
- Sharing / social comparison of leaderboards.
- Custom date ranges beyond the five presets.
