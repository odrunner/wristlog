# Wishlist Gallery View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted List/Gallery view toggle to the Wishlist page, where Gallery shows photo-first tiles (image → retailer URL, name → edit, URL as domain).

**Architecture:** Pure front-end in `index.html`. `renderWishlist()` gains a branch on a `_wishlistView` state (persisted in localStorage). A static toggle bar sits above `#wishlist-grid`. Two pure helpers (`wishlistViewFromStore`, `urlDomain`) are mirrored into `wrotate_test.js` for unit tests. No backend/schema change.

**Tech Stack:** Vanilla JS (no frameworks), existing CSS token system, Vitest (unit), Playwright (mocked E2E).

## Global Constraints

- Vanilla JS only — no frameworks, no new runtime dependencies.
- Escape all user strings rendered to the DOM with `escHtml()`.
- Any function defined in BOTH `index.html` and `wrotate_test.js` must be byte-identical (modulo whitespace/comments) and registered in the `tests/mirror-drift.test.js` VERBATIM list, or the mirror-drift guard fails.
- Bump the SW cache version in `sw.js` (`wristlog-vNN` → next N) on any HTML/JS change.
- `openEditWishlist(id)` opens the `#wishlist-modal` (add/edit modal). `initials(brand,name)`, `initialsTextColor(bg)`, `escHtml(s)` already exist in both files.
- Wishlist item fields available: `id, brand, name, ref, price, url, image, notes, color, tags, wishPrivacy, addedDate`.
- `wishPrivacy` values: `'public' | 'followers' | 'friends' | 'friends_only' | 'private' | null`.
- Run `npm test && npm run test:e2e` before the final commit; both must pass.

---

### Task 1: Pure helpers (`wishlistViewFromStore`, `urlDomain`) + unit tests

**Files:**
- Modify: `wrotate_test.js` (add two exported functions near the other pure helpers, e.g. after `escHtml` at line ~139)
- Modify: `index.html` (add the same two functions as plain `function` declarations near `renderWishlist`, e.g. just above `function renderWishlist(force)` at line ~21476)
- Modify: `tests/mirror-drift.test.js` (register both in the `VERBATIM` array, line ~34)
- Test: `tests/wishlist-gallery.test.js` (new)

**Interfaces:**
- Produces: `wishlistViewFromStore(raw: string|null) → 'gallery' | 'list'` (returns `'gallery'` only when `raw === 'gallery'`, else `'list'`).
- Produces: `urlDomain(url: string|null) → string` (hostname without leading `www.`; `''` for empty/invalid).

- [ ] **Step 1: Write the failing test**

Create `tests/wishlist-gallery.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { wishlistViewFromStore, urlDomain } from '../wrotate_test.js';

describe('wishlistViewFromStore', () => {
  it("returns 'gallery' only for the exact string 'gallery'", () => {
    expect(wishlistViewFromStore('gallery')).toBe('gallery');
  });
  it("defaults to 'list' for 'list'", () => {
    expect(wishlistViewFromStore('list')).toBe('list');
  });
  it("defaults to 'list' for null / missing", () => {
    expect(wishlistViewFromStore(null)).toBe('list');
    expect(wishlistViewFromStore(undefined)).toBe('list');
  });
  it("defaults to 'list' for junk", () => {
    expect(wishlistViewFromStore('GALLERY')).toBe('list');
    expect(wishlistViewFromStore('grid')).toBe('list');
    expect(wishlistViewFromStore('')).toBe('list');
  });
});

describe('urlDomain', () => {
  it('extracts the host and strips www.', () => {
    expect(urlDomain('https://www.rolex.com/en/watches/x')).toBe('rolex.com');
  });
  it('handles http and no-www', () => {
    expect(urlDomain('http://omegawatches.com/x?y=1')).toBe('omegawatches.com');
  });
  it('keeps subdomains other than www', () => {
    expect(urlDomain('https://shop.hodinkee.com/x')).toBe('shop.hodinkee.com');
  });
  it('returns empty string for empty/invalid input', () => {
    expect(urlDomain('')).toBe('');
    expect(urlDomain(null)).toBe('');
    expect(urlDomain('not a url')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/wishlist-gallery.test.js`
Expected: FAIL — `wishlistViewFromStore`/`urlDomain` are not exported.

- [ ] **Step 3: Add the helpers to `wrotate_test.js`**

Insert after the `escHtml` export (line ~140):

```js
export function wishlistViewFromStore(raw) {
  return raw === 'gallery' ? 'gallery' : 'list';
}

export function urlDomain(url) {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return ''; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/wishlist-gallery.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Add the identical helpers to `index.html`**

Insert directly above `function renderWishlist(force) {` (line ~21476), as plain declarations (no `export`):

```js
function wishlistViewFromStore(raw) {
  return raw === 'gallery' ? 'gallery' : 'list';
}

function urlDomain(url) {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return ''; }
}
```

- [ ] **Step 6: Register both in the mirror-drift VERBATIM list**

In `tests/mirror-drift.test.js`, add `'wishlistViewFromStore'` and `'urlDomain'` to the `VERBATIM` array (line ~34, alongside `'validateUsername'`, `'withTimeout'`, etc.):

```js
  'validateUsername', 'withTimeout', 'wishlistViewFromStore', 'urlDomain', 'resolveTdm', 'resolveSweepKnob', 'parseSweepValues',
```

- [ ] **Step 7: Run the full unit suite**

Run: `npm test`
Expected: PASS — includes the new file and the mirror-drift guard (both helpers now match across files).

- [ ] **Step 8: Commit**

```bash
git add wrotate_test.js index.html tests/wishlist-gallery.test.js tests/mirror-drift.test.js
git commit -m "feat(wishlist): add wishlistViewFromStore + urlDomain helpers (unit-tested)"
```

---

### Task 2: Toggle bar + Gallery rendering + CSS

**Files:**
- Modify: `index.html` — add toggle markup (line ~3893, between `.page-header` and `#wishlist-grid`)
- Modify: `index.html` — add CSS (near the `.wl-card` block, after line ~1330)
- Modify: `index.html` — add `_wishlistView` state + `setWishlistView`, and branch `renderWishlist` (line ~21476)
- Modify: `sw.js` — bump cache version

**Interfaces:**
- Consumes: `wishlistViewFromStore`, `urlDomain` (Task 1); existing `escHtml`, `initials`, `initialsTextColor`, `openEditWishlist`.
- Produces: global `_wishlistView` ('list'|'gallery'); `setWishlistView(v)`; DOM `#wishlist-view-toggle` with `.wl-view-btn[data-view="list"|"gallery"]`; gallery container `.wl-gallery` of `.wl-tile` with `.wl-tile-name` (→ edit) and `.wl-tile-imglink`/`.wl-tile-url` (→ URL).

- [ ] **Step 1: Add the toggle bar markup**

In `index.html`, change (line ~3893):

```html
    </div>
    <div id="wishlist-grid"></div>
  </div>
```

to:

```html
    </div>
    <div id="wishlist-view-toggle" class="wl-view-toggle" style="display:none;">
      <button type="button" class="wl-view-btn active" data-view="list" onclick="setWishlistView('list')" aria-label="List view">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        List
      </button>
      <button type="button" class="wl-view-btn" data-view="gallery" onclick="setWishlistView('gallery')" aria-label="Gallery view">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        Gallery
      </button>
    </div>
    <div id="wishlist-grid"></div>
  </div>
```

- [ ] **Step 2: Add the CSS**

In `index.html`, after the `.wl-meta` rule (line ~1330), add:

```css
    /* Wishlist view toggle */
    .wl-view-toggle { display: flex; gap: .35rem; margin-bottom: .9rem; }
    .wl-view-btn {
      display: inline-flex; align-items: center; gap: .35rem;
      font-family: inherit; font-size: .78rem; font-weight: 600; color: var(--muted);
      background: none; border: 1px solid var(--border); border-radius: var(--radius-pill);
      padding: .3rem .7rem; cursor: pointer;
      transition: background .15s, color .15s, border-color .15s;
    }
    .wl-view-btn:hover { color: var(--text); border-color: var(--gold); }
    .wl-view-btn.active { background: var(--gold); color: #1c1c28; border-color: var(--gold); }

    /* Wishlist gallery (photo-first) */
    .wl-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: .7rem; }
    .wl-tile { display: flex; flex-direction: column; gap: .35rem; min-width: 0; border: 2px solid var(--border); border-radius: var(--radius); padding: .4rem; background: var(--surface2); transition: border-color .15s; }
    .wl-tile[data-priv="public"]       { border-color: var(--success); }
    .wl-tile[data-priv="followers"]    { border-color: var(--gold); }
    .wl-tile[data-priv="friends"],
    .wl-tile[data-priv="friends_only"] { border-color: #a78bfa; }
    .wl-tile[data-priv="private"]      { border-color: var(--danger); }
    .wl-tile-imglink { display: block; cursor: pointer; }
    .wl-tile-img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 8px; display: block; }
    .wl-tile-avatar { width: 100%; aspect-ratio: 1 / 1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.6rem; color: #000; }
    .wl-tile-name { font-weight: 700; font-size: .85rem; line-height: 1.25; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wl-tile-url { font-size: .72rem; color: var(--muted); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
    .wl-tile-url:hover { color: var(--gold); }
```

- [ ] **Step 3: Add view state + `setWishlistView`, and branch `renderWishlist`**

In `index.html`, replace the current head of `renderWishlist` and its list body. Change (line ~21476):

```js
function renderWishlist(force) {
  if (!force && _lastRenderedGen.wishlist === _dataGen) return;
  _lastRenderedGen.wishlist = _dataGen;
  const el = document.getElementById('wishlist-grid');
  const visible = wishlist;
  if (visible.length === 0) {
```

to:

```js
let _wishlistView = wishlistViewFromStore((() => { try { return localStorage.getItem('wr_wishlist_view'); } catch (e) { return null; } })());

function setWishlistView(v) {
  _wishlistView = wishlistViewFromStore(v);
  try { localStorage.setItem('wr_wishlist_view', _wishlistView); } catch (e) {}
  renderWishlist(true);
}

function renderWishlist(force) {
  if (!force && _lastRenderedGen.wishlist === _dataGen) return;
  _lastRenderedGen.wishlist = _dataGen;
  const el = document.getElementById('wishlist-grid');
  const toggle = document.getElementById('wishlist-view-toggle');
  const visible = wishlist;
  if (toggle) {
    toggle.style.display = visible.length ? 'flex' : 'none';
    toggle.querySelectorAll('.wl-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === _wishlistView));
  }
  if (visible.length === 0) {
```

Then, immediately BEFORE the existing `el.className = 'wishlist-list';` line (line ~21494), insert the gallery branch:

```js
  if (_wishlistView === 'gallery') {
    el.className = 'wl-gallery';
    el.innerHTML = visible.map(w => {
      const imgInner = w.image
        ? `<img loading="lazy" src="${escHtml(w.image)}" class="wl-tile-img" alt="" onerror="this.style.display='none'">`
        : `<div class="wl-tile-avatar" style="background:${escHtml(w.color||'#c9a84c')};color:${initialsTextColor(w.color||'#c9a84c')}">${initials(w.brand,w.name)}</div>`;
      const imgLink = w.url
        ? `<a href="${escHtml(w.url)}" target="_blank" rel="noopener noreferrer" class="wl-tile-imglink">${imgInner}</a>`
        : `<div class="wl-tile-imglink" onclick="openEditWishlist('${w.id}')">${imgInner}</div>`;
      const urlLine = w.url
        ? `<a href="${escHtml(w.url)}" target="_blank" rel="noopener noreferrer" class="wl-tile-url">${escHtml(urlDomain(w.url))} ↗</a>`
        : '';
      return `<div class="wl-tile" data-priv="${escHtml(w.wishPrivacy||'')}">
        ${imgLink}
        <div class="wl-tile-name" onclick="openEditWishlist('${w.id}')">${escHtml(w.name)}</div>
        ${urlLine}
      </div>`;
    }).join('');
    return;
  }
  el.className = 'wishlist-list';
```

(The existing list rendering below `el.className = 'wishlist-list';` is unchanged.)

- [ ] **Step 4: Bump the SW cache version**

In `sw.js`, increment the cache version, e.g.:

```js
const CACHE = 'wristlog-v875';
```

(Use the current value + 1 — check the file first.)

- [ ] **Step 5: Manually sanity-check in the dev server**

The dev server runs at http://localhost:3000 (on the Mac Mini) / http://192.168.1.246:3000. Log in as testuser, go to Wishlist, confirm: the List/Gallery toggle appears above the items; clicking Gallery shows a grid of square image tiles with name + domain; the list view still works via the toggle. (Full automated verification is Task 3.)

- [ ] **Step 6: Commit**

```bash
git add index.html sw.js
git commit -m "feat(wishlist): photo-first Gallery view + persisted List/Gallery toggle"
```

---

### Task 3: Mocked E2E coverage + full verification

**Files:**
- Modify: `e2e/app.mock.spec.js` — add a Gallery test in the `Wishlist page (mocked)` describe block (line ~259)

**Interfaces:**
- Consumes: `mockSupabase(page, {wishlist})`, `navigateTo(page,'wishlist')`, `waitForAppBoot` (existing helpers); DOM selectors from Task 2 (`.wl-view-btn[data-view="gallery"]`, `.wl-tile`, `.wl-tile-name`, `#wishlist-modal`).

- [ ] **Step 1: Write the Gallery E2E test**

In `e2e/app.mock.spec.js`, inside `test.describe('Wishlist page (mocked)', …)` (line ~259), add:

```js
  test('gallery view: toggle shows photo tiles; name opens edit; choice persists', async ({ page }) => {
    const WL = [
      { id: 'wl1', brand: 'Rolex', name: 'Submariner', url: 'https://www.rolex.com/sub', image: 'https://example.com/sub.jpg', wish_privacy: 'public', sort_order: 0 },
      { id: 'wl2', brand: 'Omega', name: 'Speedmaster', url: 'https://omegawatches.com/speedy', image: 'https://example.com/speedy.jpg', wish_privacy: 'private', sort_order: 1 },
    ];
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS, wishlist: WL });
    await page.goto('/');
    await waitForAppBoot(page);
    await navigateTo(page, 'wishlist');
    await expect(page.locator('#page-wishlist')).toBeVisible();

    // Toggle bar visible; switch to Gallery
    await expect(page.locator('#wishlist-view-toggle')).toBeVisible();
    await page.click('.wl-view-btn[data-view="gallery"]');

    // Two photo tiles with names + domain URLs
    await expect(page.locator('.wl-gallery .wl-tile')).toHaveCount(2);
    await expect(page.locator('.wl-tile-name').first()).toHaveText('Submariner');
    await expect(page.locator('.wl-tile-url').first()).toContainText('rolex.com');
    // Image is an anchor to the retailer URL
    await expect(page.locator('.wl-tile-imglink[href="https://www.rolex.com/sub"]').first()).toBeVisible();

    // Persisted in localStorage
    expect(await page.evaluate(() => localStorage.getItem('wr_wishlist_view'))).toBe('gallery');

    // Tapping the name opens the edit modal
    await page.click('.wl-tile-name >> text=Submariner');
    await expect(page.locator('#wishlist-modal')).toBeVisible();
  });
```

- [ ] **Step 2: Run the new E2E test**

Run: `npx playwright test e2e/app.mock.spec.js -g "gallery view" --reporter=line`
Expected: PASS. If the edit-modal assertion fails, confirm `openEditWishlist` targets `#wishlist-modal` and adjust the selector to the actual modal id.

- [ ] **Step 3: Run the full suite**

Run: `npm test && npm run test:e2e`
Expected: unit 1240+ pass; mocked E2E all pass (including the new test).

- [ ] **Step 4: Live verification on the dev server**

Drive the real app (dev server localhost:3000, testuser) — reuse the pattern from the earlier chart verification: log in, dismiss boot overlays, `navigateTo` wishlist, click the Gallery toggle, assert `.wl-tile` count > 0 and zero console errors, screenshot. Confirm: images render, tapping an image opens the URL (new tab / anchor href), tapping a name opens `#wishlist-modal`, and reloading keeps Gallery selected (localStorage). Fix any issue found before shipping.

- [ ] **Step 5: Commit**

```bash
git add e2e/app.mock.spec.js
git commit -m "test(wishlist): mocked E2E for gallery view toggle"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

Then confirm the GitHub Pages deploy lands (watch `gh run list --workflow=pages-build-deployment` for success and poll prod for the new SW version), since Pages has intermittently missed/failed deploys.

---

## Notes for the implementer
- The List view markup and drag-reorder are unchanged — only a branch is added above them.
- No new per-item fields, RPCs, or migrations. Everything reads from the already-loaded `wishlist` array.
- Keep the gallery tile text to name + domain only — do not add brand/price/ref/date (that stays in List view, by design).
- `--radius-pill` and `--surface2` are existing CSS tokens (used by the streak chip and showcase cards); no new tokens needed.
