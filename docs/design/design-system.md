# WRotate — design system

WRotate is a watch-collection app: people log which watch they wore, keep their collection and wishlist,
measure a mechanical watch's accuracy with the phone's microphone, and share to a small social feed.
It runs as one web app (also wrapped as an iOS app), phone-first, with public pages for a shared post,
a profile and a watch model.

This file is the whole visual system: every token with its light and dark value, the components built from
them, and the rules a redesign has to respect. It is generated from `design-system.css`, so it matches what
ships. **If you are proposing an alternative design, you are changing the values in the token tables — almost
nothing else needs to move.**

## The screens

Phone-first, five tabs plus a few full screens and about 44 modals:

| Where | What is on it |
|---|---|
| **Feed** | Posts from people you follow: photo, caption, the watch worn, likes and comments |
| **Track** | Today's pick and a one-tap "worn today" log; streaks |
| **Collection** | The user's watches as cards or a gallery; each opens a detail modal |
| **Wishlist** | Watches they want, in tiles or folders |
| **Stats** | Wear counts, cost-per-wear, collection value, charts |
| **Measure (timegrapher)** | The microphone instrument: a live scatter of beats, rate and amplitude readouts |
| **Watch model page** | A reference page per model: specs, owners, accuracy across owners |
| **Public pages** | A shared post, a public profile, a shared model page — seen by people with no account |
| **Sign-in** | The only logged-out screen: logo, tagline, three feature callouts, Google/Apple buttons |
| **Admin** | One person's back office: metrics, broadcasts, experiments. Ugly is acceptable here |

## How it is put together

- **One stylesheet.** `design-system.css` holds the tokens and the shared components. Every page links it and
  no page re-declares a token.
- **Two themes.** Light is the default; `[data-theme="dark"]` overrides 21 tokens. Everything else inherits,
  so most of the system is theme-independent. The sign-in screen is always light.
- **Nothing is hand-typed.** No colour, size, spacing, radius, shadow, duration or transparency appears as a
  literal anywhere in the app — they all read a token. A test fails the build if a literal reappears.
- **Elements say what they are.** ~370 elements carry a role (`.text-meta`, `.row-between`, `.panel`), so
  restyling "secondary text" or "a row" is one edit, not 79.

## The character today

Warm and quiet. A single gold accent (`--gold`) on near-neutral greys that carry a slight blue cast
(`#f5f5f8` / `#16161e`), the system font, generous 4px-based spacing, 10px corners, and shadows used sparingly.
Three areas break out of the neutral palette on purpose:

- **The timegrapher** (the measuring screen) is a fixed green-on-black instrument in both themes, like the
  bench tool it imitates.
- **Badges and achievements** use a warm parchment-and-gold palette of their own.
- **Promo cards** (in-feed announcements) are a fixed "paper ticket" palette, with a punched notch.

## What an alternative design can change freely

Every value in the tables below. In particular:

- the neutral ramp (`--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--muted`) and their dark values
- the accent (`--gold` family) — including switching to a different hue entirely
- the type scale, weights, line heights and the font stacks
- spacing and size scales, corner radius, shadows, motion, transparency
- the character of the three break-out areas above

## What it must not break

These are not style preferences; they are the reasons the current values were chosen.

1. **Contrast.** Text tokens were measured to clear WCAG AA 4.5:1 on every surface they sit on. That is why
   text gold (`--gold-text`) differs from surface gold (`--gold`), and why danger and success each have a
   separate text value. Keep the pattern: one value for fills, a darker one for text.
2. **Tap targets.** Buttons are at least 44px tall on phones. The small size (`.btn-sm`) is 32px and exists
   only for toolbars that were measured to fit on one line.
3. **Form inputs stay at 16px on phones** (`--fs-input`). Anything smaller makes iOS zoom in when the field
   is focused.
4. **Watch colours are data, not styling.** The 12 `--watch-*` values are saved with each user's watches;
   changing them splits old and new records. A new palette needs a data migration, so treat them as fixed.
5. **Brand artwork is fixed:** the Google and Apple sign-in colours, and the app icon.
6. **Email is outside the system.** Mail clients cannot read CSS variables, so the email templates keep
   literal colours. A redesign should hand over new literal values for them separately.
7. **The dark theme must redeclare aliases.** A `var()` inside a token resolves where it is declared, so an
   alias written only in light freezes the light value into dark.

## Colour tokens


### Surfaces and text

| Token | Light | Dark | Uses | What it is for |
|---|---|---|---|---|
| `--bg` | `#f5f5f8` | `#0b0b10` | 16 |  |
| `--surface` | `#ffffff` | `#141419` | 66 |  |
| `--surface2` | `#eeeff5` | `#1c1c25` | 72 |  |
| `--border` | `#d8d9e8` | `#272734` | 163 |  |
| `--text` | `#16161e` | `#e6e6f0` | 79 |  |
| `--muted` | `#6a6a84` | `#82829d` | 250 | #70708a measured 4.41:1 on --bg and 4.18:1 on --surface2, under the 4.5:1 WCAG AA floor — 225 labels across feed/track/collection/wishlist/stats failed it. #6a6a84 clears 4.5 on all three light… |
| `--overlay-bg` | `rgba(245,245,248,.96)` | `rgba(11,11,16,.94)` | 1 |  |

### Brand gold

| Token | Light | Dark | Uses | What it is for |
|---|---|---|---|---|
| `--gold` | `#9a7628` | `#c9a84c` | 159 |  |
| `--gold-text` | `#8b6719` | `var(--gold)` | 94 | Gold used as TEXT needs to be darker than gold used as a surface. #9a7628 measures 4.20 on --surface, 3.86 on --bg and 3.66 on --surface2 — below the 4.5:1 WCAG AA floor. Darkening --gold itself… |
| `--gold-lt` | `#c9a84c` | `#dbbe72` | 14 |  |
| `--gold-dim` | `rgba(154,118,40,.12)` | `color-mix(in srgb, var(--gold) 12%, transparent)` | 24 |  |
| `--ring` | `0 0 0 1px var(--gold)` | same | 8 | Hover / chosen outline on round header buttons and swatches. An alias of --gold, repeated in the dark block on purpose: a var() inside a custom property resolves where it is DECLARED, so an alias… |

### Feedback

| Token | Light | Dark | Uses | What it is for |
|---|---|---|---|---|
| `--danger` | `#e05555` | same | 50 |  |
| `--success` | `#4caf7d` | same | 33 |  |
| `--danger-text` | `#b03636` | `var(--danger)` | 31 | Danger/success used as TEXT need darker values than the surface/border uses, exactly like --gold-text above. --danger #e05555 measures 3.27–3.75 and --success #4caf7d only 2.37–2.71 on the light… |
| `--success-text` | `#27714b` | `var(--success)` | 17 |  |
| `--status-good` | `#22c55e` | same | 14 |  |
| `--status-warn` | `#eab308` | same | 29 |  |
| `--status-bad` | `#ef4444` | same | 15 |  |
| `--status-expiring` | `#ef7942` | same | 3 | warranty running out; not worn for a while |
| `--danger-fill` | `#b91c1c` | same | 1 | a solid destructive button (white text), the same in both themes |
| `--streak-frozen-bg` | `#cfe8f5` | same | 1 | a streak day covered by a freeze (ice) |
| `--streak-frozen-ink` | `#0c4a6e` | same | 1 | a streak day covered by a freeze (ice) |
| `--chip-warn-bg` | `#fde68a` | same | 1 | a warning chip (AI add-a-watch) |
| `--chip-warn-ink` | `#7c2d12` | same | 1 | a warning chip (AI add-a-watch) |
| `--verified` | `#4ea4f6` | same | 5 | the official-account tick |

### Fixed inks

| Token | Light | Dark | Uses | What it is for |
|---|---|---|---|---|
| `--scrim` | `rgba(0,0,0,.55)` | same | 7 | Dimmed backdrop behind sheets, viewers and popovers. |
| `--white` | `#fff` | same | 58 | Fixed ink: white text on a photo or a dark scrim, black on a gold disc. The same in both themes on purpose — these sit on surfaces that do not follow the theme. |
| `--black` | `#000` | same | 56 |  |
| `--paper` | `#f5f5f8` | same | 3 | fixed off-white and sand: demo, promo, badges, admin previews |
| `--sand` | `#F0E2B4` | same | 4 | fixed off-white and sand: demo, promo, badges, admin previews |

### Tags, ranks, visibility

| Token | Light | Dark | Uses | What it is for |
|---|---|---|---|---|
| `--tag-type` | `var(--watch-indigo)` | same | 15 | the watch-type tag (indigo) |
| `--tag-strap` | `var(--watch-slate)` | same | 1 | strap tag (slate) |
| `--tag-weather` | `var(--watch-sky)` | same | 2 | weather recommendation tag (sky) |
| `--rating` | `#f59e0b` | same | 2 | feedback "rating" badge (amber) |
| `--vis-followers-lt` | `#f2dc9a` | same | 1 | visibility badges drawn on a photo scrim: lighter tints of --gold / --vis-friends / --danger |
| `--vis-friends-lt` | `#cbb2ff` | same | 1 | visibility badges drawn on a photo scrim: lighter tints of --gold / --vis-friends / --danger |
| `--vis-private-lt` | `#ff9f9f` | same | 1 | visibility badges drawn on a photo scrim: lighter tints of --gold / --vis-friends / --danger |
| `--vis-friends` | `#a78bfa` | same | 15 | visibility-state semantic colors (one hue per state, all surfaces) |

### Watch colours (saved with a watch)

| Token | Light | Dark | Uses | What it is for |
|---|---|---|---|---|
| `--watch-gold` | `#c9a84c` | same | 15 | watch colours — the colour a user gives a watch. It is SAVED with the watch, so code reads these as plain hex through dsToken() (index.html). Changing one changes what new watches get, not saved ones. |
| `--watch-green` | `var(--success)` | same | 0 | watch colours — the colour a user gives a watch. It is SAVED with the watch, so code reads these as plain hex through dsToken() (index.html). Changing one changes what new watches get, not saved ones. |
| `--watch-indigo` | `#818cf8` | same | 2 | watch colours — the colour a user gives a watch. It is SAVED with the watch, so code reads these as plain hex through dsToken() (index.html). Changing one changes what new watches get, not saved ones. |
| `--watch-orange` | `var(--status-expiring)` | same | 0 | watch colours — the colour a user gives a watch. It is SAVED with the watch, so code reads these as plain hex through dsToken() (index.html). Changing one changes what new watches get, not saved ones. |
| `--watch-sky` | `#38bdf8` | same | 1 |  |
| `--watch-fuchsia` | `#e879f9` | same | 0 |  |
| `--watch-rose` | `#f43f5e` | same | 0 |  |
| `--watch-slate` | `#94a3b8` | same | 4 |  |
| `--watch-amber` | `#fbbf24` | same | 0 |  |
| `--watch-emerald` | `#34d399` | same | 0 |  |
| `--watch-tangerine` | `#fb923c` | same | 0 |  |
| `--watch-violet` | `var(--vis-friends)` | same | 0 |  |
| `--watch-default` | `var(--watch-gold)` | same | 2 |  |

### Charts

| Token | Light | Dark | Uses | What it is for |
|---|---|---|---|---|
| `--uc-unspecified` | `#7a7a95` | same | 2 | use-case chart: no use case / an unknown one |
| `--uc-other` | `#888` | same | 2 | use-case chart: no use case / an unknown one |
| `--chart-grid` | `rgba(128,128,128,.15)` | same | 1 | charts (Chart.js draws on canvas: read through dsToken). Chosen to read on both themes. |
| `--chart-series-2` | `var(--watch-indigo)` | same | 1 | charts (Chart.js draws on canvas: read through dsToken). Chosen to read on both themes. |

### Timegrapher instrument

| Token | Light | Dark | Uses | What it is for |
|---|---|---|---|---|
| `--tg-ink` | `#4ade80` | same | 52 | Timegrapher instrument ── a fixed green-on-black readout in BOTH themes, like the screen of a bench timegrapher, so not overridden in dark. |
| `--tg-bg` | `#0a1a12` | same | 9 |  |
| `--tg-card-ink` | `#e8efd9` | same | 2 | the measurement share-card image |
| `--tg-error-bg` | `rgba(127,29,29,.3)` | same | 2 | the Listen button after a failed start |

### Badges and achievements

| Token | Light | Dark | Uses | What it is for |
|---|---|---|---|---|
| `--badge-text` | `#3D2A14` | `#e7d9bd` | 3 | Badges / achievements ── warm theme; dark variants below. |
| `--badge-accent` | `#854F0B` | `#dbbe72` | 16 |  |
| `--badge-bg` | `#FAEEDA` | `#221a0e` | 6 |  |
| `--badge-border` | `#BA7517` | `rgba(219,190,114,.35)` | 7 |  |
| `--badge-close` | `#6B5618` | `#c9a84c` | 5 |  |
| `--badge-tier` | `#B8952A` | `#dbbe72` | 3 |  |
| `--badge-deep` | `#633806` | `#d8b96a` | 1 |  |
| `--badge-ink` | `#3D2A14` | same | 57 | badge medallion glyph ink — fixed dark (disc is always --white, both themes), so NOT overridden in dark like --badge-text is. |
| `--badge-onboarding` | `#7A8B5C` | same | 3 | badge categories (BADGE_COLORS): a bezel, its ink (stroke + chip text) and a chip background. Collection uses the badge gold above; the rest are fixed hues, the same in both themes. |
| `--badge-onboarding-ink` | `color-mix(in srgb, var(--badge-onboarding) 58%, black)` | same | 2 | badge categories (BADGE_COLORS): a bezel, its ink (stroke + chip text) and a chip background. Collection uses the badge gold above; the rest are fixed hues, the same in both themes. |
| `--badge-onboarding-bg` | `color-mix(in srgb, var(--badge-onboarding) 20%, white)` | same | 1 | badge categories (BADGE_COLORS): a bezel, its ink (stroke + chip text) and a chip background. Collection uses the badge gold above; the rest are fixed hues, the same in both themes. |
| `--badge-connoisseur` | `#6B3D52` | same | 3 |  |
| `--badge-connoisseur-ink` | `color-mix(in srgb, var(--badge-connoisseur) 58%, black)` | same | 2 |  |
| `--badge-connoisseur-bg` | `color-mix(in srgb, var(--badge-connoisseur) 20%, white)` | same | 1 |  |
| `--badge-timegrapher` | `#4A6B7D` | same | 3 |  |
| `--badge-timegrapher-ink` | `color-mix(in srgb, var(--badge-timegrapher) 58%, black)` | same | 2 |  |
| `--badge-timegrapher-bg` | `color-mix(in srgb, var(--badge-timegrapher) 20%, white)` | same | 1 |  |
| `--badge-habit` | `#B5663F` | same | 3 |  |
| `--badge-habit-ink` | `color-mix(in srgb, var(--badge-habit) 58%, black)` | same | 2 |  |
| `--badge-habit-bg` | `color-mix(in srgb, var(--badge-habit) 20%, white)` | same | 1 |  |
| `--badge-hidden` | `#7A7A6A` | same | 3 |  |
| `--badge-hidden-ink` | `color-mix(in srgb, var(--badge-hidden) 58%, black)` | same | 2 |  |
| `--badge-hidden-bg` | `color-mix(in srgb, var(--badge-hidden) 20%, white)` | same | 1 |  |
| `--badge-locked` | `#C9C2A8` | same | 1 | medallion face; a locked badge |
| `--badge-locked-ink` | `#A8A28C` | same | 2 | medallion face; a locked badge |

### Demo mode and previews

| Token | Light | Dark | Uses | What it is for |
|---|---|---|---|---|
| `--demo-gold` | `var(--watch-gold)` | same | 2 |  |
| `--demo-gold-mid` | `#b8963f` | same | 1 |  |
| `--demo-gold-deep` | `#a6842e` | same | 3 |  |
| `--demo-ink` | `#16161e` | same | 9 |  |

### Sign-in buttons (brand rules)

| Token | Light | Dark | Uses | What it is for |
|---|---|---|---|---|
| `--google-ink` | `#3c4043` | same | 2 | Sign-in buttons: the providers' own colours (Google and Apple brand rules), the same in both themes. |
| `--google-line` | `#dadce0` | same | 2 | Sign-in buttons: the providers' own colours (Google and Apple brand rules), the same in both themes. |


## Scales


### Type sizes

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--fs-body` | `.9375rem` | 35 | The root size every em and every unsized element inherits from. Exactly 15px at the default 16px root; deliberately NOT a step of the scale below — moving it moves the whole app (and the landing… |
| `--fs-input` | `1rem` | 2 | Text inside inputs. iOS zooms the page when a focused field is under 16px, so this is a floor, not a step: do not lower it. |
| `--fs-3xs` | `.56rem` | 11 | Below the UI range: badge counts and chart ticks only. |
| `--fs-2xs` | `.62rem` | 47 |  |
| `--fs-xs` | `.68rem` | 61 |  |
| `--fs-sm` | `.75rem` | 110 |  |
| `--fs-base` | `.82rem` | 95 |  |
| `--fs-md` | `.88rem` | 42 |  |
| `--fs-xl` | `1.1rem` | 23 |  |
| `--fs-2xl` | `1.3rem` | 12 |  |
| `--fs-3xl` | `1.6rem` | 9 |  |
| `--fs-4xl` | `2.5rem` | 6 |  |
| `--fs-display` | `2rem` | 2 |  |
| `--fs-icon` | `1.75rem` | 1 |  |
| `--fs-aside` | `.85em` | 1 |  |
| `--fs-aside-sm` | `.75em` | 1 |  |

### Type weights

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--fw-normal` | `400` | 8 |  |
| `--fw-medium` | `500` | 18 |  |
| `--fw-semibold` | `600` | 82 |  |
| `--fw-bold` | `700` | 86 |  |
| `--fw-heavy` | `800` | 27 |  |

### Line heights

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--lh-none` | `1` | 26 | lh-none is for icons, numerals and single-line badges, never running text. |
| `--lh-tight` | `1.2` | 15 | lh-none is for icons, numerals and single-line badges, never running text. |
| `--lh-compact` | `1.3` | 2 | lh-none is for icons, numerals and single-line badges, never running text. |
| `--lh-snug` | `1.4` | 15 | lh-none is for icons, numerals and single-line badges, never running text. |
| `--lh-body` | `1.55` | 31 | lh-none is for icons, numerals and single-line badges, never running text. |
| `--lh-prose` | `1.7` | 0 | lh-none is for icons, numerals and single-line badges, never running text. |

### Letter spacing

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--ls-snug` | `.02em` | 7 |  |
| `--ls-wide` | `.16em` | 3 |  |
| `--ls-display` | `-.02em` | 5 |  |
| `--ls-tight` | `.04em` | 36 |  |
| `--ls-eyebrow` | `.08em` | 18 |  |

### Fonts

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--font-sans` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | 6 |  |
| `--font-mono` | `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace` | 10 |  |

### Spacing (rem, scales with text)

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--space-1` | `.25rem` | 153 | Spacing is in rem, like every font size here, so it follows the reader's text-size setting. At the default 16px root: 4 / 8 / 12 / 16 / 20 / 24 / 32. |
| `--space-2` | `.5rem` | 149 | Spacing is in rem, like every font size here, so it follows the reader's text-size setting. At the default 16px root: 4 / 8 / 12 / 16 / 20 / 24 / 32. |
| `--space-3` | `.75rem` | 126 | Spacing is in rem, like every font size here, so it follows the reader's text-size setting. At the default 16px root: 4 / 8 / 12 / 16 / 20 / 24 / 32. |
| `--space-4` | `1rem` | 120 | Spacing is in rem, like every font size here, so it follows the reader's text-size setting. At the default 16px root: 4 / 8 / 12 / 16 / 20 / 24 / 32. |
| `--space-5` | `1.25rem` | 68 |  |
| `--space-6` | `1.5rem` | 26 |  |
| `--space-7` | `1.75rem` | 11 |  |
| `--space-8` | `2rem` | 7 |  |
| `--space-9` | `2.25rem` | 1 |  |
| `--space-10` | `2.5rem` | 4 | larger steps (2026-09-22): panel padding, empty states, page breathing room |
| `--space-12` | `3rem` | 5 | larger steps (2026-09-22): panel padding, empty states, page breathing room |
| `--space-16` | `4rem` | 4 | larger steps (2026-09-22): panel padding, empty states, page breathing room |
| `--space-px` | `1px` | 18 | optical nudges: a border's width, an icon settling onto a baseline |
| `--space-0-5` | `.125rem` | 93 | Half steps (2 / 6 / 10 / 14px), added 2026-09-20. The UI is built from 5-7px and 10px gaps; without these, snapping to the scale moved things by 2px+ and it added up across a card. With them… |
| `--space-1-5` | `.375rem` | 130 | Half steps (2 / 6 / 10 / 14px), added 2026-09-20. The UI is built from 5-7px and 10px gaps; without these, snapping to the scale moved things by 2px+ and it added up across a card. With them… |
| `--space-2-5` | `.625rem` | 101 | Half steps (2 / 6 / 10 / 14px), added 2026-09-20. The UI is built from 5-7px and 10px gaps; without these, snapping to the scale moved things by 2px+ and it added up across a card. With them… |
| `--space-3-5` | `.875rem` | 72 | Half steps (2 / 6 / 10 / 14px), added 2026-09-20. The UI is built from 5-7px and 10px gaps; without these, snapping to the scale moved things by 2px+ and it added up across a card. With them… |

### Sizes (px, boxes and positions)

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--size-px` | `1px` | 9 | Sizes: widths, heights and positions on one ladder, N x 4px — every 4px up to 96px, every 20px above, in px so boxes do not grow with the text. --size-max is 'no limit' / off-screen, not a size. |
| `--size-0-5` | `2px` | 11 | Sizes: widths, heights and positions on one ladder, N x 4px — every 4px up to 96px, every 20px above, in px so boxes do not grow with the text. --size-max is 'no limit' / off-screen, not a size. |
| `--size-1` | `4px` | 19 | Sizes: widths, heights and positions on one ladder, N x 4px — every 4px up to 96px, every 20px above, in px so boxes do not grow with the text. --size-max is 'no limit' / off-screen, not a size. |
| `--size-1-5` | `6px` | 7 | Sizes: widths, heights and positions on one ladder, N x 4px — every 4px up to 96px, every 20px above, in px so boxes do not grow with the text. --size-max is 'no limit' / off-screen, not a size. |
| `--size-2` | `8px` | 28 | Sizes: widths, heights and positions on one ladder, N x 4px — every 4px up to 96px, every 20px above, in px so boxes do not grow with the text. --size-max is 'no limit' / off-screen, not a size. |
| `--size-2-5` | `10px` | 14 | Sizes: widths, heights and positions on one ladder, N x 4px — every 4px up to 96px, every 20px above, in px so boxes do not grow with the text. --size-max is 'no limit' / off-screen, not a size. |
| `--size-3` | `12px` | 17 | Sizes: widths, heights and positions on one ladder, N x 4px — every 4px up to 96px, every 20px above, in px so boxes do not grow with the text. --size-max is 'no limit' / off-screen, not a size. |
| `--size-3-5` | `14px` | 20 | Sizes: widths, heights and positions on one ladder, N x 4px — every 4px up to 96px, every 20px above, in px so boxes do not grow with the text. --size-max is 'no limit' / off-screen, not a size. |
| `--size-4` | `16px` | 43 | Sizes: widths, heights and positions on one ladder, N x 4px — every 4px up to 96px, every 20px above, in px so boxes do not grow with the text. --size-max is 'no limit' / off-screen, not a size. |
| `--size-5` | `20px` | 4 | Sizes: widths, heights and positions on one ladder, N x 4px — every 4px up to 96px, every 20px above, in px so boxes do not grow with the text. --size-max is 'no limit' / off-screen, not a size. |
| `--size-6` | `24px` | 23 |  |
| `--size-7` | `28px` | 29 |  |
| `--size-8` | `32px` | 33 |  |
| `--size-9` | `36px` | 16 |  |
| `--size-10` | `40px` | 11 |  |
| `--size-11` | `44px` | 4 |  |
| `--size-12` | `48px` | 18 |  |
| `--size-14` | `56px` | 6 |  |
| `--size-16` | `64px` | 15 |  |
| `--size-18` | `72px` | 12 |  |
| `--size-20` | `80px` | 10 |  |
| `--size-24` | `96px` | 4 |  |
| `--size-30` | `120px` | 5 |  |
| `--size-35` | `140px` | 4 |  |
| `--size-40` | `160px` | 7 |  |
| `--size-45` | `180px` | 4 |  |
| `--size-50` | `200px` | 8 |  |
| `--size-55` | `220px` | 5 |  |
| `--size-60` | `240px` | 1 |  |
| `--size-65` | `260px` | 4 |  |
| `--size-70` | `280px` | 3 |  |
| `--size-75` | `300px` | 2 |  |
| `--size-80` | `320px` | 6 |  |
| `--size-85` | `340px` | 1 |  |
| `--size-90` | `360px` | 5 |  |
| `--size-95` | `380px` | 2 |  |
| `--size-100` | `400px` | 4 |  |
| `--size-105` | `420px` | 6 |  |
| `--size-110` | `440px` | 1 |  |
| `--size-115` | `460px` | 1 |  |
| `--size-120` | `480px` | 7 |  |
| `--size-125` | `500px` | 1 |  |
| `--size-130` | `520px` | 4 |  |
| `--size-140` | `560px` | 1 |  |
| `--size-170` | `680px` | 1 |  |
| `--size-180` | `720px` | 1 |  |
| `--size-215` | `860px` | 1 |  |
| `--size-290` | `1160px` | 2 |  |
| `--size-max` | `9999px` | 3 |  |

### Corner radius

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--radius` | `10px` | 62 |  |
| `--radius-hair` | `2px` | 7 | bar tops, tiny chips |
| `--radius-xs` | `4px` | 16 |  |
| `--radius-sm` | `6px` | 34 |  |
| `--radius-btn` | `8px` | 50 |  |
| `--radius-lg` | `16px` | 8 |  |
| `--radius-pill` | `999px` | 26 |  |
| `--radius-round` | `50%` | 57 | A circle. Not the pill: 50% on a non-square box is an ellipse. |

### Shadows and glow

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--shadow-1` | `0 1px 4px rgba(0,0,0,.18)` | 4 | Elevation ── four levels, same light source: offset and blur double as a surface lifts. Pick by ROLE, never by eye: 1 a control on a surface (toggle knob, select box) 2 a card resting on the page… |
| `--shadow-2` | `0 2px 12px rgba(0,0,0,.18)` | 4 |  |
| `--shadow-3` | `0 4px 16px rgba(0,0,0,.25)` | 6 |  |
| `--shadow-4` | `0 8px 32px rgba(0,0,0,.4)` | 5 |  |
| `--glow-success` | `0 0 6px var(--success)` | 1 | the server-status dot |
| `--shadow-ring-tag` | `0 0 0 3px color-mix(in srgb, var(--tag-type) 20%, transparent)` | 1 | ranking game: hover |
| `--shadow-ring-win` | `0 0 0 3px color-mix(in srgb, var(--tg-ink) 25%, transparent)` | 1 | ranking game: winner |
| `--shadow-btn-hover` | `0 1px 6px color-mix(in srgb, var(--black) 20%, transparent)` | 2 |  |
| `--shadow-lift` | `0 4px 16px color-mix(in srgb, var(--black) 10%, transparent)` | 1 |  |
| `--shadow-drag` | `0 8px 32px var(--scrim)` | 2 | a card being dragged |
| `--shadow-toast` | `0 8px 32px color-mix(in srgb, var(--black) 15%, transparent), 0 0 12px color-mix(in srgb, var(--badge-tier) 6%, transparent)` | 1 |  |

### Motion

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--dur-fast` | `.15s` | 95 | Motion |
| `--dur-base` | `.2s` | 24 | Motion |
| `--dur-slow` | `.3s` | 5 | Motion |
| `--dur-xslow` | `.5s` | 1 | Motion |
| `--ease-standard` | `cubic-bezier(.4, 0, .2, 1)` | 1 |  |

### Opacity

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--opacity-ghost` | `.1` | 1 | a watermark |
| `--opacity-faint` | `.3` | 10 | disabled, not yet, empty |
| `--opacity-dim` | `.5` | 20 | set aside: dragging, skipped, inactive rows |
| `--opacity-soft` | `.7` | 13 | secondary: quieter text and icons, locked |
| `--opacity-hover` | `.85` | 5 | pressed / hovered |

### Breakpoints

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--bp-xs` | `375px` | 0 | Breakpoints. A media query cannot read a CSS variable, so these are the ONLY widths any @media may use (tests/design-system-tokens.test.js enforces it). The variables are here to name them and for… |
| `--bp-sm` | `420px` | 0 | Breakpoints. A media query cannot read a CSS variable, so these are the ONLY widths any @media may use (tests/design-system-tokens.test.js enforces it). The variables are here to name them and for… |
| `--bp-md` | `640px` | 0 | Breakpoints. A media query cannot read a CSS variable, so these are the ONLY widths any @media may use (tests/design-system-tokens.test.js enforces it). The variables are here to name them and for… |
| `--bp-lg` | `760px` | 0 | Breakpoints. A media query cannot read a CSS variable, so these are the ONLY widths any @media may use (tests/design-system-tokens.test.js enforces it). The variables are here to name them and for… |
| `--bp-xl` | `1060px` | 0 | Breakpoints. A media query cannot read a CSS variable, so these are the ONLY widths any @media may use (tests/design-system-tokens.test.js enforces it). The variables are here to name them and for… |

### Layers (z-index)

| Token | Value | Uses | What it is for |
|---|---|---|---|
| `--z-fab` | `90` | 1 | Layers ── one name per stacking layer, lowest first. A new fixed or absolute surface picks one of these; it does not invent a number. |
| `--z-raised` | `1` | 4 | stacking inside one component: a badge over a photo, a menu over its card |
| `--z-raised-2` | `2` | 4 | stacking inside one component: a badge over a photo, a menu over its card |
| `--z-raised-3` | `3` | 3 | stacking inside one component: a badge over a photo, a menu over its card |
| `--z-dropdown` | `10` | 1 | stacking inside one component: a badge over a photo, a menu over its card |
| `--z-card-menu` | `20` | 1 | stacking inside one component: a badge over a photo, a menu over its card |
| `--z-header` | `100` | 3 |  |
| `--z-modal` | `200` | 4 |  |
| `--z-modal-top` | `210` | 1 |  |
| `--z-nav` | `300` | 1 |  |
| `--z-modal-high` | `300` | 2 |  |
| `--z-toast` | `400` | 2 |  |
| `--z-toast-top` | `410` | 1 |  |
| `--z-auth` | `500` | 1 |  |
| `--z-menu` | `999` | 2 |  |
| `--z-skip` | `4000` | 1 |  |
| `--z-popover-backdrop` | `9998` | 1 |  |
| `--z-popover` | `9999` | 5 |  |
| `--z-top` | `10000` | 1 |  |


## Roles

What an element says it is. Change one of these to restyle every place that uses it.

| Role | Declarations |
|---|---|
| `.text-meta` | color: var(--muted); font-size: var(--fs-sm); |
| `.text-caption` | color: var(--muted); font-size: var(--fs-xs); |
| `.text-caption-xs` | color: var(--muted); font-size: var(--fs-2xs); |
| `.text-secondary` | color: var(--muted); font-size: var(--fs-base); |
| `.text-body` | color: var(--muted); font-size: var(--fs-base); line-height: var(--lh-body); |
| `.text-body-lg` | color: var(--muted); font-size: var(--fs-md); line-height: var(--lh-body); |
| `.text-default` | color: var(--text); font-size: var(--fs-base); |
| `.text-alert` | color: var(--danger-text); font-size: var(--fs-base); |
| `.row` | display: flex; align-items: center; gap: var(--space-2); |
| `.row-tight` | display: flex; align-items: center; gap: var(--space-1-5); |
| `.row-between` | display: flex; align-items: center; justify-content: space-between; |
| `.row-center` | display: flex; align-items: center; justify-content: center; |
| `.row-start` | display: flex; align-items: flex-start; gap: var(--space-2); |
| `.row-start-lg` | display: flex; align-items: flex-start; gap: var(--space-3); |
| `.row-inline` | display: inline-flex; align-items: center; gap: var(--space-1-5); |
| `.panel` | background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); |
| `.title-lg` | color: var(--text); font-size: var(--fs-xl); font-weight: var(--fw-bold); |
| `.img-cover` | display: block; width: 100%; height: 100%; object-fit: cover; |
| `.img-avatar` | width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-round); |
| `.badge-body` | color: var(--badge-text); font-size: var(--fs-sm); line-height: var(--lh-body); |

Besides these, ~450 single-purpose classes carry one declaration each (`.u-mb-3` = `margin-bottom: var(--space-3)`).
They are generated, named after the token they read, and not something a redesign edits by hand.

## Components

| Selector | Declarations |
|---|---|
| `.hidden` | display: none !important; |
| `.eyebrow` | font-size: var(--fs-sm); font-weight: var(--fw-bold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--gold-text); |
| `.eyebrow-muted` | color: var(--muted); |
| `.modal-close` | position: absolute; top: var(--size-2); right: var(--size-3); background: none; border: none; color: var(--muted); font-size: var(--fs-2xl); … |
| `.modal-close:hover` | opacity: 1; color: var(--text); |
| `.pill` | display: inline-flex; align-items: center; gap: var(--space-1); font-size: var(--fs-xs); font-weight: var(--fw-semibold); padding: … |
| `.card` | background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-5); min-width: 0; |
| `.card-label` | font-size: var(--fs-sm); font-weight: var(--fw-bold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--muted); … |
| `.form-group` | margin-bottom: var(--space-3-5); |
| `.form-row` | display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3-5); |
| `.field-error-msg` | color: var(--danger-text); font-size: var(--fs-sm); margin-top: var(--space-1); animation: fieldErrorIn .25s ease; |
| `.btn` | padding: var(--space-2-5) var(--space-4); border-radius: var(--radius-btn); border: none; font-size: var(--fs-base); font-weight: … |
| `.btn-primary` | background: var(--gold); color: var(--black); |
| `.btn-primary:hover` | background: var(--gold-lt); |
| `.btn-primary:disabled` | opacity: var(--opacity-faint); cursor: not-allowed; |
| `.btn-ghost` | background: var(--surface2); color: var(--text); border: 1px solid var(--border); |
| `.btn-ghost:hover` | border-color: var(--gold); color: var(--gold-text); |
| `.btn-danger` | background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger-text); border: 1px solid color-mix(in srgb, var(--danger) 25%, … |
| `.btn-danger:hover` | background: color-mix(in srgb, var(--danger) 20%, transparent); |
| `.btn-sm` | padding: var(--space-1-5) var(--space-3); font-size: var(--fs-sm); |
| `.btn-icon` | padding: var(--space-1-5) var(--space-2); background: none; border: none; color: var(--muted); cursor: pointer; font-size: var(--fs-base); … |
| `.btn-icon:hover` | color: var(--danger-text); |
| `.chips` | display: flex; flex-wrap: wrap; gap: var(--space-2); |
| `.chip` | background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-pill); padding: var(--space-1-5) var(--space-3-5); … |
| `.chip:hover` | border-color: var(--gold); color: var(--text); |
| `.chip.selected` | background: var(--gold-dim); border-color: var(--gold); color: var(--gold-text); |
| `.btn-loading` | opacity: var(--opacity-soft); cursor: not-allowed; |
| `.tag-pill` | background: var(--surface2); border: 1px solid var(--border); color: var(--muted); font-size: var(--fs-sm); font-weight: var(--fw-medium); … |
| `.tag-pill:hover` | border-color: var(--badge-border); color: var(--badge-accent); |
| `.tag-pill.active` | background: var(--badge-bg); border-color: var(--badge-border); color: var(--badge-accent); font-weight: var(--fw-semibold); |
| `.tag-pill.suggested` | border-color:var(--badge-border); color: var(--badge-accent); border-style: dashed; |
| `.modal-section` | border-top: 1px solid var(--border); margin-top: var(--space-3-5); |
| `.modal-section-hdr` | display: flex; justify-content: space-between; align-items: center; background: none; border: none; width: 100%; text-align: left; cursor: … |
| `.modal-section-hdr:hover .modal-section-hdr-label` | color: var(--text); |
| `.modal-section-hdr-label` | font-size: var(--fs-xs); font-weight: var(--fw-bold); letter-spacing: var(--ls-tight); text-transform: uppercase; color: var(--muted); transition: … |
| `.modal-section-chevron` | font-size: var(--fs-2xs); color: var(--muted); transition: transform var(--dur-base); display: inline-block; line-height: var(--lh-none); … |
| `.modal-section-chevron.open` | transform: rotate(90deg); |
| `.modal-section-body` | padding-bottom: var(--space-1); |
| `.modal-section-body.collapsed` | display: none; |
| `.overlay` | position: fixed; inset: 0; background: color-mix(in srgb, var(--black) 72%, transparent); backdrop-filter: blur(4px); display: flex; align-items: … |
| `.overlay.hidden` | display: none; |
| `.modal-title` | font-size: var(--fs-xl); font-weight: var(--fw-bold); margin-bottom: var(--space-6); |
| `.modal-actions` | display: flex; gap: var(--space-2-5); margin-top: var(--space-6); |
| `.table-wrap` | overflow-x: auto; max-height: var(--size-80); overflow-y: auto; |
| `.empty` | text-align: center; padding: var(--space-10) var(--space-4); color: var(--muted); |
| `.empty-icon` | font-size: var(--fs-4xl); opacity: var(--opacity-faint); margin-bottom: var(--space-3); |
| `.empty-text` | font-size: var(--fs-body); font-weight: var(--fw-bold); color: var(--text); margin-bottom: var(--space-1); |
| `.empty-sub` | font-size: var(--fs-base); opacity: var(--opacity-soft); |
| `.empty-compact` | padding: var(--space-6) var(--space-4); font-size: var(--fs-base); |
| `.form-row-3` | display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-3-5); |
| `.form-row-3 > .form-group` | min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; |
| `.item-title` | font-size: var(--fs-base); font-weight: var(--fw-semibold); margin-bottom: var(--space-1); |
| `.body-muted` | font-size: var(--fs-base); color: var(--muted); line-height: var(--lh-body); |
| `.note` | font-size: var(--fs-base); color: var(--muted); |
| `.note-md` | font-size: var(--fs-md); color: var(--muted); |
| `.caption` | font-size: var(--fs-sm); color: var(--muted); |
| `.caption-xs` | font-size: var(--fs-xs); color: var(--muted); |
| `.text-muted` | color: var(--muted); |
| `.text-gold` | color: var(--gold-text); |
| `.text-gold-strong` | color: var(--gold-text); font-weight: var(--fw-semibold); |
| `.text-danger` | color: var(--danger-text); |
| `.text-success` | color: var(--success-text); |
| `.divider-top` | margin: var(--space-3) 0; border-top: 1px solid var(--border); padding-top: var(--space-3); |
| `.stack-1` | margin-bottom: var(--space-1); |
| `.stack-1-5` | margin-bottom: var(--space-1-5); |
| `.stack-2` | margin-bottom: var(--space-2); |
| `.stack-2-5` | margin-bottom: var(--space-2-5); |
| `.stack-3` | margin-bottom: var(--space-3); |
| `.stack-4` | margin-bottom: var(--space-4); |
| `.stack-5` | margin-bottom: var(--space-5); |
| `.row` | display: flex; align-items: center; gap: var(--space-2); |
| `.row-tight` | display: flex; align-items: center; gap: var(--space-1-5); |
| `.row-between` | display: flex; align-items: center; justify-content: space-between; |
| `.grow` | flex: 1; |
| `.grow-clip` | flex: 1; min-width: 0; |
| `.btn-block` | width: 100%; |
| `.btn-grow` | flex: 1; |
| `.btn-xs` | font-size: var(--fs-sm); padding: var(--space-1) var(--space-2-5); |
| `.btn-md` | font-size: var(--fs-base); padding: var(--space-2) var(--space-3); |
| `.field.field-compact` | width: 100%; padding: var(--space-1); border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface); color: … |
| `.btn-plain` | background: none; border: none; color: var(--muted); cursor: pointer; padding: var(--space-1); |
| `.btn-ghost-gold, .btn-ghost-gold:hover` | border-color: var(--gold); color: var(--gold-text); |
| `.btn-ghost-muted, .btn-ghost-muted:hover` | border-color: var(--border); color: var(--muted); |
| `.btn-ghost-danger, .btn-ghost-danger:hover` | border-color: var(--danger); color: var(--danger-text); |
| `.adm-panel` | margin: 0 0 var(--space-2-5); padding: var(--space-2) var(--space-2-5); border: 0.5px solid var(--border); border-radius: var(--radius-btn); … |
| `.adm-panel-grid` | display: grid; grid-template-columns: minmax(0, 1.2fr) repeat(3, minmax(0, 1fr)); gap: var(--space-1) var(--space-2-5); align-items: baseline; |
| `.adm-panel-head` | font-size: var(--fs-2xs); text-transform: uppercase; letter-spacing: var(--ls-tight); color: var(--muted); |
| `.adm-panel-note` | margin-top: var(--space-1-5); |
| `.adm-panel-row` | display: contents; |
| `.adm-exp-name` | background: none; border: none; padding: 0; text-align: left; font: inherit; color: inherit; cursor: pointer; |
| `.adm-exp-name:hover` | color: var(--gold); |

## Promo cards (fixed palette)

A self-contained ticket palette, unaffected by the app theme except where noted.

| Token | Value | What it is for |
|---|---|---|
| `--promo-gold-deep` | `#6E5514` |  |
| `--promo-line` | `#D9C48A` |  |
| `--promo-cta-fg` | `#fff` |  |
| `--promo-edge` | `inset 0 1px 0 color-mix(in srgb, var(--watch-gold) 25%, transparent), inset 0 -1px 0 color-mix(in srgb, var(--watch-gold) 25%, transparent)` |  |

## If you want to propose a new look

The most useful deliverable is **a replacement set of token values** — the same names, new values, for both
themes — plus a note on anything in "What it must not break" you want to challenge and why. Everything in the
app rereads those tokens, so a full re-skin is a single file change, and I can render before/after screenshots
of every screen from it.
