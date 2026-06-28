# UX Consistency Audit — 2026-06-28

Deep dive on whether WRotate behaves "as if using a design system": same actions →
same colors, spacing, type, components, wording. Scope: `index.html` (25,811 lines;
styles from L92). Six parallel audits: color, buttons/actions, spacing/radius,
typography, components, repeated-action UX. Read-only — no code changed yet.

## Remediation status — updated 2026-06-28

**Shipped (SW v832–v834, all green on 1217 unit + 115 E2E):**
- ✅ **Phase 0** — scale tokens added to `:root` (`--space-*`, `--fs-*`, `--fw-*`, `--lh-*`, `--radius-sm/btn/pill`, `--icon-*`, `--ls-eyebrow`).
- ✅ **H1 (badge dark-mode)** — warm badge/tag palette promoted to `--badge-*` tokens; **light look unchanged**, dark variants added so it's readable (was cream-on-cream). Surgical approach per decision.
  - ⚠️ **Regression caught + fixed (v835):** the retheme missed a stray `#412402` warm-brown used for watch description/background/functions **body text** (preview + edit cards) — dark-on-dark in dark mode. Mapped to `var(--badge-text)`. Re-scanned: no other hardcoded foreground colors remain on `--badge-bg` cards.
- ✅ **H2 (danger reds)** — `#ef4444`/`#f87171` → `var(--danger)` (kept intentional `#b91c1c` nuclear-delete + email red).
- ✅ **H3 (success greens)** — admin/What's-New chrome greens → `var(--success)`; **timegrapher/measurement instrument neon `#4ade80` intentionally kept**.
- ✅ **M1 (radius, partial)** — 27 app `border-radius:10px` → `var(--radius)`; `99px` pill typo fixed; shipped `.feat-pill` fixed to `var(--gold)`. (Button-radius 6px/8px/10px unification still open.)

- ✅ **H4 (gold accent, partial, v836)** — `.rec-tag-weekend` → `var(--gold)`. Most `#c9a84c` are legitimately literal (token defs, `w.color` user-data fallbacks, chart/category palettes, logo, demo banner). **`rgba(201,168,76,α)` tints deferred** — converting needs `color-mix` (iOS <16.2 would drop the tint) for a subtle light-mode hue fix; low value vs compat risk.
- ✅ **Phase 3 wording (partial, v836)** — `Block user`→`Block User`; block-confirm `No thanks`→`Cancel`; `Save Changes`→`Save` (edit-log/club/campaign). Casing + one dismiss + one affirmative label.

**Still open (larger / visual — best done incrementally with live-site review):**
- **Avatar initials — luminance-based text color (planned).** Initials are `#fff` in some sites, `#000` in others; both fail for some user-chosen watch colors (dark dial → white; light dial → black). Build one helper `initialsTextColor(bg)` (relative-luminance threshold → `#000`/`#fff`) and route every initials-avatar render through it (≈13 sites: `.avatar`, `.showcase-card-avatar`, `.feed-wearing-watch-avatar`, `.wl-card-avatar`, `.pp-fallback`, the inline 28/32/22/48px renders). Mirror into `wrotate_test.js` + unit-test the threshold. Replaces the current `#fff`/`#000` inconsistency with a correct, contrast-aware choice.
- H7 (`.pill` primitive + unify 3 visibility-badge systems), H5 (spacing-scale migration — shifts pixels), H6 (type scale + `.eyebrow` class, ~100 labels), M2/M3 (one destructive verb + one confirm pattern via `showConfirm()`), M6 (icon-size/hit-area), L1–L8. None are blocking; all are appearance/structure changes that benefit from an eyeball per step.

## Dark-mode contrast sweep — 2026-06-28 (v837–v838)

Rather than fix reported cases one-by-one, ran a **systematic audit of every hardcoded
color**, tracing each foreground's *effective background* including inherited parent
surfaces (the trap that hid `#412402`). Findings + fixes:

- ✅ `#412402` watch desc/edit body text → `var(--badge-text)` (v835).
- ✅ Re-enhance button `background:#fff` (light-gold text) → transparent ghost (v837).
- ✅ af2 status/check green `#3B6D11` (6 sites) → `var(--success)` (was dark green on `--surface`, invisible in dark).
- ✅ `.tag-pill.suggested` text `rgba(133,79,11,.7)` → `var(--badge-accent)`.
- ✅ `.af2-warn-chip` → self-contained solid amber (`#fde68a`/`#7c2d12`); faint translucent chip was unreadable in dark.
- ✅ `.watch-suggestion .sug-yes` white-on-gold → `#000` (matches every other gold button).
- ✅ 10 avatar render sites → added `w.color||'#c9a84c'` fallback (null color → transparent bg → invisible initials edge case).

**Verified safe, intentionally left:** `#000`/dark text on `var(--gold)` (avatars, cells,
banners, buttons — gold is light in both themes); white toggle knobs; Google branded
button; email templates + email/broadcast previews; landing block + demo banner;
timegrapher instrument neon + dark instrument panels; data-viz/chart palettes; brand SVGs;
self-contained pairs (frozen streak cell). **Known limitation:** avatar initial text is
`#fff` in some sites / `#000` in others — both are wrong for *some* user-chosen watch
colors (dark dials vs light); correct fix is luminance-based text color (deferred, not a
blind flip). Dead code `.wpm-hero-avatar` and dev-login greys noted, not user-facing.

## Verdict

**The foundations exist but are bypassed.** There is a real token layer (`:root`
`--bg/--surface/--border/--gold/--gold-lt/--gold-dim/--text/--muted/--danger/--success/--radius`,
light+dark) and good shared primitives (`toast()` used 306× with **zero** native
`alert()/confirm()`, `.chip`, `.overlay/.modal`, `officialBadgeHtml()`, form
`.field-error`). But **~1,722 inline `style=`** attributes and ~221 inline-styled
buttons route around the system, producing heavy drift:

- **67 distinct font-sizes**, **61 distinct spacing values**, **25 border-radii**
- **5 radii used for "pill"**, **17 hand-rolled pill/badge variants**, **3 visibility-badge systems**
- Danger red expressed as `--danger`, `#ef4444`, `#f87171`, `#b91c1c`, `#e55`; success green 5 ways
- An entire **`#854F0B/#3D2A14/#FAEEDA` badge/tag theme (~90 sites) that breaks dark mode**
- Same destructive action as **"Delete" vs "Remove" vs bare ✕** with **3 different confirm patterns**

None are functional bugs (one label to verify, below); all are consistency/theming.

---

## HIGH severity

### H1. Hardcoded color themes that break dark mode (~90+ sites)
A secondary gold-brown palette is hardcoded outside the token system and never adapts:
`#854F0B` (gold-brown, 23×), `#3D2A14` (badge name text, ~60×), `#FAEEDA`/`#FBF6E8`
(cream backgrounds), `#BA7517` (borders) — badge wall, tag pills, "af2" auto-follow UI,
badge modals. Cream-on-cream in dark mode = wrong/low-contrast.
Anchors: L882-883, L1219+, L1408-1428, L4892-4893, L4983-4984, L16703, ~L19793.
→ Route to `var(--gold)`/`var(--text)`/`var(--surface2)`/`var(--gold-dim)`/`var(--border)`.

### H2. Danger red drift — `--danger (#e05555)` bypassed (~37 sites)
Destructive meaning carried by `#ef4444` (18×), `#f87171` (6×), `#b91c1c`, `#f43f5e`,
`#d64040`, plus stale fallback `var(--danger,#e55)` (11×, `#e55`≠token). The most
prominent delete buttons hardcode reds despite a correct `.btn-danger` class existing.
Anchors: L1673, L4693/4697/4706/4728/4731, L8568, L23195/23357/23520/23842/23854.
→ Use `.btn-danger` / `var(--danger)`; fix the `#e55` fallbacks.

### H3. Success green drift — `--success (#4caf7d)` bypassed (~30 sites)
At least five greens mean "good/active": `#4ade80` (19×), `#22c55e` (11×), `#34d399`,
`#2a9d5c`, `#6ee7b7`. Leaks from the timegrapher neon aesthetic into general status/admin UI.
Anchors: L301, L2167, L3603-3659, L13241/13449/13493, L23596+.
→ `var(--success)` for status; keep instrument neon only if intentional.

### H4. Dark-gold accent + tint hardcoded (~40 sites)
`#c9a84c` (the *dark* value of `--gold`) and `rgba(201,168,76,α)` at ~13 alphas used as
real UI accents (not user data) — shows dark gold in light mode. Anchors: L446, L562-786
(CSS tints), L1367, L2702, L18469-18473. → derive from `var(--gold)`/`var(--gold-dim)`.

### H5. No spacing scale — 61 distinct values, off-grid (whole app)
255×`.5rem`, 195×`.75rem`, 136×`.4rem`(6.4px, off-grid), 96×`.6rem`(9.6px, off-grid),
plus near-dup clusters `.4/.45/.5/.55/.6/.65rem` used interchangeably. No 4/8px grid.
→ Introduce `--space-1..8` (4/8/12/16/20/24/32) and migrate heavy hitters; most call
sites (`.5/.75/1rem`) are already one token away.

### H6. Typography — 67 font-sizes, "small text" cluster is 20 near-dups (504 uses)
`.55–.85rem` spans 20 distinct values for one role ("secondary text"): 111×`.78`,
108×`.85`, 108×`.82`, 105×`.72`, 90×`.8`… plus px (`12/11/10px`) and 3 `em` sizes
expressing the same visual size three ways. No `--fs-*` tokens.
→ Collapse to `--fs-2xs..3xl` (~9 steps); convert px/em onto the rem scale.

### H7. Pills/badges/chips — 17 hand-rolled variants, 5 radii, no `.pill` primitive
Same "small rounded label" reimplemented with radii 4/6/8/12/20/999px and bespoke
padding/size/color each time. Includes **3 separate visibility-badge systems**
(`.vis-badge` L1734, `.profile-post-vis` L444, `.showcase-priv-label` L449 — purple is
`#a78bfa` in one, `rgba(168,130,255)` in another) and the **`.feat-pill` I shipped
(L10241) hardcoding `#b8860b` instead of `var(--gold)`**. Toast radius `99px` (L20450)
is a typo-drift from `999px`.
→ One `.pill` (token-driven) + modifiers `--gold/--danger/--success/--sm`; unify the
3 visibility badges into one with state modifiers.

---

## MEDIUM severity

### M1. `--radius` bypassed more than used
29× hardcoded `border-radius:10px` vs 42× `var(--radius)` (~41% bypass). Buttons split
across 8px (`.btn` default), 6px (L277/1307/1316/1421/1422/1444), 10px. Anchors: L983,
L2124, L16703. → mechanical swap to `var(--radius)`; pick one button radius (8px).

### M2. Two confirmation systems for destructive actions
Canonical async `showConfirm()` (L12826) used at L8252/8321/15564/15607/20900, **but**
three ad-hoc inline-toast confirms with hand-styled buttons duplicate it: Block (L7847),
Block again with different copy (L10727), Suspend (L13308). Two different Block dialogs
exist for one action. → route all through `showConfirm()`; delete the duplicate Block.

### M3. Destructive verb + styling inconsistent for the same concept
"Delete" (post/comment/watch/wishlist) vs "Remove" (friend/member/featured/strap/photo)
vs bare ✕ (wear log/receipts/timegrapher). Three confirm patterns: inline "Sure?"
double-tap, "Yes, Delete" modal, and **no confirmation at all** (strap, friend) — a wear
log needs two taps but removing a friend needs none. Anchors: L8149/8568/13163/16920 vs
L10302/4253/4454. → one verb per object type + one confirm pattern.

### M4. Status-triad copy-pasted; ambers/greys drift
`|rate|≤5?'#22c55e':≤15?'#eab308':'#ef4444'` duplicated at L23195/23357/23520/23842;
amber is `#eab308`/`#fbbf24`/`#f59e0b` interchangeably. Muted grey: stale
`var(--muted,#6e6e7a)` (L6083/6092), `#94a3b8`, `#9aa`, `#888/#999/#555` (in-app).
→ one helper for the triad; in-app greys → `var(--muted)`.

### M5. Affirmative button label varies for the same task
"Save" vs "Save Changes" vs "Save Selected/Ranking/All" — the edit-log modal says
"Save Changes" (L4950) while the structurally identical edit-post modal says "Save"
(L4676). Dismiss: "Cancel"/"Close"/"Done"/"Got it"/"No thanks". (Button **order** is
consistently primary-first — good.) → normalize "Save"/"Cancel".

### M6. Icon sizing split
SVG sizes 10–48px; small icons split 13 (43×) vs 14 (31×) with no rule. In the feed
action bar, **like/comment are 15×15 but share/add-photo are 13×13** (L10377/10426).
Icon-only buttons (`feed-action-btn`/`feed-edit-btn`/`btn-icon`) have 3 different
paddings and **no min hit-area except inside the mobile media query** (L1510-1511).
→ `--icon-sm/md/lg`; one icon-button class with a 40–44px min target.

### M7. Loading/empty states bypass the existing primitives
A good `.empty` (L1168) + `.feed-skeleton` (L591) + `.spinner` exist but are bypassed by
**~23 inline `Loading…` divs** with differing padding/size and inconsistent ellipsis
(`…`/`...`/`&#8230;`), a 4×-duplicated inline spinner (L16145/16167/16197), and 5+
bespoke empty-state classes. → `loadingHtml()` + route empties through `.empty`.

---

## LOW severity

- **L1. 96 `<div onclick>` "fake buttons"** — not focusable, no `role="button"` (e.g. feed menu items L10302/10398, `profile-stat-btn` L7246).
- **L2. Repeated inline blocks** → helpers: `avatarFallback(name,size)` (~7 sites), `.admin-card` wrapper (~20 sites L13525/13666+).
- **L3. Duplicate `.toggle-slider` definition** (L374 vs L418) with different radius/colors — redefinition collision.
- **L4. Modal close affordance 4 ways** (`.btn-icon` X, absolute hand-rolled X L2331/4892/4893, bottom Close, ghost X) + badge modals override chrome inline. Add `.modal-close`.
- **L5. Font-weight has no semantic mapping** — 600/700 interchangeable; `800` (19×) and `300` (1×) outliers. Define `--fw-*`.
- **L6. line-height** `1.4/1.45/1.5/1.55/1.6` all "paragraph" — collapse to `--lh-body:1.55`.
- **L7. "Block user" vs "Block User"** casing (L10409 vs L7228); "No thanks" vs "Cancel" (L10727).
- **L8. Three "share" glyphs** — upload-arrow (feed L10426) vs connected-nodes (profile/invite L7535/3065), and `shareApp()` uses different icons at L3065 vs L4533.

## Item to verify (not a defect, flagged)
- **L10400** own-post kebab "Report a comment" sits directly under "Edit post" and passes
  the owner's own `user_id` to `openReport`. The flow branches on `isOwnPost` (L10607) so
  it works, but the label/placement is easy to misread. Confirm intent / add separation.

---

## What's already consistent (leave alone)
`toast()` (306×, no native dialogs) · `.chip` (admin tabs/filters/selectors) ·
Follow/Friend via single `friendActionBtn()` (L12360, reused on profile L7224) ·
modal button **order** (primary-first everywhere) · `officialBadgeHtml()` ·
form `.field-error` validation. Exempt from token rules: email templates (~L14710-15491,
clients ignore CSS vars), Google-brand SVG fills, medal bronze/silver, data-viz palette,
timegrapher instrument surfaces.

---

## Recommended remediation roadmap

**Phase 0 — tokens (no visual change):** add `--space-1..8`, `--fs-*`, `--fw-*`,
`--lh-*`, `--radius-sm/btn/pill`, `--icon-sm/md/lg`, and gold/danger/success tint helpers.

**Phase 1 — high-impact, low-risk, mostly mechanical**
1. Danger reds → `var(--danger)` / `.btn-danger` (H2) and success greens → `var(--success)` (H3).
2. Retire the `#854F0B/#3D2A14/#FAEEDA` theme → tokens (H1) — biggest dark-mode fix.
3. Hardcoded `10px` radius → `var(--radius)`; pills → `--radius-pill` incl. the `99px` typo (M1/H7).
4. Fix the `.feat-pill` I shipped → `var(--gold)`/`var(--gold-dim)` (H7).

**Phase 2 — shared primitives**
5. One `.pill` + unify the 3 visibility badges (H7).
6. `loadingHtml()`/`.spinner`/`.empty` everywhere (M7); `.modal-close` (L4); `avatarFallback()`, `.admin-card` (L2).
7. `.eyebrow`/`.eyebrow--muted` to replace ~100 ad-hoc uppercase labels (H6).

**Phase 3 — wording/behavior**
8. One destructive verb per object + one confirm pattern via `showConfirm()` (M2/M3).
9. Normalize Save/Cancel labels (M5); fix casing + "No thanks"→"Cancel" (L7); one share glyph (L8).
10. Standardize feed-bar icon sizes + icon-button hit-area (M6).

**Sequencing note:** Phase 0+1 are safe to ship together (token swaps, snapshot-verifiable
in both themes). Phase 2/3 touch markup and wording — do per-component with the existing
test suite (1217 unit + 115 mocked E2E) and a dark/light visual pass each. Bump SW cache
on every change.
