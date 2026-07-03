# Wishlist Gallery View — design

**Date:** 2026-07-03
**Scope:** Add a photo-first "Gallery" view to the Wishlist page, toggleable with the
existing List view. Pure front-end (index.html) — no schema, RPC, or edge-function change.

## Goal
Let the user flip the Wishlist between the current text List and a picture-focused
Gallery of "beautiful watch faces" with minimal text (name + URL), mirroring the
collection's showcase grid but larger and lighter on text.

## Current state
- Wishlist page (`#page-wishlist`) header: title + "Add from Photo" + "+ Add to Wishlist".
  Items render into `#wishlist-grid` via `renderWishlist(force)` (index.html:21476).
- Current view = `.wishlist-list`: vertical `.wl-card` rows (thumb + name + brand +
  price·ref·date meta + drag-reorder handle + tap-to-edit).
- Wishlist item fields (rowToWish): `{ id, brand, name, ref, price, url, image, notes,
  color, tags, marketPrice…, wishPrivacy, addedDate, _rank }`. `url` and `image` exist.
- Collection showcase grid to mirror: `.showcase-grid`
  (`repeat(auto-fill, minmax(88px,1fr))`), `.showcase-card` with privacy border colors.

## The toggle
- A two-button segmented switcher (Gallery / List, with icons) at the **top of
  `#wishlist-grid`**, above the items. Shown only when the wishlist has ≥1 item
  (hidden on the empty state and when empty). Does not alter the page header.
- State: `_wishlistView ∈ {'list','gallery'}`, persisted in `localStorage` key
  `wr_wishlist_view`, **default `'list'`**. Read on render; written on toggle.
- `setWishlistView(v)`: normalize → persist → re-render → update active-button class.
- Pure helper `wishlistViewFromStore(raw)` returns `'gallery'` iff `raw === 'gallery'`,
  else `'list'` (unit-testable; guards against junk/missing localStorage).

## Gallery view
- Container class `.wl-gallery`: `display:grid; grid-template-columns:
  repeat(auto-fill, minmax(150px, 1fr)); gap:.7rem;` → ~2 tiles per row on a ~360px
  phone, more on wider screens.
- Each tile `.wl-tile`:
  (Revised 2026-07-03: image + name both open Edit; **only** the bottom URL link opens the retailer.)
  - **Image** `.wl-tile-img`: `w.image`, `object-fit:cover`, rounded, **square
    (`aspect-ratio: 1/1`)** for a uniform grid, full tile width. **Tap →
    `openEditWishlist(w.id)`** (image is not a link). No image → scaled-up
    color/initials avatar (`.wl-tile-avatar`, reuse `initials(w.brand,w.name)` +
    `initialsTextColor`).
  - **Name** `.wl-tile-name`: `escHtml(w.name)` only. **Tap → `openEditWishlist(w.id)`**.
  - **URL** `.wl-tile-url`: shown as a clean domain via `urlDomain(w.url)` (e.g.
    `rolex.com ↗`), muted/small. **The only element that opens `w.url`**
    (`target=_blank rel="noopener noreferrer"`). Omitted when `w.url` is empty.
  - **Privacy**: subtle border tint by `w.wishPrivacy` matching `.showcase-card`
    (public→success, followers/friends→gold, private→danger), via a `data-priv`
    attribute + CSS (reuse the existing showcase-card privacy color rules or a
    parallel `.wl-tile[data-priv=…]` rule set).
  - **Fallbacks:** if `w.url` empty → image tap opens Edit instead (so the tile is
    never a dead link), and the URL line is omitted.
- **No drag-reorder** in Gallery (display-focused). Reordering remains a List-view
  feature; Gallery still renders in the saved `sort_order`.

## Helper: urlDomain(url)
Pure function: returns the hostname without `www.` (e.g. `https://www.rolex.com/x` →
`rolex.com`), `''` for empty/invalid input. Unit-testable; used only for the tile's
URL label. Full URL is used for the actual link href.

## Rendering flow
`renderWishlist(force)`:
1. Empty wishlist → existing empty state; hide the toggle. (unchanged)
2. Non-empty → render the toggle bar (active = current view), then:
   - `'list'` → existing `.wishlist-list` markup (unchanged).
   - `'gallery'` → `.wl-gallery` tiles as above.

## Testing
- **Unit** (`wrotate_test.js` + a new test file): `wishlistViewFromStore` (gallery /
  list / junk / null → correct) and `urlDomain` (http/https, www-stripping,
  path/query stripping, empty, malformed). Register both in the mirror-drift guard.
- **Mocked E2E** (extend the existing wishlist spec): toggle to Gallery → tiles render
  with image + name; tapping the name opens the Edit Wishlist modal; the image/url is
  an anchor to the item URL; toggle persists (reload keeps Gallery).
- **Live verify** (dev server, testuser): flip the toggle, confirm images render, image
  tap opens the URL, name tap opens Edit, and the choice persists across reload.
- SW cache bump; full unit + mocked E2E green before ship.

## Out of scope
- No backend/schema change. No drag-reorder in Gallery. No new per-item fields.
- No change to List view, the Add flows, or the collection page.
- Not touching the public/shared wishlist rendering (this is the owner's own page).
