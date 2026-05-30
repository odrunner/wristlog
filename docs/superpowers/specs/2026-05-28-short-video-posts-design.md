# Short Video Posts — Design Spec

## Overview

Add the ability to include short videos (up to 7 seconds) in posts, mixed freely with photos. Builds on the just-shipped multi-image posts feature — the existing `photo_url` JSON array storage, hero+thumbnails feed UI, and fullscreen viewer all extend to videos with minimal new infrastructure.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Photo + video mixing | Strava-style mix | Single post can hold any mix of photos and videos, up to the existing 6-item cap |
| Capture method | File picker only | No in-app camera (browser camera APIs are flaky, especially mobile Safari). Users record outside |
| Max length | 7 seconds, hard cap | Reject longer videos with clear error; user trims externally |
| Feed playback | Auto-play muted, looping | Strava/Instagram pattern; videos start when scrolled into view, loop silently |
| Fullscreen audio | Auto-unmute on open | Tapping a video to expand is an intent signal; watch sounds matter |
| Watch identification | Run on first item's image | If first item is a photo → photo. If first item is a video → use the video's poster frame |
| Storage model | Reuse `photo_url` JSON array | Type detected by file extension; zero schema migration |
| Poster frame | ~50% into duration | Skips blurry intro frames; more likely to show watch in focus. Same frame used for poster + identification |

## Data Model

### Storage Format

The existing `photo_url` TEXT column continues to hold:
- `null` — no media
- A plain URL string — single item, photo (back-compat)
- A JSON array of URL strings — 2-6 items, photos and/or videos in display order

URLs end in `.jpg` (photo) or `.mp4` / `.webm` (video). Type is detected from extension.

### Type Detection Helper

```javascript
function isVideoUrl(url) {
  if (!url) return false;
  const path = (url.split('?')[0] || '').toLowerCase();
  return path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov');
}
```

`parsePhotoUrl` is unchanged — still returns a flat array of URL strings. Consumers loop and check type per item.

### Storage Paths

- **Photo (single)**: `logs/{userId}/{logId}.jpg` (existing)
- **Photo (multi)**: `logs/{userId}/{logId}_N.jpg` (existing)
- **Video (single)**: `logs/{userId}/{logId}.mp4`
- **Video (multi)**: `logs/{userId}/{logId}_N.mp4`
- **Video poster** (always paired with video): same path with `_poster.jpg` appended to the basename
  - Single: `logs/{userId}/{logId}_poster.jpg`
  - Multi: `logs/{userId}/{logId}_N_poster.jpg`

Posters are uploaded as separate storage objects (not stored in DB) — they're derived from the video URL by appending `_poster.jpg` to the basename. A helper `posterUrlFor(videoUrl)` does this transformation.

### Mixed Post Order

Order in the JSON array = display order. Hero = first item. Reordering via drag updates the array.

### No Schema Migration

`photo_url` is already TEXT. No changes to the database schema, RLS, or any RPC.

## Composer (Post Creation)

### File Picker

`<input type="file" accept="image/*,video/*" multiple>` — accepts photos and videos in the same picker.

### Per-File Validation (before adding to composer)

For each accepted file:
1. **Identify type** via MIME (`file.type.startsWith('video/')`) or extension fallback.
2. **For photos** — existing `validateImageFile` runs (size, format).
3. **For videos**:
   - Reject if MIME is not `video/mp4`, `video/webm`, or `video/quicktime` (with extension fallback to `.mp4`, `.webm`, `.mov`).
   - Reject if file size > **30 MB** (defensive; 7-sec videos rarely exceed this).
   - Decode duration by loading the file into a hidden `<video>` element. Reject if `video.duration > 7.5` (allow 0.5 sec tolerance for encoding rounding).
   - On any rejection, show a clear toast: `"Videos must be 7 seconds or less"` / `"Video file is too large (max 30 MB)"`.
4. Enforce the global 6-item cap (photos + videos combined).

### Poster Frame Generation

For each accepted video, immediately after validation:
1. Load into a hidden `<video>` element with `preload="auto"`.
2. Seek to `video.duration * 0.5`.
3. After `seeked` fires, draw the frame to a canvas at the video's natural dimensions (`videoWidth` × `videoHeight`).
4. Export as JPEG blob at quality 0.95 (we let `uploadImage` do the 800px resize downstream).
5. Store the poster blob in a parallel array (`newPostPosters[]`) keyed by index. For photo entries, the parallel slot is `null`.

### Composer State (extends multi-image vars)

```javascript
let newPostFiles = [];     // File objects (photos or videos)
let newPostPreviews = [];  // object URLs — for photos use createObjectURL on the photo; for videos use the poster blob's object URL
let newPostPosters = [];   // poster Blobs for videos; null entries for photos
```

`newPostPreviews[i]` is what the composer thumbnail strip displays. For videos, it shows the poster image so the thumbstrip looks consistent.

### Composer Thumbnail Strip

Identical to multi-image thumbnails, with one addition:
- Video items have a small **play-icon badge** in the corner (▶, semi-transparent, bottom-right of the thumbnail) so users can tell media types apart at a glance.

Reorder via drag works unchanged. Remove via the × button works unchanged.

### Watch Identification

The existing `npIdentifyWatch(file)` accepts a File or Blob. Update the trigger logic:

```javascript
// Inside handleNewPostPhotos, after adding accepted items:
if (newPostFiles.length === accepted.length) {
  const firstFile = newPostFiles[0];
  const firstIsVideo = firstFile.type?.startsWith('video/');
  // For videos: use the generated poster blob; for photos: use the file directly
  npIdentifyWatch(firstIsVideo ? newPostPosters[0] : firstFile);
}
```

Video-only posts get watch ID via the poster frame. Mixed posts where the video is first also use the video poster. If a photo is first, identification uses the photo (current behavior).

## Feed Display

### Type-Aware Hero Rendering

```javascript
if (item.photo_url) {
  const _urls = parsePhotoUrl(item.photo_url);
  const heroUrl = _urls[0] || '';
  const heroIsVideo = isVideoUrl(heroUrl);
  // ... render <video> or <img> based on heroIsVideo
}
```

### Single Video Post

Hero area renders:
```html
<div class="feed-card-photo" onclick="openImageViewer(...)">
  <video id="feed-hero-{logId}"
         src="{videoUrl}"
         poster="{posterUrl}"
         autoplay muted loop playsinline
         preload="metadata"></video>
  <button class="feed-video-sound" onclick="toggleFeedVideoSound(event, '{logId}')">🔇</button>
</div>
```

- **`autoplay muted loop playsinline`**: required for browsers to permit auto-play (especially Safari) and to play inline on iOS.
- **`poster`**: derived via `posterUrlFor(videoUrl)`. Shown before video buffers.
- **Sound icon overlay**: bottom-right corner. Tap to toggle mute in place (does NOT open fullscreen — uses `event.stopPropagation()`).

### Multi-Item Post with Mixed Media

- Hero displays an `<img>` or `<video>` based on the first URL's type.
- Thumbnail strip renders each item using the **poster image** for video items (so the strip is visually uniform).
- Video thumbnails get a small ▶ badge to distinguish them.
- Tapping a thumbnail swaps the hero. If the new hero is a video, we replace the `<img>` element with a `<video>` element (and vice versa); pre-existing video state (mute, current time) is reset.

### `feedThumbTap` Updated

```javascript
function feedThumbTap(logId, idx, urls) {
  const card = document.getElementById('feedcard-' + logId);
  if (!card) return;
  const heroContainer = card.querySelector('.feed-card-photo');
  if (!heroContainer) return;
  const url = urls[idx];
  if (isVideoUrl(url)) {
    heroContainer.innerHTML = `<video id="feed-hero-${logId}" src="${escHtml(url)}" poster="${escHtml(posterUrlFor(url))}" autoplay muted loop playsinline preload="metadata"></video>
      <button class="feed-video-sound" onclick="event.stopPropagation();toggleFeedVideoSound(event,'${logId}')">🔇</button>
      <span class="feed-card-photo-count">${idx + 1}/${urls.length}</span>`;
    observeFeedVideo(document.getElementById('feed-hero-' + logId));
  } else {
    heroContainer.innerHTML = `<img id="feed-hero-${logId}" src="${escHtml(url)}" loading="lazy" onerror="this.parentElement.style.display='none'">
      <span class="feed-card-photo-count">${idx + 1}/${urls.length}</span>`;
  }
  card.querySelectorAll('.feed-card-thumb').forEach((el, i) => el.classList.toggle('active', i === idx));
}
```

### Auto-Play Control with IntersectionObserver

A single shared observer is created lazily (first call to `observeFeedVideo`) to prevent multiple videos playing simultaneously and to save bandwidth:

```javascript
let _videoObserver = null;
function observeFeedVideo(v) {
  if (!_videoObserver) {
    _videoObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const t = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          t.play().catch(() => {});
        } else {
          t.pause();
        }
      });
    }, { threshold: [0, 0.5, 1] });
  }
  _videoObserver.observe(v);
}
```

Every `<video>` element rendered into the feed (during initial render and during `feedThumbTap` hero swaps) calls `observeFeedVideo(videoEl)`. When the hero is swapped to a different media item, the old element is removed from the DOM, which automatically frees the observation (no manual unobserve needed since the element is garbage-collected).

### Sound Toggle

```javascript
function toggleFeedVideoSound(event, logId) {
  event.stopPropagation();
  const v = document.getElementById('feed-hero-' + logId);
  if (!v || v.tagName !== 'VIDEO') return;
  v.muted = !v.muted;
  const btn = event.currentTarget;
  btn.textContent = v.muted ? '🔇' : '🔊';
}
```

## Fullscreen Image Viewer (extends existing)

The existing `openImageViewer(urls, startIdx)` already handles arrays. Extend it to detect video URLs and render `<video>` instead of `<img>`.

### Updated Layout

- For photo items: existing `<img>` rendering.
- For video items: `<video autoplay loop playsinline controls>` with sound **unmuted** by default in fullscreen.
- The viewer's existing close, swipe-down-to-dismiss, and arrow nav all still apply.

### Mixed-Item Nav

When the user swipes/clicks to navigate between items in fullscreen:
- Switching FROM a video: pause it (release resources).
- Switching TO a video: load it muted=false, autoplay.
- Switching between two photos: existing behavior.

### Controls

Use the browser's native `<video controls>` for the fullscreen viewer. Simple, works everywhere, no custom scrubber to build. The minimalist overlay (close X, counter, dots) sits above the video controls.

## Upload Flow (saveNewPost)

Replace the current per-file upload loop with type-aware handling:

```javascript
if (newPostFiles.length && currentUser) {
  try {
    if (newPostFiles.length === 1) {
      const f = newPostFiles[0];
      if (f.type?.startsWith('video/')) {
        const videoUrl = await uploadVideo(f, `logs/${currentUser.id}/${entry.id}.mp4`);
        await uploadImage(newPostPosters[0], `logs/${currentUser.id}/${entry.id}_poster.jpg`);
        entry.photoUrl = videoUrl;
      } else {
        entry.photoUrl = await uploadImage(f, `logs/${currentUser.id}/${entry.id}.jpg`);
      }
    } else {
      const urls = [];
      for (let i = 0; i < newPostFiles.length; i++) {
        const f = newPostFiles[i];
        if (f.type?.startsWith('video/')) {
          const videoUrl = await uploadVideo(f, `logs/${currentUser.id}/${entry.id}_${i}.mp4`);
          await uploadImage(newPostPosters[i], `logs/${currentUser.id}/${entry.id}_${i}_poster.jpg`);
          urls.push(videoUrl);
        } else {
          const url = await uploadImage(f, `logs/${currentUser.id}/${entry.id}_${i}.jpg`);
          urls.push(url);
        }
      }
      entry.photoUrl = JSON.stringify(urls);
    }
  } catch(e) { toast('Upload failed — ' + e.message, 'error'); return; }
}
```

### New `uploadVideo` Helper

```javascript
async function uploadVideo(file, path) {
  const { error } = await db.storage.from('media').upload(path, file, {
    cacheControl: '31536000',
    upsert: true,
    contentType: file.type || 'video/mp4',
  });
  if (error) throw new Error('Video upload failed: ' + error.message);
  const { data: urlData } = db.storage.from('media').getPublicUrl(path);
  return urlData.publicUrl + '?v=' + Date.now();
}
```

Note: no resize. Videos are uploaded as-is. Quality and size are managed by the 7-sec cap and 30 MB limit.

### `posterUrlFor` Helper

```javascript
function posterUrlFor(videoUrl) {
  if (!videoUrl) return '';
  // Strip cache-bust, change .mp4/.webm/.mov to _poster.jpg, re-append cache-bust
  const [base, query] = videoUrl.split('?');
  const posterBase = base.replace(/\.(mp4|webm|mov)$/i, '_poster.jpg');
  return query ? `${posterBase}?${query}` : posterBase;
}
```

## Delete Flow

`deletePostPhotos` needs to also delete the poster for any video URLs:

```javascript
function deletePostPhotos(photoUrl) {
  const urls = parsePhotoUrl(photoUrl);
  urls.forEach(u => {
    const p = storagePathFrom(u);
    if (p) deleteStorageFile(p);
    if (isVideoUrl(u)) {
      const posterPath = storagePathFrom(posterUrlFor(u));
      if (posterPath) deleteStorageFile(posterPath);
    }
  });
}
```

## Edit Post Flow

Mirrors the multi-image edit pattern. The `epFiles[]` array can hold:
- A URL string (existing photo OR existing video — type detected from URL)
- A File object (new photo OR new video — type detected from `file.type`)

For new videos, also track posters in a parallel `epPosters` array (objectURL or null per index).

On save:
- For each item: existing string → keep URL. New File → upload (photo or video, with poster as needed).
- For removed items: existing `deletePostPhotos` cleanup handles both video file and poster.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| User picks an 8-second video | Reject with toast: "Videos must be 7 seconds or less" |
| User picks a 50 MB video | Reject with toast: "Video file is too large (max 30 MB)" |
| User picks an unsupported video format | Reject with toast: "MP4 and WebM are supported" |
| Poster generation fails (corrupt video) | Reject the video with toast: "Could not read this video" |
| 6-item cap hit by mixed picks | Take first N that fit (existing behavior), toast: "Maximum 6 photos and videos per post" |
| Browser doesn't allow autoplay (rare) | The IntersectionObserver-triggered `play()` rejects silently. Poster image stays visible. User can tap to open fullscreen and play with controls. |
| Old single-photo posts | photo_url is a plain URL string — handled exactly as before. `isVideoUrl` returns false. No behavior change. |
| Video without poster (legacy / failed upload) | If poster fetch 404s, browser shows black frame. Not ideal but not fatal. |

## What Stays the Same

- Photo-only posts and wear logs: unchanged
- Image resize quality (800px, 82% JPEG): unchanged
- Storage bucket (`media`): unchanged
- RLS policies, moderation, content filtering: unchanged
- Public feed queries: unchanged — `photo_url` is still TEXT
- 6-item cap (now photos + videos combined)
- iOS app: will need a separate update to support `<video>` playback in feed and viewer

## Testing

### Unit Tests
- `isVideoUrl`: jpg/mp4/webm/mov, with and without `?v=` query, null/empty
- `posterUrlFor`: jpg path unchanged; mp4/webm/mov → `_poster.jpg`; preserves query string
- `parsePhotoUrl` already covered — no changes
- Mixed-type array rendering decisions (which items render as video vs photo)

### E2E Tests (Mocked)
- Create post with single video — verify upload + poster paths
- Create post with mixed photo+video — verify hero swap on thumbnail tap, both directions
- Edit post: add video to existing photo post, remove video, reorder
- Delete post with mixed media — verify all storage files (incl. posters) removed
- Fullscreen viewer: navigate between photo and video items, audio unmuted on open

### Manual QA
- iPhone Safari: video records → upload → plays auto-muted in feed → tap to expand → sound on
- Mobile Chrome: same flow
- Desktop: drag-reorder works for video items, hero swap is smooth
- Watch identification: video-only post correctly identifies watch from poster frame
- IntersectionObserver: only one video plays at a time when scrolling through feed
