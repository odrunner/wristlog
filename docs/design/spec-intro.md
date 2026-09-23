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

<!--COLOURS-->

## Scales

<!--SCALES-->

## Roles

What an element says it is. Change one of these to restyle every place that uses it.

| Role | Declarations |
|---|---|
<!--ROLES-->

Besides these, ~450 single-purpose classes carry one declaration each (`.u-mb-3` = `margin-bottom: var(--space-3)`).
They are generated, named after the token they read, and not something a redesign edits by hand.

## Components

| Selector | Declarations |
|---|---|
<!--COMPONENTS-->

## Promo cards (fixed palette)

A self-contained ticket palette, unaffected by the app theme except where noted.

| Token | Value | What it is for |
|---|---|---|
<!--PROMO-->

## If you want to propose a new look

The most useful deliverable is **a replacement set of token values** — the same names, new values, for both
themes — plus a note on anything in "What it must not break" you want to challenge and why. Everything in the
app rereads those tokens, so a full re-skin is a single file change, and I can render before/after screenshots
of every screen from it.
