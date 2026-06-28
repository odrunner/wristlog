# Wishlist — Add from Photo

**Date:** 2026-06-28
**Status:** Approved design, pending implementation

## Goal

Give the Wishlist page its own streamlined "Add from Photo" flow: one tap → snap/pick a
photo → the existing "Add to Wishlist" modal opens **prefilled** with the identified watch.
This mirrors the collection's "Add from Photo" experience but is deliberately much lighter —
single watch, identify-only, no spec enrichment, no price lookup, no new edge function, no new
DB writes.

## Why lighter than the collection flow

The collection flow (`openPhotoIdentify` → `af2*`) is a heavy multi-pass pipeline:
`detect` (multi-watch + bounding boxes) → crop → `identify` per watch → `enhance` (caliber,
case dimensions, water resistance, ~15 spec fields) → `watch-value` (market price). A wishlist
item only needs **brand, name (model), ref, image** (price/url are optional and user-entered),
so all of that machinery is irrelevant here.

## Scope decisions (locked)

- **Single watch only** — no `detect` step, no bounding boxes, no cropping. One `identify` call
  on the full resized image.
- **Prefill the existing modal** — open `openAddWishlist()` and fill fields; the user reviews,
  optionally adds price/url, and hits **Save**. Reuses `saveWishlistItem()` unchanged.
- **Identify only, no price** — do **not** call `watch-value`. No `enhance` pass either.
- **Two buttons side by side** — keep "+ Add to Wishlist"; add "Add from Photo" next to it.
- **Small centered overlay + spinner** while identifying (blocking), then the prefilled modal
  opens. Not the heavy `af2-sheet`.

## Out of scope (explicitly NOT building)

- Multi-watch detection / bounding boxes / cropping
- `enhance` spec enrichment
- `watch-value` / market-price lookup
- Any new edge function or change to `identify-watch`
- Any new DB table/columns or new save path — `saveWishlistItem()` is reused as-is

## UI changes

### Entry points (two buttons, side by side)

1. **Wishlist page header** — [index.html:3855-3858](../../../index.html#L3855). Add an
   "Add from Photo" button next to the existing `+ Add to Wishlist`. Keep both `btn`-styled;
   "+ Add to Wishlist" stays `btn-primary`, "Add from Photo" can be `btn` (secondary) so the
   header doesn't show two primaries. Wrap the two in a flex container if needed for spacing.
2. **Empty state** — [index.html:21410](../../../index.html#L21410). Add the same
   "Add from Photo" button beside the existing "Add to Wishlist" button.

Both buttons call the new `openWishlistPhoto()`.

### Loading overlay

A minimal centered overlay with a spinner and the text "Identifying watch…". Blocks until the
`identify` call resolves (or errors), then is removed. Reuse existing modal/overlay styling for
consistency; no new heavyweight component. Implementation may add a tiny dedicated element
(e.g. `#wl-photo-loading`) toggled with a `hidden` class, matching the pattern used elsewhere.

## New code

### `openWishlistPhoto()`

Modeled on `openPhotoIdentify()` (guards) + `openAddFlowV2()` (file picker), stripped down.

1. **Guards** — same auth + username guards the collection photo flow uses
   (`openPhotoIdentify` at [index.html:20614](../../../index.html#L20614)). If not signed in /
   no username, route to the same prompt the collection flow uses. Also respect `demoGuard()`
   consistent with `saveWishlistItem()`.
2. **File picker** — create a hidden `<input type="file" accept="image/*">`, same pattern as
   `openAddFlowV2()` ([index.html:20022-20035](../../../index.html#L20022)). On `cancel`, no-op.
   On change, validate via `validateImageFile(file)`.
3. **Prepare image**:
   - `base64 = await blobToResizedBase64ForIdentify(file)` — for the AI call.
   - `blob   = await blobToResizedBlob(file)` (fallback to `file` on error) — becomes the
     wishlist photo via `wlPendingFile`.
4. **Show loading overlay.**
5. **Identify (one call)**:
   ```js
   const resp = await authedFetch(`${SUPABASE_URL}/functions/v1/identify-watch`, {
     method: 'POST',
     body: JSON.stringify({ image: base64, mode: 'identify' }),
   }, 30000);
   ```
   Parse `{ brand, model, reference, estimatedColor, ... }` from the response. (The `identify`
   mode returns a single watch object or a `watches` array — read the first watch defensively,
   matching how the collection flow consumes it.)
6. **Hide loading overlay.**
7. **Open + prefill the modal** — reuse the exact pattern from `fetchWishlistDetails()`
   ([index.html:22185+](../../../index.html#L22185)):
   ```js
   openAddWishlist();                         // fresh, blank modal
   if (brand) buildWlBrandSelect(brand);
   if (model) document.getElementById('wl-name').value = model;
   if (reference) document.getElementById('wl-ref').value = reference;
   wlPendingFile  = blob;                      // resized photo
   wlRemoveImage  = false;
   renderWlModalImg();                         // shows the pending photo
   ```
   The user reviews, can add price/url/date, and presses **Save** →
   `saveWishlistItem()` uploads `wlPendingFile` to `wishlist/{userId}/{itemId}.jpg` and writes
   the row exactly as today. No new save code.

## Error handling

- **Identify fails (network / non-OK / timeout) or returns no brand & no model** → hide the
  overlay, still `openAddWishlist()` with the photo attached (`wlPendingFile = blob;
  renderWlModalImg()`), and `toast("Couldn't identify it — add the details manually.")`.
  Never a dead end; the user keeps their photo and fills the rest in.
- **Partial result** (e.g. brand but no model) → prefill whatever came back; the modal's own
  required-field validation (brand + name) catches the rest on Save.
- **File-picker cancel** → silent no-op, overlay never shown.
- **Rate limit** — `identify-watch` already enforces 100 req/hour; on a rate-limit response,
  surface the same toast as the collection flow and fall back to the manual modal with the
  photo attached.

## Reused building blocks (no changes to these)

| Piece | Location | Role |
|-------|----------|------|
| `identify-watch` edge fn, `mode:'identify'` | supabase/functions/identify-watch/index.ts | single-watch identification |
| `blobToResizedBase64ForIdentify`, `blobToResizedBlob` | index.html | image prep |
| `validateImageFile` | index.html | file validation |
| `authedFetch` | index.html | authed POST |
| `openAddWishlist` | [index.html:21796](../../../index.html#L21796) | fresh modal |
| `buildWlBrandSelect` | [index.html:22074](../../../index.html#L22074) | brand prefill |
| `wlPendingFile` / `renderWlModalImg` | [index.html:22278](../../../index.html#L22278) | photo prefill |
| `saveWishlistItem` | [index.html:21914](../../../index.html#L21914) | save (unchanged) |

## Testing

- **Unit:** the flow is mostly DOM + network glue; add a small unit test for any pure helper
  introduced (e.g. a `pickIdentifiedWatch(resp)` that defensively extracts the first watch /
  normalizes `model`→`name`). Keep logic in such a helper so it's unit-testable.
- **E2E (mocked):** mock `identify-watch` `mode:'identify'`; assert that clicking "Add from
  Photo" → choosing a file → opens the wishlist modal with brand/name/ref and the photo
  prefilled; and that the error path opens the modal with a toast and the photo attached.
- **Manual UAT:** with a test account (testuser/testuser2 only, private visibility), photograph
  one watch, confirm prefill, Save, and verify the row + image in the `wishlist` table.
- Bump SW cache version (`sw.js` → next `wristlog-vNN`) since `index.html` changes.

## Rollout

- Single `index.html` change set + SW bump. No edge-function deploy, no DB migration.
- Update the in-app Help page / "What's New" to mention "Add a wishlist watch from a photo."
