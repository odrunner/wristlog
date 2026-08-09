# Design System — Shared Token File

**Date:** 2026-08-08
**Status:** Approved, not yet implemented

## Goal

Make the design tokens a single source of truth: change a colour, spacing step, or
type size in one file and have every page pick it up. Today the tokens are
copy-pasted into three pages plus a fourth inline override, and one copy has
already drifted.

A shared file is also the prerequisite for iterating in Claude Design — that tool
renders a project of preview files, and without a real CSS artifact there is
nothing to render or sync.

## Scope

**In:** the shared token layer only — the `:root` and `[data-theme="dark"]` custom
property blocks in `index.html`, `p/index.html`, and `profile/index.html`, plus the
`#auth-screen` forced-light override.

**Out, deliberately:**

- **Components.** ~700 classes in `index.html`; most are used exactly once and gain
  nothing from being shared. Moving them is a separate decision.
- **Badge tokens** (`--badge-*`), **semantic colours** (`--vis-friends`, `--warn`), and
  the **promo palette** (`index.html:1941-1963`). Verified single-surface: `p/` and
  `profile/` reference none of them. They stay in `index.html`.
- **`r.html`.** A dormant Reddit campaign landing page with its own unrelated
  palette and no dark theme. See "Follow-up" below.

## Current state

Token blocks in play:

| Location | Contents |
|---|---|
| `index.html:111-145` | `:root` — full set: colours, scale, badge, semantic |
| `index.html:146-160` | `[data-theme="dark"]` — colour + badge overrides |
| `index.html:253-257` | `#auth-screen` — third copy of the light colours |
| `p/index.html:28-38` | `:root` + `[data-theme="dark"]` — colour subset |
| `profile/index.html:30-53` | `:root` + `[data-theme="dark"]` — colour subset |

`p/` and `profile/` reproduce `index.html`'s values exactly. The only divergence is
dark `--gold-dim`: `index.html` uses `color-mix(in srgb, var(--gold) 12%, transparent)`,
the sub-pages hardcode `rgba(201,168,76,.12)`. These compute to the same colour.

Constraints confirmed by reading the code:

- **No build step.** `package.json` has only test scripts; HTML ships as-is and the
  iOS app is a WKWebView over the same files. The shared artifact must be a plain
  stylesheet the browser loads, not something compiled.
- **CSP already permits it.** All three pages declare `style-src 'self' 'unsafe-inline'`.
- **No flash of unstyled content.** `index.html:90` sets `data-theme` on
  `<html>` synchronously in an inline script *before* the `<style>` block, so a
  `<link>` placed after it is safe.
- **`#auth-screen` already carries the attribute.** `index.html:2660` is
  `<div id="auth-screen" data-theme="light">`, so a proper `[data-theme="light"]`
  selector makes the hardcoded override redundant.

## Design

### The file: `design-system.css`

Repo root, served at `/design-system.css` so one absolute path works from any depth.

Two rules only:

```css
:root, [data-theme="light"] { /* light colours + all scale tokens */ }
[data-theme="dark"]         { /* colour overrides only */ }
```

Pairing `:root` with `[data-theme="light"]` in one selector list gives the forced-light
case (the landing screen) without duplicating the values.

Contents — the shared set, taken verbatim from `index.html:112-134`:

- **Theme colours:** `--bg`, `--surface`, `--surface2`, `--border`, `--gold`,
  `--gold-lt`, `--gold-dim`, `--text`, `--muted`, `--danger`, `--success`, `--overlay-bg`
- **Scale (theme-independent):** `--radius`, `--radius-sm`, `--radius-btn`,
  `--radius-pill`, `--space-1..6`, `--space-8`, `--fs-2xs..3xl`, `--fw-*`, `--lh-*`,
  `--icon-*`, `--ls-eyebrow`

Dark `--gold-dim` adopts the `color-mix` form. It is the `index.html` spelling, it
derives from `--gold` instead of restating the hex, and Safari has supported
`color-mix` since 16.2 — the same browsers already running the app.

The sub-pages will receive scale tokens they do not currently use. That is roughly
600 bytes and means anything moved onto those pages later just works.

### Loading

In each of the three pages, immediately after the theme-init script and before the
existing `<style>` block:

```html
<link rel="stylesheet" href="/design-system.css">
```

Order matters: the inline `<style>` must come second so page-specific rules can
still override tokens if they need to.

### Service worker

`sw.js` serves non-navigation same-origin assets stale-while-revalidate
(`sw.js:56-67`), which would otherwise show a token change one page-load late.

- Add `/design-system.css` to `PRECACHE` (`sw.js:5`)
- Bump `CACHE` from `wristlog-v1039` to `wristlog-v1040`

`activate` deletes every non-matching cache, so the version bump forces a fresh
fetch. This is the existing per-change ritual in CLAUDE.md, not new discipline.

## Migration steps

1. Create `design-system.css` with the token set above.
2. `index.html` — delete the colour and scale declarations from `:root`
   (`112-134`); keep `--vis-friends`, `--warn`, and `--badge-*`. Delete the colour
   overrides from `[data-theme="dark"]` (`147-156`); keep the badge overrides.
3. `index.html` — delete the forced-light token declarations from `#auth-screen`
   (`253-257`, the explanatory comment included) and
   change its literal `background: #f5f5f8` / `color: #16161e` to `var(--bg)` /
   `var(--text)`. The element carries `data-theme="light"`, so these now resolve
   through the shared file.
4. `p/index.html` — delete both token blocks (`28-38`).
5. `profile/index.html` — delete both token blocks (`30-53`).
6. Add the `<link>` to all three pages.
7. `sw.js` — `PRECACHE` entry and version bump.

## Risks

- **A missed token breaks a page silently.** An undefined custom property falls back
  to the initial value, so text can go transparent rather than throw. Mitigated by
  diffing the declared set against every `var(--…)` reference in the three pages
  before deleting anything.
- **Offline regression.** If `PRECACHE` is missed, an offline launch renders
  unstyled. Covered by an explicit offline check below.
- **Stale cache on first deploy.** Returning users hold `wristlog-v1039`; the bump
  handles it, but this must ship together with the CSS file, not after it.

## Testing

- `npm test && npm run test:e2e` — full pre-commit suite.
- Load `/`, `/p/`, `/profile/?u=<test account>` in both themes and confirm no visual
  change. This is a pure refactor; anything that moves is a bug.
- Toggle to dark, then open the landing screen, and confirm it still forces light.
- DevTools → Offline, hard reload `/`, confirm styles survive.
- Verify from the MacBook Pro at `http://192.168.1.246:3000` before pushing.

## The Claude Design loop

Once the file exists, push a design-system project via `DesignSync` containing one
preview page that `<link>`s the *same* `design-system.css` and renders colour
swatches, the type scale, and the spacing ramp in both themes.

The loop is explicitly **one-way**: `DesignSync` uploads only — there is no webhook
or pull. Iterating in Claude Design produces changed values that get folded back
into `design-system.css` by hand, then re-pushed. Worth stating plainly so nobody
expects edits there to reach production on their own.

## Follow-up (separate change)

Retire `r.html`. Zero traffic since March 2026 (350 visits that month, 2 in July, 0
in August), the A/B split that fed it no longer exists in `index.html` — only a
stale comment at `index.html:7047` — and it tagged just 11 of 496 profiles (8 `a`,
3 `b`). It also carries a second copy of the Google and Apple OAuth handlers.

Retiring it touches more than the file: six `ab_landing` reads in `index.html`, the
`ab_variant` columns on `profiles` and `page_visits`, the AASA `exclude` entry for
`/r.html`, and two E2E fixtures (`e2e/helpers.js:177`, `e2e/app.mock.spec.js:25`).

Kept separate from this work so a regression in either is attributable to one change.
