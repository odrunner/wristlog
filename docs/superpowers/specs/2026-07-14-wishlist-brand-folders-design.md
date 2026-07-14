# Wishlist Brand Folders — Design

**Date:** 2026-07-14
**Status:** Approved

## Problem

Wishlists with many watches from the same brand (e.g. several Pateks) get long and
hard to scan. The user wants an option to group same-brand watches into folders.

## Design

Purely client-side. No schema changes, no Supabase work.

### View switcher

The wishlist header view switcher gains a third option: **list · folders · gallery**
(folder icon between the existing two). The choice persists in `localStorage`
under the existing `wr_wishlist_view` key; `wishlistViewFromStore()` accepts the
new `'folders'` value and still defaults to `'list'` for anything else.

### Grouping logic

Pure function `groupWishlistByBrand(items)`:

- Groups by `brand`, trimmed and case-insensitive ("Patek Philippe" ≡ "patek philippe").
  Display name uses the first item's casing.
- Brands with **2+ watches** → a folder `{ key, brand, items }`.
- Brands with exactly one watch → standalone card, unchanged.
- Items with empty/missing brand → always standalone.
- Folders sort A→Z by brand; standalone items sort A→Z by brand then name;
  items inside a folder sort A→Z by name.
- Returns `{ folders: [...], singles: [...] }`.

### Folder row UI

Folder icon + brand name + count badge + up to 3 small thumbnails (image or the
colored-initials avatar fallback, same as today) + chevron. Tap toggles
expand/collapse. Expanded folders show the brand's watches as regular `wl-card`
rows, slightly indented, each opening the edit modal as usual. Expanded state is
remembered per brand key in `localStorage` (`wr_wishlist_folders_open`, JSON
array); new folders start collapsed.

### Reordering

No drag handles in folders view — sorting is alphabetical. Manual drag order is
untouched and still applies in list view. Gallery view is unchanged.

### Rendering

One new branch in `renderWishlist()` alongside the existing gallery branch, plus
a small CSS block for the folder row. Vanilla JS, matching existing card markup
and privacy tinting (`data-priv`).

## Testing

- Unit tests (vitest): `groupWishlistByBrand` — case-insensitive merge,
  1-vs-2+ threshold, blank brands, sort order; `wishlistViewFromStore('folders')`.
- Mocked E2E: folders view renders folder rows + standalone cards; expand/collapse
  shows/hides the brand's watches.
- SW cache version bump per checklist.
