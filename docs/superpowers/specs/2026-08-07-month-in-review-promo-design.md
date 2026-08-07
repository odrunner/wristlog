# Your Month in Review — an automated promo card

A personalised, swipeable recap of the month that just ended, delivered through
the existing feed promo system as a fourth card variant.

Where the Stats page's Monthly Review is a report you go and look at, this is
the same month pushed to you once, in the first week, as a story you swipe.

---

## 1. Shape

`promo_slots.variant = 'recap'`. The admin creates **one** row (audience `all`,
high priority), turns it on once, and never touches it again. The renderer
ignores that row's `heading` / `body` / `image_url` and generates the slides
from the *viewer's own* `logs` + `watches`, already in memory after
`loadUserData()`.

Everything else about the card is a normal promo: positioning, session budget,
priority ordering, impression cap, click tracking, the archive switch. Nothing
in `injectPromoCards()`, `promoSlotPositions()` or the event plumbing is
variant-aware, and that stays true.

Schema: `sql/2026-08-07-promo-recap-variant.sql` widens
`promo_slots_variant_check` to `('classic','tag','band','recap')`. No new
columns, no new tables, no server-side computation.

## 2. `monthRecap()` — the one new piece of logic

Pure, `now` injected, mirrored into `wrotate_test.js` as VERBATIM.

```
monthRecap({ now, logs, watches }) -> recap | null
```

Returns `null` — the card does not exist — unless **all** of:

| Gate | Value |
| --- | --- |
| Window | `now` falls on day 1–`RECAP_WINDOW_DAYS` (7) of the month |
| Volume | `RECAP_MIN_WEARS` (5) wears in the month that ended |
| Variety | `RECAP_MIN_WATCHES` (2) distinct watches |

Below the thresholds the recap is embarrassing rather than delightful, so it
simply doesn't appear. The window makes the card self-limiting: it cannot go
stale in the feed, and it re-arms on the 1st without anyone touching the row.

The returned object:

```js
{
  period: '2026-07', year: 2026, month: 6,     // month is 0-11
  windowStart: <ms>,                            // 00:00 local on the 1st of the CURRENT month
  totalWears, wearDays, uniqueCount,
  top: [{ watchId, count }, …],                 // up to 3, count desc then watchId asc
  topUC, topUCWears,
  topDow, topDowWears,                          // 0-6, Sun-first
}
```

**Counting matches `renderMonthlyReview()` exactly**, including its asymmetry:
wear totals and per-watch counts dedupe on `watchId|date`, while use-case and
day-of-week counts read raw log rows. The recap and the Stats card sit one tap
apart and a user *will* compare them — agreeing with the shipped card matters
more than internal tidiness. `isWearEntry()` excludes measurement shares in
both, and logs for watches no longer in the collection are dropped in both.

Ties break on `watchId` ascending so the pure function is deterministic under
test; the Stats card's tie-break is insertion order, i.e. arbitrary.

## 3. Eligibility and the monthly re-arm

`promoCtx()` gains `recap`, memoised on `<date>|<logs.length>` so a feed
re-render doesn't re-scan the log array, and cleared on account switch
alongside the other promo state.

`eligiblePromoSlots()` gains two variant-aware behaviours, and nothing else:

1. **Existence gate** — `if (s.variant === 'recap' && !ctx.recap) return false`.
   Both the window and the data thresholds already live in `monthRecap()`, so
   this is one line and the function stays pure.

2. **Windowed impression cap.** `max_impressions` counts for all time, so
   without a change the card would show once, ever. For recap slots only, the
   cap counts impressions logged since `recap.windowStart`. That needs
   `created_at` on the events (added to the `promo_events` select, and to the
   optimistic row `logPromoEvent()` pushes), plus a matching change to the
   localStorage mirror: `promoSlotEpoch(slot, recap)` returns the recap
   *period* for a recap slot instead of `updated_at`, so last month's local
   count is not honoured against this month's card.

   Net effect: the card re-arms itself every month, automatically, with no
   admin action and no cron.

## 4. The card

```
┌───────────────────────────────────────┐
│ ● YOUR MONTH IN REVIEW      July 2026 │
├───────────────────────────────────────┤
│ ┌─────────┐                           │
│ │  JULY   │ ← scroll-snap track →     │
│ │   37    │                           │
│ │  wears  │                           │
│ └─────────┘                           │
│            ● ○ ○ ○                    │
│ [        See the full month        ]  │
└───────────────────────────────────────┘
```

Four slides in a horizontal `scroll-snap` track:

| # | Slide | Content |
| --- | --- | --- |
| 1 | Cover | month name huge, `37 wears · 14 watches · 28 days` |
| 2 | Most worn | large watch photo, name, brand, `8 wears` |
| 3 | Top three | three ranked photo tiles with counts |
| 4 | Rhythm | days logged, busiest weekday, top use case |

Slide 3 renders however many of the top three exist — the `≥2 watches` gate
guarantees at least two tiles. Photos fall back to the initials-on-colour
avatar exactly as the By Day of Week card does, so a collection with no
pictures still reads.

**The CTA is a footer button, not a fifth slide.** The design review called for
a wrap slide whose only job was to carry the CTA; a persistent button does that
better and does not make anyone swipe four times to act. `cta_label` and
`cta_action` come from the row like any other slot — the seed uses
`open_stats`, a new action (there wasn't one) that navigates to the Stats tab
where the full Monthly Review lives.

**Interaction is CSS.** `overflow-x:auto`, `scroll-snap-type: x mandatory`,
each slide `flex:0 0 100%; scroll-snap-align:center`. The only JS is a dot
sync: one delegated listener in the **capture** phase, because `scroll` does
not bubble, following the same install-once pattern as the click delegation and
surviving the `innerHTML` re-renders that would drop a bound handler. No
gesture conflict — feed swipe-nav is disabled (`index.html`, `_swLocked`
block).

Each slide is `role="group"` with an `aria-label` of `"1 of 4"`; the track
takes `tabindex="0"` so it is keyboard-scrollable.

Deliberately **out of scope**: per-slide impression tracking, share-to-image,
and a fullscreen expand. Each is a clean follow-up on top of this.

## 5. Admin

`recap` joins the Style dropdown from the registry, as the other variants do. A
note under the picker says the copy fields are ignored for this style. The live
preview calls the real renderer, so it shows the admin's *own* recap — or, out
of season, an explicit "no recap in this window" placeholder rather than an
empty box. The placeholder is the only thing a `recap` slot can render without
data, and eligibility guarantees the feed never reaches it.

## 6. Tests

Unit (`tests/promo-recap.test.js`):
- window boundaries — day 7 in, day 8 out, day 1 of January recapping December
- thresholds — 4 wears out, 5 in; 1 watch out, 2 in
- measurement shares excluded; deleted watches excluded; `watchId|date` dedup
- top-three ordering and the deterministic tie-break
- `promoSlotEpoch()` — period for recap, `updated_at` for everything else

Unit (`tests/promo-eligible.test.js`, extended):
- a recap slot is dropped when `ctx.recap` is null
- last month's impressions do not bound this month's card
- a non-recap slot's cap still counts for all time

E2E (`e2e/promo-recap.mock.spec.js`): slide count, dot count, the avatar
fallback, the collapse to two tiles, and the CTA firing `open_stats`.

## 7. Where it lives

- Schema: `sql/2026-08-07-promo-recap-variant.sql`
- Logic: `monthRecap()`, `promoSlotEpoch()`, `RECAP_*` constants in
  `index.html`, mirrored VERBATIM in `wrotate_test.js`
- Renderer: the `variant === 'recap'` branch of `renderPromoCard()`, plus
  `currentMonthRecap()`, `installPromoRecapScrollSync()`, `syncRecapDots()`
- Styles: the "Month in review" block in `index.html`, after `.promo-band--nudge`
- Action: `PROMO_ACTIONS.open_stats` + its label
