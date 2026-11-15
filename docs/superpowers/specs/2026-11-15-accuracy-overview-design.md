# Accuracy History: collection overview

Date: 2026-11-15. Mockup: https://claude.ai/artifact/Mh833zDeUWPazuNDiwKBc5 (the "A+B" screen).

## Why

Accuracy History shows one watch at a time through a dropdown. The owner wants one screen that shows every watch in the collection with its accuracy, so the collection can be judged as a whole. 178 of the 448 members with saved readings have them on two or more watches (41 on five or more, the most is 20).

## Goals / non-goals

- Goal: one screen listing every watch with its latest rate, comparable by eye across watches.
- Goal: one tap from any watch to the per-watch chart and day list that exist today, unchanged.
- Non-goal: a flat table of every measurement. The per-watch day list already covers finding and discarding single readings.
- Non-goal: any change to measuring, to saving readings, or to the Accuracy section inside a watch in Collection.
- Anti-goal: making the common path slower. 158 members reach history from the card under the chart on Measure (633 opens) against 60 from the header icon (77 opens); that card is about one watch and must still land on that watch.

## Approaches considered

- **A. Watch list** with a private trend line per row. Exact numbers and sorting, but the rows do not compare by eye because each trend line has its own scale.
- **B. Shared-scale strip**, one lane per watch on a common axis. Best comparison, but no counts, dates or sorting.
- **A+B. List with the strip in each row.** Chosen by the owner 2026-11-15: both jobs on one screen, at the cost of taller rows.
- Dropped earlier: one table of all measurements (a log, not an overview); all watches as lines on one time chart (unreadable past 3-4 watches).

## Design

Decided by the owner: layout A+B; the headline number per watch is the **latest reading**.

The rest are the builder's calls, stated here so they can be overruled:

1. **Two levels on the existing History page.** Level 1 is the new overview; level 2 is today's per-watch view. The watch dropdown is removed; the back arrow on level 2 returns to the overview, and on the overview returns to Measure.
2. **Entry points.** The header trend icon on Measure opens the overview. The "Accuracy history" card under the chart opens level 2 for the selected watch, as now; back from there goes to the overview.
3. **Row content.** Line 1: watch name and latest rate with a chevron. Line 2: the strip. Line 3: "avg +1.8 · 12 readings · last Nov 12". One axis label row (-15, -5, 0, +5, +15) at the top of the card.
4. **Strip.** Fixed scale -30 to +30 s/d with the existing ±5 and ±15 bands. Dot = latest reading; bar = min to max of readings in the selected range. A latest reading beyond the scale is pinned to the edge and drawn as an arrow.
5. **Colour.** Rate text and dot: green within ±5, amber within ±15, red beyond. Existing tokens only; canvas/SVG colours through classes or `dsToken()`.
6. **Range chips (1M / 3M / 1Y / All, default 3M, shared with level 2).** The latest reading and its date always show, whatever the range. The range controls only the bar, the average and the reading count. A watch whose latest reading is older than the range shows the dot with no bar and "none in this range" in place of the average and count.
7. **Sort.** Most accurate (smallest absolute latest rate, default), Most recent, Name. The choice is remembered on the device.
8. **Watches with no readings** sit greyed at the bottom ("Not measured yet"), in every sort, and are tappable into the empty level 2.
9. **Data.** One read of the member's own `timegrapher_results` (watch_id, rate, created_at), grouped in the browser. The heaviest member has 334 readings, so no new RPC or SQL. Watches come from the already-loaded `watches` list; readings on a watch no longer in the list are ignored.
10. **One watch only:** the overview still shows (a single row); no special case.

## Left to the builder

- The per-watch summary is a pure function in `wrotate_test.js` (mirrored in `index.html`), with tests for every branch (coverage gate).
- New strings go through `tx()` with the six translations.
- Mocked e2e for: overview renders, sort, row tap opens level 2, back returns to overview, hint card still lands on its watch.
- `accuracy_history_viewed` keeps firing with its `source`; add an event for a row tap.
- SW cache bump, design-system ratchet at 0 new hardcoded values, Help page text and a What's New entry.

## Open question for the owner

Project rule: feature ideas ship as A/B experiments. This one has no obvious number to move (it is a different way into the same data). Proposal: ship to everyone directly, no experiment.
