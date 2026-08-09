# Design System Token File — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the shared design tokens out of three HTML files and one inline override into a single `design-system.css`, so changing a colour or spacing step in one place updates every page.

**Architecture:** A plain stylesheet at the repo root, served at `/design-system.css`, declaring `:root, [data-theme="light"]` and `[data-theme="dark"]`. The three pages that currently duplicate the tokens link it and delete their copies. A vitest drift-guard test enforces that no page ever re-declares an owned token again.

**Tech Stack:** Vanilla CSS/HTML, vitest for the guard test, existing service worker in `sw.js`.

**Spec:** `docs/superpowers/specs/2026-08-08-design-system-tokens-design.md`

## Global Constraints

- **This is a pure refactor. Zero visual change is the acceptance bar.** Any pixel that moves is a bug, not an improvement.
- **No build step exists and none may be added.** `package.json` has only test scripts; HTML ships verbatim.
- **Do not `git push` until Task 6 passes.** Intermediate commits leave the service worker and the pages out of sync; pushing mid-plan would deploy a broken offline experience.
- **Token values are copied verbatim.** Never retype a hex by hand — copy the exact string from the source file.
- **Only these tokens move:** the 44 light-theme tokens and 10 dark overrides listed in Task 1. `--vis-friends`, `--warn`, `--badge-*`, and `--promo-*` stay in `index.html`.
- **`r.html` is out of scope.** Do not touch it.
- **Bump the SW cache version** (`sw.js` → `wristlog-v1040`) as part of Task 5.
- **No "What's New" or Help entry.** This change is invisible to users; there is nothing to announce.

---

### Task 1: Create `design-system.css` and its content test

**Files:**
- Create: `design-system.css`
- Create: `tests/design-system-tokens.test.js`

**Interfaces:**
- Produces: `/design-system.css` declaring the 44 shared tokens under `:root, [data-theme="light"]` and 10 overrides under `[data-theme="dark"]`. Tasks 2-4 delete the duplicate declarations these replace.
- Produces: `tests/design-system-tokens.test.js` exporting nothing; later tasks extend it with new `it()` blocks.

- [ ] **Step 1: Write the failing test**

Create `tests/design-system-tokens.test.js`:

```js
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// The design tokens used to be copy-pasted into index.html, p/index.html and
// profile/index.html, plus a fourth inline copy under #auth-screen. r.html had
// already drifted on every one of them. design-system.css is now the only place
// these are declared; these tests are the guard that keeps it that way.
//
// Spec: docs/superpowers/specs/2026-08-08-design-system-tokens-design.md

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const css = readFileSync(join(root, 'design-system.css'), 'utf8');

// Tokens design-system.css owns. Nothing else may declare these.
export const SHARED_LIGHT = {
  '--bg': '#f5f5f8',
  '--surface': '#ffffff',
  '--surface2': '#eeeff5',
  '--border': '#d8d9e8',
  '--gold': '#9a7628',
  '--gold-lt': '#c9a84c',
  '--gold-dim': 'rgba(154,118,40,.12)',
  '--text': '#16161e',
  '--muted': '#70708a',
  '--danger': '#e05555',
  '--success': '#4caf7d',
  '--radius': '10px',
  '--overlay-bg': 'rgba(245,245,248,.96)',
  '--space-1': '4px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-5': '20px',
  '--space-6': '24px',
  '--space-8': '32px',
  '--radius-sm': '6px',
  '--radius-btn': '8px',
  '--radius-pill': '999px',
  '--fs-2xs': '.62rem',
  '--fs-xs': '.68rem',
  '--fs-sm': '.75rem',
  '--fs-base': '.82rem',
  '--fs-md': '.95rem',
  '--fs-lg': '1.1rem',
  '--fs-xl': '1.3rem',
  '--fs-2xl': '1.6rem',
  '--fs-3xl': '2.5rem',
  '--fw-normal': '400',
  '--fw-medium': '500',
  '--fw-semibold': '600',
  '--fw-bold': '700',
  '--lh-tight': '1.2',
  '--lh-snug': '1.4',
  '--lh-body': '1.55',
  '--icon-sm': '14px',
  '--icon-md': '16px',
  '--icon-lg': '20px',
  '--icon-xl': '24px',
  '--ls-eyebrow': '.08em',
};

export const SHARED_DARK = {
  '--bg': '#0b0b10',
  '--surface': '#141419',
  '--surface2': '#1c1c25',
  '--border': '#272734',
  '--gold': '#c9a84c',
  '--gold-lt': '#dbbe72',
  '--gold-dim': 'color-mix(in srgb, var(--gold) 12%, transparent)',
  '--text': '#e6e6f0',
  '--muted': '#7a7a95',
  '--overlay-bg': 'rgba(11,11,16,.94)',
};

// Returns the text between a selector's braces.
function blockFor(src, selector) {
  const at = src.indexOf(selector);
  if (at === -1) return null;
  const open = src.indexOf('{', at);
  const close = src.indexOf('}', open);
  return src.slice(open + 1, close);
}

// Custom properties declared in a chunk of CSS or HTML.
export function declaredIn(src) {
  const out = new Set();
  for (const m of src.matchAll(/(?:^|[;{])\s*(--[A-Za-z0-9_-]+)\s*:/g)) out.add(m[1]);
  return out;
}

// Custom properties referenced via var(), including the var(--x, fallback) form.
export function referencedIn(src) {
  const out = new Set();
  for (const m of src.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) out.add(m[1]);
  return out;
}

describe('design-system.css', () => {
  it('declares every shared light token with the expected value', () => {
    const block = blockFor(css, ':root, [data-theme="light"]');
    expect(block).not.toBeNull();
    for (const [name, value] of Object.entries(SHARED_LIGHT)) {
      expect(block, `missing ${name}`).toContain(`${name}: ${value};`);
    }
  });

  it('declares every dark override with the expected value', () => {
    const block = blockFor(css, '[data-theme="dark"]');
    expect(block).not.toBeNull();
    for (const [name, value] of Object.entries(SHARED_DARK)) {
      expect(block, `missing ${name}`).toContain(`${name}: ${value};`);
    }
  });

  it('overrides only the tokens that actually differ between themes', () => {
    const dark = declaredIn(blockFor(css, '[data-theme="dark"]'));
    expect([...dark].sort()).toEqual(Object.keys(SHARED_DARK).sort());
  });

  it('pairs :root with [data-theme="light"] so the forced-light landing screen works', () => {
    expect(css).toContain(':root, [data-theme="light"]');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/design-system-tokens.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open '.../design-system.css'`

- [ ] **Step 3: Create `design-system.css`**

Comments and grouping are carried over from `index.html` so the diff stays legible:

```css
/* WRotate design system — the single source of truth for design tokens.
   Loaded by index.html, p/index.html and profile/index.html. Do not
   re-declare any of these in a page; tests/design-system-tokens.test.js
   fails the build if you do.

   [data-theme="light"] is paired with :root so the landing screen, which
   carries that attribute, can force light regardless of the app theme. */

:root, [data-theme="light"] {
  --bg: #f5f5f8;
  --surface: #ffffff;
  --surface2: #eeeff5;
  --border: #d8d9e8;
  --gold: #9a7628;
  --gold-lt: #c9a84c;
  --gold-dim: rgba(154,118,40,.12);
  --text: #16161e;
  --muted: #70708a;
  --danger: #e05555;
  --success: #4caf7d;
  --radius: 10px;
  --overlay-bg: rgba(245,245,248,.96);

  /* ── Scale tokens (theme-independent) ── */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px;
  --radius-sm: 6px; --radius-btn: 8px; --radius-pill: 999px;
  --fs-2xs: .62rem; --fs-xs: .68rem; --fs-sm: .75rem; --fs-base: .82rem;
  --fs-md: .95rem; --fs-lg: 1.1rem; --fs-xl: 1.3rem; --fs-2xl: 1.6rem; --fs-3xl: 2.5rem;
  --fw-normal: 400; --fw-medium: 500; --fw-semibold: 600; --fw-bold: 700;
  --lh-tight: 1.2; --lh-snug: 1.4; --lh-body: 1.55;
  --icon-sm: 14px; --icon-md: 16px; --icon-lg: 20px; --icon-xl: 24px;
  --ls-eyebrow: .08em;
}

[data-theme="dark"] {
  --bg: #0b0b10;
  --surface: #141419;
  --surface2: #1c1c25;
  --border: #272734;
  --gold: #c9a84c;
  --gold-lt: #dbbe72;
  --gold-dim: color-mix(in srgb, var(--gold) 12%, transparent);
  --text: #e6e6f0;
  --muted: #7a7a95;
  --overlay-bg: rgba(11,11,16,.94);
}
```

Exactly one space after each colon — the test matches on `${name}: ${value};`, so the column alignment used in `index.html` today would fail it. The multi-token scale lines are matched by substring, so their internal spacing is already correct as written.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/design-system-tokens.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add design-system.css tests/design-system-tokens.test.js
git commit -m "design system: add design-system.css as the token source of truth"
```

---

### Task 2: Migrate `index.html`

**Files:**
- Modify: `index.html` — add `<link>` after line 92, strip tokens from `:root` and `[data-theme="dark"]`, strip the `#auth-screen` override
- Modify: `tests/design-system-tokens.test.js` — add the index.html guard

**Interfaces:**
- Consumes: `SHARED_LIGHT`, `SHARED_DARK`, `declaredIn`, `referencedIn` from Task 1's test file.
- Produces: `index.html` declaring only `--vis-friends`, `--warn`, `--badge-*` and `--promo-*`.

- [ ] **Step 1: Write the failing test**

Append to `tests/design-system-tokens.test.js`:

```js
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

// Referenced in index.html but declared nowhere — pre-existing as of 2026-08-08,
// unrelated to the token extraction. --bg-secondary, --bg2 and --tertiary carry
// var() fallbacks; these five do not and currently resolve to the initial value.
// Documented rather than fixed, because fixing them changes appearance.
const KNOWN_UNDECLARED = ['--accent', '--error', '--fg', '--hover', '--surface1',
                          '--bg-secondary', '--bg2', '--tertiary'];

describe('index.html', () => {
  it('links design-system.css before its inline style block', () => {
    const link = indexHtml.indexOf('<link rel="stylesheet" href="/design-system.css">');
    const style = indexHtml.indexOf('<style>');
    expect(link).toBeGreaterThan(-1);
    expect(link).toBeLessThan(style);
  });

  it('re-declares none of the tokens design-system.css owns', () => {
    const dupes = [...declaredIn(indexHtml)].filter(t => t in SHARED_LIGHT);
    expect(dupes).toEqual([]);
  });

  it('still declares its page-local tokens', () => {
    const declared = declaredIn(indexHtml);
    for (const t of ['--vis-friends', '--warn', '--badge-text', '--badge-ink', '--promo-gold']) {
      expect(declared.has(t), `${t} should stay in index.html`).toBe(true);
    }
  });

  it('references no token that nothing declares', () => {
    const declared = declaredIn(indexHtml);
    const orphans = [...referencedIn(indexHtml)]
      .filter(t => !(t in SHARED_LIGHT) && !declared.has(t) && !KNOWN_UNDECLARED.includes(t));
    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/design-system-tokens.test.js`
Expected: FAIL on "links design-system.css" and "re-declares none of the tokens" — index.html still holds its own copies.

- [ ] **Step 3: Add the stylesheet link**

In `index.html`, the theme-init script ends at line 92 with `</script>` and the inline styles open at line 93 with `<style>`. Insert between them:

```html
  </script>
  <link rel="stylesheet" href="/design-system.css">
  <style>
```

Order is load-bearing: the link must come *after* the theme script (so `data-theme` is already on `<html>`) and *before* `<style>` (so page rules can still override tokens).

- [ ] **Step 4: Strip the shared tokens from `:root`**

Delete lines 112-134 — everything from `--bg:` through `--ls-eyebrow:` including the `/* ── Design-system scale tokens (theme-independent) ── */` comment. The rule keeps its remaining contents and becomes:

```css
    :root {
      /* visibility-state semantic colors (one hue per state, all surfaces) */
      --vis-friends: #a78bfa;
      --warn: #d9a441;
      /* badge/achievement warm theme — light values = current look */
      --badge-text: #3D2A14; --badge-accent: #854F0B; --badge-bg: #FAEEDA;
      --badge-bg2: #FBF6E8; --badge-border: #BA7517; --badge-close: #6B5618;
      --badge-tier: #B8952A; --badge-deep: #633806;
      /* badge medallion glyph ink — fixed dark (disc is always cream #FEFCF6,
         both themes), so NOT overridden in dark like --badge-text is. */
      --badge-ink: #3D2A14;
    }
```

- [ ] **Step 5: Strip the shared tokens from `[data-theme="dark"]`**

Delete the ten colour lines, leaving only the badge overrides:

```css
    [data-theme="dark"] {
      /* badge/achievement warm theme — dark variants (readable on dark) */
      --badge-text: #e7d9bd; --badge-accent: #dbbe72; --badge-bg: #221a0e;
      --badge-bg2: #1c160d; --badge-border: rgba(219,190,114,.35); --badge-close: #c9a84c;
      --badge-tier: #dbbe72; --badge-deep: #d8b96a;
    }
```

- [ ] **Step 6: Strip the `#auth-screen` forced-light copy**

Replace the whole rule:

```css
    #auth-screen {
      position: fixed; inset: 0; z-index: 500;
      background: #f5f5f8;
      color: #16161e;
      display: none;
      align-items: flex-start; justify-content: center;
      overflow-y: auto;
      padding: calc(1rem + env(safe-area-inset-top, 0px)) 1.25rem 1rem;
      /* Force light palette on landing page regardless of theme */
      --bg: #f5f5f8; --surface: #ffffff; --surface2: #eeeff5;
      --border: #d8d9e8; --gold: #9a7628; --gold-lt: #c9a84c;
      --gold-dim: rgba(154,118,40,.12); --text: #16161e; --muted: #70708a;
      --overlay-bg: rgba(245,245,248,.96);
    }
```

with:

```css
    /* The element carries data-theme="light", so design-system.css supplies
       the light palette here regardless of the app theme. */
    #auth-screen {
      position: fixed; inset: 0; z-index: 500;
      background: var(--bg);
      color: var(--text);
      display: none;
      align-items: flex-start; justify-content: center;
      overflow-y: auto;
      padding: calc(1rem + env(safe-area-inset-top, 0px)) 1.25rem 1rem;
    }
```

`var(--bg)` resolves to `#f5f5f8` and `var(--text)` to `#16161e` because `[data-theme="light"]` sets them on this element directly, which beats the `[data-theme="dark"]` values inherited from `<html>`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/design-system-tokens.test.js`
Expected: PASS, 8 tests

- [ ] **Step 8: Commit**

```bash
git add index.html tests/design-system-tokens.test.js
git commit -m "design system: point index.html at the shared token file"
```

---

### Task 3: Migrate `p/index.html` and `profile/index.html`

**Files:**
- Modify: `p/index.html:28-38` — delete both token blocks, add the link
- Modify: `profile/index.html:30-53` — delete both token blocks, add the link
- Modify: `tests/design-system-tokens.test.js` — add the sub-page guard

**Interfaces:**
- Consumes: `SHARED_LIGHT`, `declaredIn`, `referencedIn` from Task 1's test file.

- [ ] **Step 1: Write the failing test**

Append to `tests/design-system-tokens.test.js`:

```js
describe.each([
  ['p/index.html'],
  ['profile/index.html'],
])('%s', (relPath) => {
  const src = readFileSync(join(root, relPath), 'utf8');

  it('links design-system.css before its inline style block', () => {
    const link = src.indexOf('<link rel="stylesheet" href="/design-system.css">');
    expect(link).toBeGreaterThan(-1);
    expect(link).toBeLessThan(src.indexOf('<style>'));
  });

  it('declares no custom properties of its own', () => {
    expect([...declaredIn(src)]).toEqual([]);
  });

  it('references only tokens that design-system.css owns', () => {
    const unowned = [...referencedIn(src)].filter(t => !(t in SHARED_LIGHT));
    expect(unowned).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/design-system-tokens.test.js`
Expected: FAIL — both pages still declare `--bg`, `--surface`, etc.

- [ ] **Step 3: Migrate `p/index.html`**

Replace lines 25-38:

```html
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #f5f5f8; --surface: #ffffff; --surface2: #eeeff5;
      --border: #d8d9e8; --gold: #9a7628; --gold-lt: #c9a84c;
      --gold-dim: rgba(154,118,40,.12); --text: #16161e; --muted: #70708a;
      --radius: 10px;
    }
    [data-theme="dark"] {
      --bg: #0b0b10; --surface: #141419; --surface2: #1c1c25;
      --border: #272734; --gold: #c9a84c; --gold-lt: #dbbe72;
      --gold-dim: rgba(201,168,76,.12); --text: #e6e6f0; --muted: #7a7a95;
    }
```

with:

```html
  </script>
  <link rel="stylesheet" href="/design-system.css">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
```

- [ ] **Step 4: Migrate `profile/index.html`**

Replace lines 27-53:

```html
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:         #f5f5f8;
      --surface:    #ffffff;
      --surface2:   #eeeff5;
      --border:     #d8d9e8;
      --gold:       #9a7628;
      --gold-lt:    #c9a84c;
      --gold-dim:   rgba(154,118,40,.12);
      --text:       #16161e;
      --muted:      #70708a;
      --danger:     #e05555;
      --radius:     10px;
    }
    [data-theme="dark"] {
      --bg:         #0b0b10;
      --surface:    #141419;
      --surface2:   #1c1c25;
      --border:     #272734;
      --gold:       #c9a84c;
      --gold-lt:    #dbbe72;
      --gold-dim:   rgba(201,168,76,.12);
      --text:       #e6e6f0;
      --muted:      #7a7a95;
    }
```

with:

```html
  </script>
  <link rel="stylesheet" href="/design-system.css">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
```

Leave `[data-theme="dark"] .cta-banner { border-color: rgba(201,168,76,.2); }` at line 176 alone — it is a component rule, not a token declaration.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/design-system-tokens.test.js`
Expected: PASS, 14 tests

- [ ] **Step 6: Commit**

```bash
git add p/index.html profile/index.html tests/design-system-tokens.test.js
git commit -m "design system: point the share pages at the shared token file"
```

---

### Task 4: Precache the stylesheet in the service worker

**Files:**
- Modify: `sw.js:4-5` — bump `CACHE`, extend `PRECACHE`
- Modify: `tests/design-system-tokens.test.js` — add the service-worker guard

**Interfaces:**
- Consumes: nothing from earlier tasks beyond the test file's imports.

- [ ] **Step 1: Write the failing test**

Append to `tests/design-system-tokens.test.js`:

```js
describe('sw.js', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');

  // Assets are served stale-while-revalidate, so without a precache entry a
  // token change would land one page-load late, and an offline launch would
  // render untokenized.
  it('precaches design-system.css', () => {
    const precache = sw.match(/const PRECACHE = \[(.*?)\];/s)[1];
    expect(precache).toContain("'/design-system.css'");
  });

  it('has had its cache version bumped past v1039', () => {
    const version = Number(sw.match(/const CACHE = 'wristlog-v(\d+)';/)[1]);
    expect(version).toBeGreaterThan(1039);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/design-system-tokens.test.js`
Expected: FAIL — `expected "'/', '/index.html', …" to contain "'/design-system.css'"`

- [ ] **Step 3: Update `sw.js`**

Replace lines 4-5:

```js
const CACHE = 'wristlog-v1039';
const PRECACHE = ['/', '/index.html', '/manifest.json', '/icon.svg', '/profile/', '/p/'];
```

with:

```js
const CACHE = 'wristlog-v1040';
const PRECACHE = ['/', '/index.html', '/design-system.css', '/manifest.json', '/icon.svg', '/profile/', '/p/'];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/design-system-tokens.test.js`
Expected: PASS, 16 tests

- [ ] **Step 5: Commit**

```bash
git add sw.js tests/design-system-tokens.test.js
git commit -m "design system: precache design-system.css and bump the SW version"
```

---

### Task 5: Full automated suite

**Files:**
- Modify: whichever existing tests the refactor breaks (expected: none)

- [ ] **Step 1: Run the unit suite**

Run: `npm test`
Expected: PASS — 1571 existing tests plus the 16 new ones.

- [ ] **Step 2: Run the mocked E2E suite**

Run: `npm run test:e2e`
Expected: PASS, 179 tests.

If a Playwright test fails on a missing stylesheet, its route mock is intercepting `/design-system.css`. Fix by letting same-origin CSS through in `e2e/helpers.js`, not by reverting the link tag.

- [ ] **Step 3: Commit any test fixes**

```bash
git add -A
git commit -m "design system: keep the E2E route mocks serving the token file"
```

Skip this step if steps 1 and 2 were green.

---

### Task 6: Manual verification, then push

**Files:** none — this task only observes.

The automated tests prove the tokens resolve. They cannot prove nothing moved on screen. That is what this task is for.

- [ ] **Step 1: Confirm the dev server is up**

Run: `curl -sI http://192.168.1.246:3000/design-system.css | head -1`
Expected: `HTTP/1.1 200 OK`. If it 404s, the file is not being served from the repo root — stop and fix that before looking at any page.

- [ ] **Step 2: Check all three pages in both themes**

On the MacBook Pro, open `http://192.168.1.246:3000/` and toggle light ↔ dark. Then `/p/<any post id>` and `/profile/?u=testuser`. Compare against production (`https://wrotate.com`) side by side.

Expected: no visible difference anywhere. Backgrounds, gold accents, borders, muted text and corner radii all unchanged.

- [ ] **Step 3: Check the forced-light landing screen**

Set the app to dark, sign out, and look at the landing screen.

Expected: it still renders light. This is the `#auth-screen` change from Task 2 — if it renders dark, `[data-theme="light"]` is not reaching the element.

- [ ] **Step 4: Check offline**

DevTools → Network → Offline, then hard-reload `/`.

Expected: the app renders fully styled. Unstyled text means the `PRECACHE` entry from Task 4 is wrong.

- [ ] **Step 5: Push**

```bash
git push origin main
```

- [ ] **Step 6: Verify production**

Run: `curl -sI https://wrotate.com/design-system.css | head -1`
Expected: `HTTP/1.1 200 OK`

Then hard-reload `https://wrotate.com` and confirm the app looks unchanged.

---

## Follow-ups (not in this plan)

- **Push a preview to Claude Design.** Needs a design-system project created on the user's claude.ai account — ask first. The preview page links this same `design-system.css` and renders swatches, type scale and spacing ramp in both themes. The loop is one-way: `DesignSync` uploads only, so edits made there come back by hand.
- **Five undeclared tokens in index.html** — `--accent`, `--error`, `--fg`, `--hover`, `--surface1` are referenced with no declaration and no fallback. Pre-existing; fixing them changes appearance, so it needs its own change.
- **Retire `r.html`** — see the spec's Follow-up section for the full blast radius.
