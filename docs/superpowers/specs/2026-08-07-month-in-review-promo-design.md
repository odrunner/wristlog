# Your Month in Review — an automated promo card

A personalised, swipeable recap of the month that just ended, delivered through
the existing feed promo system as a fourth card variant.

Where the Stats page's Monthly Review is a report you go and look at, this is
the same month pushed to you once, in its opening days, as a story you swipe.

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
monthRecap({ now, logs, watches, likes }) -> recap | null
```

Returns `null` — the card does not exist — unless **all** of:

| Gate | Value |
| --- | --- |
| Window | `now` falls on day 1–`RECAP_WINDOW_DAYS` (10) of the month |
| Volume | `RECAP_MIN_WEARS` (5) wears in the month that ended |
| Variety | `RECAP_MIN_WATCHES` (2) distinct watches |

Below the thresholds the recap is embarrassing rather than delightful, so it
simply doesn't appear. The window makes the card self-limiting: it cannot go
stale in the feed, and it re-arms on the 1st without anyone touching the row.
It started at 7 days and was widened to 10 on 2026-08-08 — a week is a narrow
miss for anyone who doesn't open the app in it.

The returned object:

```js
{
  period: '2026-07', year: 2026, month: 6,     // month is 0-11
  windowStart: <ms>,                            // 00:00 local on the 1st of the CURRENT month
  totalWears, wearDays, uniqueCount,
  top: [{ watchId, count }, …],                 // up to 3, count desc then watchId asc
  topUC, topUCWears,
  topDow, topDowWears,                          // 0-6, Sun-first

  // Each of these is null/empty when its slide has nothing to say:
  prev:     { period, totalWears, uniqueCount } | null,
  streak:   { days, start, end } | null,
  arrivals: [watchId, …],                       // added that month, up to 3
  topPost:  { logId, watchId, likes, date, photoUrl } | null,
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

`eligiblePromoSlots()` gains three variant-aware behaviours, and nothing else:

1. **Existence gate** — `if (s.variant === 'recap' && !ctx.recap) return false`.
   Both the window and the data thresholds already live in `monthRecap()`, so
   this is one line and the function stays pure.

2. **Exempt from `suppress_after_modal`.** That config stands every card down
   once a modal has taken the screen this session. The recap is exempt: the
   rule exists so a user doesn't get a modal *and* a card in one sitting, which
   is the right trade for a card they can see any day and the wrong one for a
   card that comes round twelve times a year. The fun-fact modal fires daily at
   login, so without the exemption the recap depended on beating it to the feed
   — a race it often lost, which is what made the card look like it had
   vanished on 2026-08-08. Every other gate still applies.

3. **Windowed impression cap.** `max_impressions` counts for all time, so
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
│          ● ○ ○ ○ ○ ○                  │
│ [        ⬆ Share July              ]  │
└───────────────────────────────────────┘
```

Up to eight slides in a horizontal `scroll-snap` track. Four always render;
four appear only when there is something to say, so a typical month is five or
six. The order is a deliberate narrative — broad, then the collection, then the
social proof, then habit — and it is pinned by a test.

| # | Slide | Always? | Content |
| --- | --- | --- | --- |
| 1 | Cover | yes | month name huge, `37 wears · 14 watches · 28 days` |
| 2 | Most worn | yes | large watch photo, name, brand, `8 wears` |
| 3 | Top three | yes | three ranked photo tiles with counts |
| 4 | vs. last month | if the previous month has wears | `▲ 8 wears`, `across 1 more watch`, or `Level with June` |
| 5 | Top post | if a post that month has ≥1 like | the photo, the watch, `12 likes` |
| 6 | New this month | if watches were added | photo tiles, `joined the rotation` |
| 7 | Longest streak | if ≥ `RECAP_MIN_STREAK` (3) days | `19` / `days in a row` / the span |
| 8 | Rhythm | yes | days logged, busiest weekday, top use case |

Each conditional slide drops itself rather than rendering an empty panel. The
streak has a floor because a two-day "streak" reads as a rebuke, and the
comparison is skipped entirely when the previous month is empty — "up 37 wears
on a month you weren't here for" is not a comparison, it's a first month.

**The top post is the one input `monthRecap()` cannot compute from memory.**
Like counts come from a `likes` query in `loadRecapLikes()`, run concurrently
with `loadPromoSlots()` and passed in as a `{ [logId]: count }` map. It costs
nothing out of season: the provisional recap is computed first, and outside the
window it is null and the query never runs. Concurrency is not a nicety —
boot's dirty-state retry and `cloudSync()` are the next lines, and an extra
*serial* request there delays every boot-time sync behind it.

Slide 3 renders however many of the top three exist — the `≥2 watches` gate
guarantees at least two tiles. Photos fall back to the initials-on-colour
avatar exactly as the By Day of Week card does, so a collection with no
pictures still reads.

**The footer is Share.** An earlier revision carried an admin-chosen CTA there,
seeded as "See the full month" → Stats; it was removed because the card *is*
the content and a button that only lands on Stats is a step nobody needs. The
renderer still honours a slot's `cta_label`/`cta_action` beneath the share
button, so a future campaign can add one, but the recap row ships with both
fields empty.

## 5. Sharing

The share button hands the recipient a **link**, not text and not an image: a
link survives forwarding, renders as a card in a message thread, and is the
only form that brings anyone back to WRotate.

`supabase/functions/share-recap`, modelled on `share-collection`:

- `GET /share-recap?u=<username>&m=YYYY-MM` → a page with OG tags
- `…&img=1` → a 1200×630 SVG `og:image`

`m` is validated against `^\d{4}-(0[1-9]|1[0-2])$` with a year range before it
reaches any date filter. Image mode **always** answers with an SVG, even for a
bad or private request — a link preview whose image 404s renders as a grey box
in the thread.

**The link carries a token, not a username.** `?t=<token>` resolves to the
(user, month) it was minted for. Possession IS the authorisation — the owner
generated it and sent it — so a token link is honoured whatever the sharer's
profile privacy is. That is the point: sharing your own month with people you
picked is a different act from a stranger finding it, and requiring a fully
public profile blocked the feature for exactly the people most likely to use it.

`?u=<username>&m=<month>` still works, and still *only* for a public profile.
It has to stay gated because it is guessable: honouring it for a private
account would publish everyone's months to anyone who tries a URL.

The token cannot live on `profiles` — every SELECT policy there applies to
PUBLIC including `anon`, so it would be readable by anyone holding the
publishable key, which is to say not a secret. It lives in `recap_shares`,
readable only by its owner; the edge function resolves it with the service role.
One token per (user, month), reused forever: re-sharing a month must not
invalidate the link already sitting in someone's thread.

**Watch privacy is a separate layer and still applies.** A watch marked private
still *counts* toward the totals (so the numbers match what the sharer saw) but
is never *named or pictured* — that setting is about the watch, not about who
the profile is shared with. The podium can therefore be shorter than the unique
count implies, which is correct.

The token is minted during boot, not on the Share tap: `navigator.share` must be
called from the user's gesture, and an `await` in between loses that gesture on
iOS Safari.

The page carries `noindex`. The counting rules in `computeRecap()` mirror
`monthRecap()` exactly; a sharer who sends their July and then sees different
numbers has caught us contradicting ourselves.

**Not shared:** the top post, new arrivals, and the use-case/weekday detail.
The link is a highlight card — month, three numbers, podium, streak — not a
mirror of all eight slides. The top post in particular would need a
post-visibility decision that the aggregate slides avoid entirely.

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

## 6. Thumbs up/down

The card asks "What do you think of this feature?" bottom-right, under the
share button. One tap, no
form — on a brand-new feature the cheapest possible signal beats a survey nobody
fills in. The answer replaces the question rather than inviting a second,
contradictory tap, and a vote from a previous session is remembered.

A vote is a `promo_events` row (`thumbs_up` / `thumbs_down`, added to that
table's CHECK). Reusing that table meant no new storage — but it did NOT mean
no new plumbing, which an earlier draft of this spec claimed:
`promo_slot_stats()` counted only impression/click/dismiss/submit, so the one
signal this control exists to collect was invisible in the admin list until the
RPC and the list line were both extended
(`sql/2026-08-08-promo-stats-thumbs.sql`). The counts print only once a slot
has some, so every other card isn't carrying two permanent zeros.

Only `impression` counts against `max_impressions`, so nobody retires their own
card by having an opinion about it.

## 7. Admin

`recap` joins the Style dropdown from the registry, as the other variants do. A
note under the picker says the copy fields are ignored for this style. The live
preview calls the real renderer, so it shows the admin's *own* recap — or, out
of season, an explicit "no recap in this window" placeholder rather than an
empty box. The placeholder is the only thing a `recap` slot can render without
data, and eligibility guarantees the feed never reaches it.

## 8. Tests

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

## 9. Where it lives

- Schema: `sql/2026-08-07-promo-recap-variant.sql`,
  `sql/2026-08-08-recap-shares-and-feedback.sql` (`recap_shares`, thumbs events)
- Sharing: `supabase/functions/share-recap/` (index.ts, lib.ts, lib.test.ts) +
  `shareMonthRecap()` in `index.html`; smoke cases in
  `scripts/smoke-test-functions.js`
- Logic: `monthRecap()`, `promoSlotEpoch()`, `RECAP_*` constants in
  `index.html`, mirrored VERBATIM in `wrotate_test.js`
- Renderer: the `variant === 'recap'` branch of `renderPromoCard()`, plus
  `currentMonthRecap()`, `installPromoRecapScrollSync()`, `syncRecapDots()`
- Styles: the "Month in review" block in `index.html`, after `.promo-band--nudge`
- Action: `PROMO_ACTIONS.open_stats` + its label
