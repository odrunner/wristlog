# Multi-Image Posts — Design Spec

## Overview

Add the ability to include up to 6 images in a single post. Currently posts support a single optional image via the `photo_url` column in the `logs` table. This feature extends that to multiple images while maintaining full backward compatibility with existing single-image and text-only posts.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Max images per post | 6 | Enough for a full watch showcase (wrist, dial, caseback, movement, lume, strap/box) without bloat |
| Feed display | Hero + Thumbnails | Main image gets full impact; thumbnails show what else is available without hiding content |
| Composer UX | Multi-select + "+" button | Users can batch-select or add incrementally — covers both workflows (Instagram/Strava pattern) |
| Fullscreen viewer | Swipe carousel | Dark overlay, swipe left/right, dot indicators + counter. Familiar, mobile-friendly |
| Edit support | Full (add/remove/reorder) | Same composer experience for create and edit |
| Storage model | JSON array in existing `photo_url` column | Zero migration risk, backward-compatible, simple |

## Data Model

### Storage Format

The existing `photo_url` TEXT column in the `logs` table stores one of:
- `null` — no image (text-only post or wear log without photo)
- `"https://...jpg?v=123"` — single image URL (existing behavior, unchanged)
- `'["https://...0.jpg?v=123","https://...1.jpg?v=123"]'` — JSON array of 2-6 image URLs

### Parsing Logic

```
if photo_url is null         → no images
if photo_url starts with "[" → JSON.parse() → array of URLs
otherwise                    → single URL string → wrap in [url] for uniform handling
```

All rendering code normalizes to an array internally, so the display logic has one path.

### Storage Paths

Current single-image path: `logs/{userId}/{logId}.jpg`

Multi-image paths: `logs/{userId}/{logId}_0.jpg`, `logs/{userId}/{logId}_1.jpg`, ... `logs/{userId}/{logId}_5.jpg`

Single-image posts continue using the existing path format (no suffix) for backward compatibility. Multi-image posts always use the `_N` suffix pattern.

### No Schema Migration Required

The `photo_url` column is already TEXT. JSON arrays are valid TEXT values. No database changes needed.

## Post Composer

### Current State
- Single file input (`newPostFile` variable)
- Single preview image (`newPostPhoto` variable)
- Upload area in the new-post modal

### New Behavior

**Variables:**
- `newPostFiles` — array of File objects (replaces `newPostFile`)
- `newPostPreviews` — array of object URLs for previews (replaces `newPostPhoto`)

**UI Layout:**
1. When no images selected: show upload area with "Add Photos" button
2. After selection: show thumbnail strip with:
   - Thumbnails for each selected image (small squares, ~60px)
   - First thumbnail labeled "Hero" (subtle badge or border)
   - "X" button on each thumbnail to remove that image
   - "+" button at the end of the strip to add more (hidden when at 6)
   - Counter text: "3/6 photos"
3. File input uses `multiple` attribute and `accept="image/*"`

**Reordering:**
- Drag-to-reorder on desktop (HTML drag-and-drop API)
- Long-press + drag on mobile (touch events)
- First image in the array is always the hero

**Validation:**
- Max 6 images enforced in the file input handler
- If user selects more than remaining slots, take only the first N that fit and show a toast: "Maximum 6 photos per post"

### Edit Post Flow

When editing a post with existing images:
1. Load current `photo_url` → parse to array → create preview thumbnails from URLs
2. User can remove existing images, add new ones, reorder
3. Track which images are new (File objects) vs existing (URL strings)
4. On save:
   - Delete removed images from storage
   - Upload new images to storage
   - Rebuild the URL array in the new order
   - Update `photo_url` in the `logs` table

## Feed Display — Hero + Thumbnails

### Single-Image Posts (Backward Compatible)
Rendered exactly as today: 4:5 aspect ratio, max 520px height, lazy-loaded. No visual change.

### Multi-Image Posts

```
┌─────────────────────────┐
│       User Header       │
├─────────────────────────┤
│                         │
│      Hero Image         │
│     (4:5 ratio)         │
│                         │
├────┬────┬────┬────┬─────┤
│ T1 │ T2 │ T3 │ T4 │ T5  │  ← thumbnail strip
└────┴────┴────┴────┴─────┘
│ Caption text...         │
│ Like · Comment · Share  │
└─────────────────────────┘
```

- **Hero image**: same styling as current single-image posts (4:5 aspect, object-fit: cover, lazy-loaded)
- **Thumbnail strip**: horizontal row of square thumbnails below the hero
  - Each thumbnail: square aspect ratio, object-fit: cover
  - Active thumbnail (corresponding to displayed hero) has a highlight border
  - Tap a thumbnail → hero image src swaps to that image (CSS transition for smoothness)
- **Image count badge**: small "1/4" indicator overlaid on top-right of hero

### CSS Classes

- `.feed-card-thumbnails` — the thumbnail strip container (flexbox, gap, horizontal scroll if needed)
- `.feed-card-thumb` — individual thumbnail
- `.feed-card-thumb.active` — highlighted thumbnail
- `.feed-card-photo-count` — the "1/4" badge overlay

## Fullscreen Image Viewer

Triggered by tapping the hero image or any thumbnail in the feed.

### Layout
- Full-viewport dark overlay (`position: fixed`, `background: rgba(0,0,0,0.95)`, `z-index: 9999`)
- Image centered, displayed at its natural size constrained by viewport (object-fit: contain)
- Counter "1/4" at top-left
- Close button "✕" at top-right
- Dot indicators at bottom center

### Navigation
- **Swipe left/right** on touch devices (touch event listeners with threshold)
- **Arrow buttons** on desktop (semi-transparent circles on left/right edges)
- **Keyboard**: left/right arrow keys, Escape to close
- **Swipe down** to close (touch drag downward past threshold dismisses overlay)

### Transitions
- Images crossfade or slide on navigation (CSS transform + transition)
- Overlay fades in on open, fades out on close

### Implementation
- Single reusable function: `openImageViewer(urls, startIndex)`
- Creates overlay DOM on first call, reuses on subsequent calls
- Cleans up keyboard listeners on close

## Upload Flow

### Creating a Post (saveNewPost changes)

Current flow:
1. Resize single image → upload → get URL → upsert log

New flow:
1. If single image:
   - Resize via `blobToResizedBlob()` → upload to `logs/{userId}/{logId}.jpg` (existing path format)
   - Store URL as plain string in `photo_url` (backward-compatible)
2. If 2-6 images: for each file in `newPostFiles` (in order):
   - Resize via `blobToResizedBlob()` (800px, 82% JPEG — unchanged)
   - Upload to `logs/{userId}/{logId}_{index}.jpg`
   - Collect public URL
   - Store as `JSON.stringify(urlArray)` in `photo_url`
3. If no images: `photo_url` = `null`
4. Upsert to `logs` table

### Deleting a Post

Current: delete single file at `logs/{userId}/{logId}.jpg`

New: parse `photo_url`, delete all files in the array. Use `Promise.all()` for parallel deletion.

### Editing a Post

1. Parse existing `photo_url` to get current URLs
2. Compare with new state after user edits:
   - Identify removed images → delete from storage
   - Identify new images → upload to storage
   - Rebuild URL array in new order
3. Update `photo_url`

New images get the next available index suffix to avoid overwriting. For example, if a post had images `_0, _1, _2` and the user removes `_1` and adds a new one, the new image becomes `_3`.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| User selects 8 images at once | Take first 6, toast: "Maximum 6 photos per post" |
| Upload fails for one image in a batch | Retry that image once. If still fails, show error toast, allow user to remove it and post the rest |
| Very slow connection (large batch) | Show per-image progress or overall progress bar in the composer |
| Browser doesn't support `multiple` on file input | Falls back to single-select; "+" button still works for adding more |
| Existing single-image posts | Continue to work exactly as before — `photo_url` is a plain string, rendering logic handles both formats |
| Post with 1 image selected via new composer | Stored as plain URL string, not a single-element array, for consistency with existing posts |

## What Stays the Same

- Text-only posts and wear logs without photos: unchanged
- Image resize quality (800px, 82% JPEG): unchanged
- Storage bucket (`media`): unchanged
- RLS policies: unchanged — `photo_url` is just a text column
- Moderation: unchanged — operates on the post level, not individual images
- Content filtering (`checkContent`): unchanged — applies to post text only
- Public feed queries: unchanged — `photo_url` is still selected as a text field
- iOS app: will need a separate update to support multi-image rendering

## Testing

### Unit Tests
- Parse `photo_url`: null, single string, JSON array, malformed JSON (graceful fallback)
- Thumbnail reordering logic
- Image count validation (max 6)
- URL array building from mixed existing/new images during edit

### E2E Tests (Mocked)
- Create post with multiple images — verify thumbnails render
- Tap thumbnail — verify hero swaps
- Open fullscreen viewer — verify swipe navigation
- Edit post — add/remove/reorder images
- Delete post with multiple images — verify all storage files removed

### Manual QA
- Test on iPhone Safari (touch swipe, long-press reorder)
- Test on MacBook Pro Chrome/Safari (drag reorder, arrow keys in viewer)
- Test with exactly 1, 2, 3, and 6 images
- Test editing: remove hero image (next becomes hero)
- Test slow connection behavior
