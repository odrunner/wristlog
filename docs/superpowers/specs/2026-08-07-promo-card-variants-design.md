# WRotate feed promo cards — variants

Two selectable treatments for house-authored feed items, chosen per slot in the
admin composer. Source design: Claude Design options 1c and 1d, 2026-08-07.

- `variant: "tag"` — Caseback tag (option 1c). Use for nudges, tips,
  follow/wishlist suggestions, small announcements.
- `variant: "band"` — Full-bleed band (option 1d). Use for surveys /
  "help us improve" asks and major announcements.
- `variant: "classic"` — the original card (hero image + rich body). The column
  default, so every slot authored before this feature keeps the look it
  shipped with.

Both variants come in two sizes: `size: "prompt"` (headline + body + primary
CTA) and `size: "nudge"` (single line + inline CTA).

---

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `gold` | `#8A6D1B` | primary brand, tag border/text, CTA fill |
| `gold-deep` | `#6E5514` | hover, band gradient end |
| `gold-bright` | `#9A7B22` | band gradient start |
| `gold-light` | `#C8A33A` | labels on dark |
| `parchment` | `#F3EFE1` | tag header strip |
| `tag-line` | `#D9C48A` | tag border + dashed perforation |
| `sand` | `#F0E2B4` | band CTA hover, band label |
| `band-body` | `#EEE3C6` | band body copy |
| `ink` | `#1B1712` | headings, dark surfaces |
| `ink-2` | `#A9A196` | body copy on dark |
| `muted` | `#6B6478` | body copy on light |

Type: existing UI sans for content; a mono face at 500/600 for the brand
eyebrow label — this mono label is the shared signature across both variants
and should never be swapped for the body sans.

## Variant A — Caseback tag (`tag`)

Silhouette is the differentiator: it must not look like the user-post rounded
rectangle.

- Container: `background #fff`, `border 1.5px solid #D9C48A`,
  `border-radius 14px` (user posts are 16px+), **no drop shadow**,
  `overflow hidden`, `position relative`.
- Header strip: `background #F3EFE1`, `border-bottom 1.5px dashed #D9C48A`,
  padding `11px 18px`, flex row, `gap 9px`, `align-items center`.
  - Brand dot: 18×18 circle, `border 2px solid #8A6D1B`, centered 4×4 gold dot.
  - Eyebrow: mono 11px / 600 / `letter-spacing .16em` / uppercase / gold.
    Text = `WROTATE HQ`.
- Notches: two 14×14 circles, `background` = feed bg, `border 1.5px solid
  #D9C48A`, at `left:-8px` / `right:-8px`, `top:33px` — centered on the dashed
  line. If the header strip height changes, recompute `top`.
- Body: padding `20px 18px`, column, `gap 13px`.
  - Headline: 21px / 800 / `letter-spacing -.01em` / ink.
  - Body: 15px / 400 / `line-height 1.5` / muted / `text-wrap: pretty`.
  - CTA (`prompt`): full-width button, gold fill, white 15px/800,
    `padding 13px`, `radius 9px`; hover `#6E5514`.
- `nudge` size: strip padding `8px 16px`, mono 10px eyebrow, no brand dot
  (notch `top` moves to 21px); body row `padding 14px 16px`, flex row `gap 14px`
  — title 16px/700, sub 13px muted, right-aligned button `padding 9px 15px`,
  `radius 8px`, gold fill.

## Variant B — Full-bleed band (`band`)

Breaks the card grid: spans the full feed width, no horizontal margin, no
border-radius, so the page gutter is cancelled for this item only.

- Container: `background linear-gradient(160deg, #9A7B22 0%, #6E5514 100%)`,
  padding `22px 20px 20px`, column, `gap 14px`, `overflow hidden`.
- Top tick rule: strip pinned to the top edge, `height 9px`,
  `repeating-linear-gradient(90deg, rgba(255,255,255,.28) 0 1.5px, transparent 1.5px 16px)`
  — reads as a minute track.
- Watermark: `WR` at 96px / 800 / white at `opacity .09`,
  `letter-spacing -.05em`, anchored `right:-14px; bottom:-30px`. Decorative,
  `aria-hidden`.
- Eyebrow: mono 11px / 600 / `.18em` / `#F0E2B4`. Text = `WROTATE ASKS` for
  surveys, `WROTATE SUGGESTS` for suggestions, `WROTATE NEWS` for
  announcements.
- Headline: 23px / 800 / `letter-spacing -.015em` / `line-height 1.15` / white.
- Body: 15px / `#EEE3C6` / `line-height 1.5` / `text-wrap: pretty`.
- CTA: pill, white fill, text `#6E5514` 15px/800, `padding 12px 26px`,
  `radius 999px`, `align-self flex-start`; hover `#F0E2B4`.
- `nudge` size: solid `#1B1712` (no gradient, no watermark), padding
  `15px 20px`, row layout; eyebrow `#C8A33A` mono 10px, title 16px/700
  `#FBFAF7`, sub 13px `#A9A196`; CTA = ghost pill, `1px solid #C8A33A`, gold
  text, hover fills gold with ink text. Stacks directly under a band prompt.

---

## Implementation notes (deltas from the source design)

The mock assumed a light-only feed with web fonts. Three deviations, all
deliberate:

1. **Mono face.** The mock specifies IBM Plex Mono. This app loads no web fonts
   at all — the whole UI is the system stack — so the eyebrow uses the platform
   mono (`ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`)
   rather than adding a font request to every feed render. Same signal, no new
   dependency.
2. **Dark theme.** WRotate ships light *and* dark, and the mock's palette is
   light-only. The band carries its own dark ground in both themes and is left
   exactly as specified. The tag is the one treatment painted on the app
   surface, so in dark it swaps to the theme's lighter gold (`#C9A84C` — the
   `#8A6D1B` ink-on-dark direction fails contrast), a near-black parchment
   (`#1D1A12`) and an ink CTA label on the now-light gold fill. The band's
   nudge bar gains gold hairlines in dark, where it would otherwise sit almost
   flush with the page ground.
3. **Rate limit.** The design note "at most one band per feed session" needed no
   new code: `promo_config.max_per_session` already caps cards per session (it
   is 1 today) and applies to every variant.

Behaviour the variants do NOT change: audience matching, positioning,
impression caps, the session budget, click delegation, HTML sanitizing and the
feedback-form CTA are all variant-blind. Every variant renders the same
`data-promo-id` / `data-promo-cta` hooks and the same `.promo-heading` /
`.promo-body` structure.

**No hero on the band.** `image_url` is honoured by classic and tag; the band
has no place for it (the gradient, tick rule and watermark are the surface).
The composer's field label says so; a slot that needs a hero picks classic.

**Two different defaults, on purpose.** The DB columns default to
`classic`/`prompt` so existing rows and SQL seeds keep rendering as they did.
The composer's *new slot* state is `tag`/`prompt`, the design's default for a
house-authored item. Loading an existing row into the composer always reflects
what the feed actually renders it as, so an unrelated copy edit can never
restyle a live slot on save.

## Where it lives

- Schema: `sql/2026-08-07-promo-card-variants.sql` (`promo_slots.variant`,
  `.size`, both CHECK-constrained).
- Renderer + registries: `renderPromoCard()`, `PROMO_VARIANT_LABELS`,
  `PROMO_SIZE_LABELS`, `promoVariantOf()`, `promoSizeOf()` in `index.html`.
- Styles: the "Promo card variants" block in `index.html`, after `.promo-cta`.
- Composer: Style + Size selects at the top of the admin Promos → Design panel;
  options are generated from the registries, so UI and renderer cannot drift.
- Tests: `e2e/promo-card.mock.spec.js` (variant rendering, fallbacks, hooks,
  gutter) and `e2e/promo-admin.mock.spec.js` (picker round-trip, save payload,
  legacy rows).
