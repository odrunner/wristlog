# Usability / UX Audit — WRotate — 2026-07-19

Scope: features shipped since 2026-06-29 (~101 commits). Checked against
`2026-06-29-usability-audit.md` and `2026-06-28-ux-consistency-audit.md`. Read-only.

Method: drove the running app with Playwright at 375px and 390px, captured screenshots, and
**visually inspected every one**. Findings marked **[VISUAL]** (confirmed in a screenshot),
**[MEASURED]** (live `getBoundingClientRect`/DOM), or **[CODE]** (read only).

## Prior findings — status

| ID | Prior | Now |
|----|-------|-----|
| **UX29-1** Add-from-Photo CTA hierarchy inverted | FIXED 2026-06-29 | **FIXED in empty states; inversion moved to the toolbars** — U19-6 |
| **UX29-2** weak-signal stop reasons don't escalate | OPEN | Still OPEN (`index.html:25342`) [CODE] |
| **UX29-3** own-post kebab "Report a comment" | OPEN | Still OPEN [CODE] |
| **M6** icon-button 40px min target | Shipped for 3 classes | **Incomplete — new `.wl-view-btn` never covered.** U19-4 |

Verified clean: no horizontal page scroll at 375/390px on Stats, Track or Wishlist
(`document.scrollWidth === window.innerWidth`). `.rank-table` overflow sits inside the
intentional `overflow-x:auto` wrapper (`index.html:4085`). The wishlist toolbar one-line fix
**works** — at 375px all five controls fit one row, no clipping [VISUAL].

---

## HIGH

### U19-1 — Leaderboard watch names truncate on every phone [VISUAL + MEASURED]
`index.html:18998`, Stats @ 390px and 375px. With a 6-watch collection, **4 of 6 names cut off**:
```
#1  Rolex Submariner ...     7 wears  58%
#2  Omega Speedmas...        3 wears  25%
#3  Audemars Piguet R...     1 wear    8%
#3  Grand Seiko Snowfl...    1 wear    8%
```
The name div is `flex:1;min-width:0` with ellipsis, competing against a `2.1rem` rank, 32px
thumb, a `"N wears"` span and a `2.6rem` percent span.

**This is a layout choice, not a width limit** — Track renders the *same* watches at the
*same* 390px with full names ("Grand Seiko Snowflake SBGA211") because it has no rank column
and no right-hand columns [VISUAL].

**Fix:** let the name wrap to two lines (`white-space:normal`), or move `N wears · P%` onto a
second line under the name (Track's pattern) and drop the columns.

### U19-2 — Leaderboard uncapped: 30 watches → ~1,500px of mostly-empty rows [VISUAL + MEASURED]
`index.html:18986` renders every watch unconditionally. With 30 watches / 10 worn:
**31 rows, card height 1,496px, total Stats page 5,587px** — 10 ranked rows then **20
identical greyed rows all rank "#11", every one `0 wears —`**. ~1.8 phone screens, sitting
*above* Collection Report, By Day of Week, Use Case and Year in Review.

The design intent (`index.html:18972`) is sound but is paid for by every other section, and
worsens on shorter filters as more watches fall to zero.

**Fix:** top 10 + `Show all N`, or collapse the tail into `+20 not worn in this period ▾`.

---

## MEDIUM

### U19-3 — The `%` is unlabeled, and Stats vs Track disagree with no explanation [VISUAL]
`index.html:19001` (period-scoped) vs `15850,15865` (all-time). With the filter on **1M**,
Stats showed `#1 Rolex Submariner … 4 wears 57%`; Track showed `7 wears · 58%` for the same
watch. Same styling, same shape, different numbers, **no label anywhere** saying what the
percentage is a share of. The only explanation is in Help, and it doesn't mention Track is
deliberately all-time (that reason lives in a code comment at 15847).

**Fix:** column header or inline legend (`% = share of wears in this period`); label Track's
as `· 58% all-time`.

### U19-4 — New wishlist view-toggle buttons are 27×28px [MEASURED @375px]
`index.html:1338` (`.wl-view-btn`, no min-height) and `1626` (mobile override). Live: **27×28px
each**, `.2rem` apart; adjacent `.btn-sm` measured 34px. The comment at 1624 says *"vertical
is unchanged so the tap target keeps its height"* — accurate, but the baseline was already
28px. M6 added `min-height:40px;min-width:40px` to three classes at 1630; `.wl-view-btn` is
newer and was never added.

Switching to Brand Folders is *the* new wishlist feature, gated behind three 28px targets
~7px apart. **Fix:** add `.wl-view-btn` to the 1630 rule. The toolbar has slack at 375px.

### U19-5 — Leaderboard rows look tappable but are inert [MEASURED]
`index.html:18994` — live DOM: `onclick: false, role: null, tabindex: null, cursor: "auto"`.
Rows are avatar + name + stats, 47px tall, visually near-identical to Track's
`.watch-option` which *is* tappable (`openTrackModal`, 15861). Users will tap #1 and get
nothing; no keyboard/AT affordance. **Fix:** open watch detail, `role="button"`,
`tabindex="0"`, `cursor:pointer`.

### U19-6 — Add-from-Photo hierarchy: fixed in empty states, still inverted in toolbars [CODE + VISUAL]
**Confirmed fixed:** wishlist empty state (22138) now `btn-primary` Photo + `btn-ghost`
manual, matching collection (17079).
**Still inverted:** Collection toolbar (2914) has Photo = **btn-primary**; Wishlist toolbar
(4056) has Photo = **btn-ghost btn-sm** and `+ Add to Wishlist` = **btn-primary**. The 375px
screenshot shows gold "+ Add to Wishlist" beside outline "Add from Photo" [VISUAL].
The empty state is seen once; the toolbar every visit — so the inconsistency the prior audit
set out to fix is still what users encounter. **Fix:** pick one direction and match.

---

## LOW

**U19-7 — Most Worn card never states its period** [VISUAL]. `index.html:19005` title is the
literal `Most Worn`. The filter sits ~460px above, off-screen when the card is in view.
Switching All Time → 1M silently changed every number. (The empty state *does* say "in this
period".) **Fix:** `Most Worn · Last 30 days`.

**U19-8 — Brand-request validation message is covered by the dropdown it triggers** [VISUAL +
MEASURED]. `showFieldError` calls `field.focus()` → `onBrandFocus()` reopens the
absolutely-positioned `.brand-ac-list` (`z-index:200`) over the error text. The string is in
the DOM but invisible. Mitigating: the reopened dropdown shows `"Zelvetica" not listed —
request it`, which is arguably better guidance. **Fix:** render the error above the input,
or suppress the reopen when focus comes from `showFieldError`.

**U19-9 — "request it" row is a 31px tap target** [MEASURED]. `index.html:674` — live box
`322 × 31.4px`. It is now the *only* path to adding a brand (13285). **Fix:** padding `.7rem`.

**U19-10 — Brand request opens a generic "Send Feedback" modal** [VISUAL]. `requestBrand()`
(23321) prefills correctly and hides the type picker, but the header still says Feedback and
nothing sets expectations that `auto-add-brand` adds it automatically. **Fix:** retitle to
"Request a brand" on this path + one line: "We'll add it automatically — usually within a
few minutes."

**U19-11 — Folders view mixes two row languages** [VISUAL @375px]. 2 Rolex + 1 Patek: Rolex
renders as a 56px folder row, Patek as a 96px item card. Defensible, but the list reads
ragged and the folder row shows no price while the loose card does. **Fix:** folder rows for
single-item brands, or price ranges on folder rows.

**U19-12 — `MOST WORN` stat tile duplicates leaderboard row #1** [VISUAL]. `19045` vs `19005`.
**Fix:** repurpose the tile (e.g. "Least Worn" / "Unworn").

**U19-13 — `.btn-sm` is deliberately 34px on mobile** [MEASURED]. `index.html:1612`, a
conscious trade to keep the toolbar on one line — but it means the wishlist toolbar has *no*
control at 40px. Revisit alongside U19-4.

---

## Verified clean

- **Empty states all correct** [VISUAL + MEASURED]. No watches → card `display:none` rather
  than an empty shell. One watch no wears → "No wears logged in this period." One wear →
  `#1 … 1 wear 100%`. Singular/plural correct.
- **The em dash reads correctly** [VISUAL] — unworn rows render `0 wears  —` at `opacity:.55`;
  the dash is unambiguous *because* it sits beside an explicit "0 wears". Competition ranking
  correct (`1,2,3,3,5`) [MEASURED].
- **Measurement shares correctly excluded from wear counts on both screens** [MEASURED] — I
  suspected Track and Stats might disagree since `wearsForWatch` has no measurement filter,
  but `rebuildLogsByWatch` (13326) strips them upstream. Not a finding.
- **Dark mode clean** [VISUAL] — good contrast throughout; the avatar-initials luminance fix
  from 2026-06-28 works.
- **No horizontal scroll** at 375/390px on Stats, Track, Wishlist [MEASURED].
- **Help copy accurate** for the leaderboard specifically (3592); What's New matches shipped
  behaviour. *(Note: the bugs audit separately found the Help claim about "every section"
  is false for three Stats sections — see `2026-07-19-bugs.md` #2/#3.)*
- Period `<select>` measures 150×41px — above target [MEASURED].

## Not assessed
Feed measurement-share cards for multi-image posts — `isMeasurementCardImage` (6945) reads
sound, but a real multi-image measurement post could not be rendered through the mock
harness. **No verdict either way.**

## Suggested order
U19-1 + U19-2 together (one commit on the Most Worn card), then U19-4 (one-line CSS),
U19-3 + U19-7 (labels), then U19-6. U19-8/9/10 as a brand-flow polish pass.
