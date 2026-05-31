# Short Video Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to include 5-7 second videos in posts, mixed freely with photos (up to the existing 6-item cap), with auto-play-muted feed, fullscreen-with-sound viewer, and watch identification from the video's mid-frame poster.

**Architecture:** Reuse the existing `photo_url` JSON array storage. Detect photos vs videos by file extension via a new `isVideoUrl()` helper. Each video gets a paired poster JPEG (mid-duration frame) at `{path}_poster.jpg` for thumbnail display and watch identification. A single shared `IntersectionObserver` controls feed autoplay so only the visible video plays.

**Tech Stack:** Vanilla JS, HTML5 `<video>` element, Canvas API for poster extraction, IntersectionObserver, Supabase Storage (`media` bucket), Vitest unit tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `wrotate_test.js` | Modify | Add `isVideoUrl` + `posterUrlFor` exports |
| `tests/short-video.test.js` | Create | Unit tests for video helpers |
| `index.html` (CSS, after line 1591) | Modify | Video play-icon badges, sound toggle button, video controls overlay |
| `index.html` (HTML new post modal, ~line 4324) | Modify | File input `accept` adds `video/*` |
| `index.html` (HTML edit post modal, ~line 4353) | Modify | File input `accept` adds `video/*` |
| `index.html` (JS composer ~line 10058) | Modify | Add `newPostPosters[]` parallel array, video validation, poster generation |
| `index.html` (JS edit composer ~line 9744) | Modify | Add `epPosters[]` parallel array, mirror composer logic |
| `index.html` (JS thumbstrip render) | Modify | Render play-icon badge on video thumbnails |
| `index.html` (JS feed card ~line 9276) | Modify | Type-aware hero rendering (video vs img) |
| `index.html` (JS `feedThumbTap` ~line 9525) | Modify | Type-aware hero swap |
| `index.html` (JS viewer ~line 22809) | Modify | Render video in fullscreen viewer with autoplay+sound |
| `index.html` (JS save flow ~line 10309) | Modify | Type-aware upload in saveNewPost |
| `index.html` (JS edit save ~line 9952) | Modify | Type-aware upload + poster delete in saveEditPost |
| `index.html` (JS helpers ~line 17320) | Modify | Add `isVideoUrl`, `posterUrlFor`, `uploadVideo`, extend `deletePostPhotos` |
| `index.html` (JS new section) | Modify | `observeFeedVideo`, `toggleFeedVideoSound`, `extractPosterBlob`, `validateVideoFile` |
| `sw.js` | Modify | Bump cache version |

---

## Task 1: Add `isVideoUrl` and `posterUrlFor` Helpers to wrotate_test.js

**Files:**
- Modify: `wrotate_test.js` (add after `parsePhotoUrl` export at line 1260)
- Create: `tests/short-video.test.js`

- [ ] **Step 1: Write failing tests for `isVideoUrl`**

Create `tests/short-video.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { isVideoUrl, posterUrlFor } from '../wrotate_test.js';

describe('isVideoUrl', () => {
  it('returns false for null', () => {
    expect(isVideoUrl(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isVideoUrl(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isVideoUrl('')).toBe(false);
  });

  it('returns false for .jpg', () => {
    expect(isVideoUrl('https://example.com/photo.jpg')).toBe(false);
  });

  it('returns false for .jpg with query string', () => {
    expect(isVideoUrl('https://example.com/photo.jpg?v=123')).toBe(false);
  });

  it('returns true for .mp4', () => {
    expect(isVideoUrl('https://example.com/video.mp4')).toBe(true);
  });

  it('returns true for .webm', () => {
    expect(isVideoUrl('https://example.com/video.webm')).toBe(true);
  });

  it('returns true for .mov', () => {
    expect(isVideoUrl('https://example.com/video.mov')).toBe(true);
  });

  it('returns true for .mp4 with query string', () => {
    expect(isVideoUrl('https://example.com/video.mp4?v=999')).toBe(true);
  });

  it('returns true for uppercase .MP4', () => {
    expect(isVideoUrl('https://example.com/video.MP4')).toBe(true);
  });
});

describe('posterUrlFor', () => {
  it('returns empty string for null', () => {
    expect(posterUrlFor(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(posterUrlFor(undefined)).toBe('');
  });

  it('converts .mp4 to _poster.jpg', () => {
    expect(posterUrlFor('https://example.com/logs/u1/log1.mp4')).toBe('https://example.com/logs/u1/log1_poster.jpg');
  });

  it('converts .webm to _poster.jpg', () => {
    expect(posterUrlFor('https://example.com/v.webm')).toBe('https://example.com/v_poster.jpg');
  });

  it('converts .mov to _poster.jpg', () => {
    expect(posterUrlFor('https://example.com/v.mov')).toBe('https://example.com/v_poster.jpg');
  });

  it('preserves query string', () => {
    expect(posterUrlFor('https://example.com/v.mp4?v=42')).toBe('https://example.com/v_poster.jpg?v=42');
  });

  it('handles indexed multi-image suffix .mp4', () => {
    expect(posterUrlFor('https://example.com/logs/u1/log1_2.mp4')).toBe('https://example.com/logs/u1/log1_2_poster.jpg');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/short-video.test.js`
Expected: FAIL — `isVideoUrl` and `posterUrlFor` are not exported

- [ ] **Step 3: Implement helpers in `wrotate_test.js`**

Open `wrotate_test.js`. After the `parsePhotoUrl` export (currently lines 1254-1260), add:

```javascript
export function isVideoUrl(url) {
  if (!url) return false;
  const path = (url.split('?')[0] || '').toLowerCase();
  return path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov');
}

export function posterUrlFor(videoUrl) {
  if (!videoUrl) return '';
  const [base, query] = videoUrl.split('?');
  const posterBase = base.replace(/\.(mp4|webm|mov)$/i, '_poster.jpg');
  return query ? `${posterBase}?${query}` : posterBase;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/short-video.test.js`
Expected: All 16 tests PASS

- [ ] **Step 5: Commit**

```bash
git add wrotate_test.js tests/short-video.test.js
git commit -m "feat: add isVideoUrl and posterUrlFor helpers"
```

---

## Task 2: Add Video CSS

**Files:** Modify `index.html` (CSS, after line 1591 — end of `.img-viewer-dot.active` rule)

- [ ] **Step 1: Add CSS for video play-icon badge on thumbnails and sound toggle**

After line 1591 (the `.img-viewer-dot.active` rule), add:

```css
    /* Video badges and controls */
    .np-thumb-video-badge { position: absolute; bottom: 4px; left: 4px; width: 16px; height: 16px; background: rgba(0,0,0,.7); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 9px; pointer-events: none; }
    .feed-card-thumb-video-badge { position: absolute; bottom: 4px; right: 4px; width: 14px; height: 14px; background: rgba(0,0,0,.6); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 8px; pointer-events: none; }
    .feed-card-photo video { width: 100%; height: 100%; object-fit: cover; display: block; }
    .feed-video-sound { position: absolute; bottom: 8px; right: 8px; width: 30px; height: 30px; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; border: none; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; z-index: 1; }
    .feed-video-sound:hover { background: rgba(0,0,0,.8); }
    .img-viewer-overlay video { max-width: 100%; max-height: 85vh; object-fit: contain; }
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (CSS doesn't affect tests, this is a sanity check)

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add CSS for video badges, sound toggle, and fullscreen video"
```

---

## Task 3: Add Inline Helpers (`isVideoUrl`, `posterUrlFor`, `uploadVideo`, `validateVideoFile`, `extractPosterBlob`)

**Files:** Modify `index.html` (JS, near the existing `parsePhotoUrl` function around line 17320)

These helpers need to be defined BEFORE they're referenced by composer/feed code. They go near the other inline storage/upload helpers.

- [ ] **Step 1: Add `isVideoUrl` and `posterUrlFor` after the inline `parsePhotoUrl`**

Find `function parsePhotoUrl` (around line 17320). Add right after the existing `deletePostPhotos` function (which is at line 17328-17331):

```javascript
function isVideoUrl(url) {
  if (!url) return false;
  const path = (url.split('?')[0] || '').toLowerCase();
  return path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov');
}

function posterUrlFor(videoUrl) {
  if (!videoUrl) return '';
  const [base, query] = videoUrl.split('?');
  const posterBase = base.replace(/\.(mp4|webm|mov)$/i, '_poster.jpg');
  return query ? `${posterBase}?${query}` : posterBase;
}

async function uploadVideo(file, path) {
  const { error } = await db.storage.from('media').upload(path, file, {
    cacheControl: '31536000', upsert: true, contentType: file.type || 'video/mp4',
  });
  if (error) throw new Error('Video upload failed: ' + error.message);
  const { data: urlData } = db.storage.from('media').getPublicUrl(path);
  return urlData.publicUrl + '?v=' + Date.now();
}

function validateVideoFile(file) {
  const MAX_SIZE = 30 * 1024 * 1024; // 30 MB
  if (file.size > MAX_SIZE) {
    toast(`Video is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Please use a video under 30 MB.`, 'error');
    return false;
  }
  const SUPPORTED = ['video/mp4', 'video/webm', 'video/quicktime'];
  if (file.type && SUPPORTED.includes(file.type)) return true;
  const ext = file.name?.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'webm', 'mov'].includes(ext)) return true;
  toast('Videos must be MP4 or WebM.', 'error');
  return false;
}

// Returns a Promise resolving to { posterBlob, duration } or rejecting on error.
// Loads the video, seeks to 50% of duration, draws that frame to a canvas, exports as JPEG blob.
function extractPosterBlob(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const objUrl = URL.createObjectURL(file);
    let seeked = false;
    const cleanup = () => { URL.revokeObjectURL(objUrl); video.remove(); };
    video.onloadedmetadata = () => {
      if (!isFinite(video.duration) || video.duration <= 0) {
        cleanup(); reject(new Error('Invalid video duration')); return;
      }
      video.currentTime = video.duration * 0.5;
    };
    video.onseeked = () => {
      if (seeked) return;
      seeked = true;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const duration = video.duration;
        canvas.toBlob(b => {
          cleanup();
          if (b) resolve({ posterBlob: b, duration });
          else reject(new Error('Failed to extract poster'));
        }, 'image/jpeg', 0.95);
      } catch (err) { cleanup(); reject(err); }
    };
    video.onerror = () => { cleanup(); reject(new Error('Could not read video')); };
    video.src = objUrl;
  });
}
```

Also update `deletePostPhotos` (currently lines 17328-17331) to also delete posters for video URLs:

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

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add inline video helpers and poster cleanup in deletePostPhotos"
```

---

## Task 4: Update File Inputs to Accept Video

**Files:** Modify `index.html` (HTML at lines 4324 and 4353)

- [ ] **Step 1: Update new post file input**

At line 4324, change:
```html
      <input type="file" id="np-photo-input" accept="image/*" multiple
```
to:
```html
      <input type="file" id="np-photo-input" accept="image/*,video/*" multiple
```

- [ ] **Step 2: Update edit post file input**

At line 4353, change:
```html
      <input type="file" id="ep-photo-input" accept="image/*" multiple
```
to:
```html
      <input type="file" id="ep-photo-input" accept="image/*,video/*" multiple
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: file inputs accept video files"
```

---

## Task 5: Extend New Post Composer State and Validation

**Files:** Modify `index.html` (JS around lines 10058-10118)

This task adds the `newPostPosters[]` parallel array and updates `handleNewPostPhotos` to handle videos (validate, extract poster, push to state).

- [ ] **Step 1: Add `newPostPosters[]` state variable**

Find lines 10058-10060:
```javascript
let newPostFiles = [];    // array of File objects
let newPostPreviews = []; // array of object URLs for thumbnails
let npIdentifiedWatchId = null; // watchId from AI identification (or null)
```

Replace with:
```javascript
let newPostFiles = [];    // array of File objects (photos or videos)
let newPostPreviews = []; // array of object URLs for thumbnails (photo objectURL or poster objectURL)
let newPostPosters = [];  // array of Blob (videos) or null (photos), parallel to newPostFiles
let npIdentifiedWatchId = null; // watchId from AI identification (or null)
```

- [ ] **Step 2: Replace `handleNewPostPhotos` with type-aware version**

Replace the function (lines 10098-10118) with:

```javascript
async function handleNewPostPhotos(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  input.value = '';
  const wasEmpty = newPostFiles.length === 0;
  const slots = 6 - newPostFiles.length;
  if (files.length > slots) toast('Maximum 6 photos and videos per post', 'error');
  const limited = files.slice(0, slots);
  for (const f of limited) {
    const isVideo = f.type?.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(f.name || '');
    if (isVideo) {
      if (!validateVideoFile(f)) continue;
      let poster, duration;
      try {
        ({ posterBlob: poster, duration } = await extractPosterBlob(f));
      } catch (e) {
        toast('Could not read this video', 'error');
        continue;
      }
      if (duration > 7.5) {
        toast('Videos must be 7 seconds or less', 'error');
        continue;
      }
      newPostFiles.push(f);
      newPostPosters.push(poster);
      newPostPreviews.push(URL.createObjectURL(poster));
    } else {
      if (!validateImageFile(f)) continue;
      newPostFiles.push(f);
      newPostPosters.push(null);
      newPostPreviews.push(URL.createObjectURL(f));
    }
  }
  renderNpThumbstrip();
  // Watch identification: only when this was the FIRST batch added
  if (wasEmpty && newPostFiles.length) {
    const firstFile = newPostFiles[0];
    const firstIsVideo = !!newPostPosters[0];
    npIdentifyWatch(firstIsVideo ? newPostPosters[0] : firstFile);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: handle videos in new post composer (validate, extract poster)"
```

---

## Task 6: Update New Post Thumbstrip Render, Remove, Reorder, Clear

**Files:** Modify `index.html` (JS around lines 10120-10183)

The thumbstrip needs a video play badge. Remove/reorder/clear must keep `newPostPosters` in sync.

- [ ] **Step 1: Update `renderNpThumbstrip` to show video badges**

Replace `renderNpThumbstrip` (lines 10120-10151) with:

```javascript
function renderNpThumbstrip() {
  const strip = document.getElementById('np-thumbstrip');
  const counter = document.getElementById('np-photo-counter');
  const placeholder = document.getElementById('np-photo-placeholder');
  const area = document.getElementById('np-photo-area');
  if (!strip) return;
  if (!newPostFiles.length) {
    strip.style.display = 'none';
    counter.style.display = 'none';
    placeholder.style.display = '';
    if (area) { area.classList.add('log-photo-area'); area.onclick = () => document.getElementById('np-photo-input').click(); }
    return;
  }
  placeholder.style.display = 'none';
  strip.style.display = '';
  counter.style.display = '';
  if (area) { area.classList.remove('log-photo-area'); area.onclick = null; }
  counter.textContent = newPostFiles.length + '/6 photos';
  let html = '';
  for (let i = 0; i < newPostPreviews.length; i++) {
    const isVideo = !!newPostPosters[i];
    html += `<div class="np-thumb${i === 0 ? ' hero' : ''}" draggable="true"
      ondragstart="npThumbDragStart(event,${i})" ondragover="npThumbDragOver(event)"
      ondrop="npThumbDrop(event,${i})" ondragend="npThumbDragEnd(event)">
      <img src="${escHtml(newPostPreviews[i])}" alt="">
      ${isVideo ? '<div class="np-thumb-video-badge">▶</div>' : ''}
      <button type="button" class="np-thumb-remove" onclick="removeNpPhoto(${i})">✕</button>
    </div>`;
  }
  if (newPostFiles.length < 6) {
    html += `<button type="button" class="np-thumb-add" onclick="document.getElementById('np-photo-input').click()">+</button>`;
  }
  strip.innerHTML = html;
}
```

- [ ] **Step 2: Update `removeNpPhoto` to splice posters**

Replace `removeNpPhoto` (lines 10153-10158) with:

```javascript
function removeNpPhoto(idx) {
  URL.revokeObjectURL(newPostPreviews[idx]);
  newPostFiles.splice(idx, 1);
  newPostPreviews.splice(idx, 1);
  newPostPosters.splice(idx, 1);
  renderNpThumbstrip();
}
```

- [ ] **Step 3: Update drag-reorder to move posters along with files**

Find `npThumbDrop` (search for `function npThumbDrop`). Replace its body (the splice/insert block, currently moves `newPostFiles` and `newPostPreviews`) with:

```javascript
function npThumbDrop(e, targetIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (_npDragIdx < 0 || _npDragIdx === targetIdx) return;
  const [file] = newPostFiles.splice(_npDragIdx, 1);
  const [preview] = newPostPreviews.splice(_npDragIdx, 1);
  const [poster] = newPostPosters.splice(_npDragIdx, 1);
  newPostFiles.splice(targetIdx, 0, file);
  newPostPreviews.splice(targetIdx, 0, preview);
  newPostPosters.splice(targetIdx, 0, poster);
  _npDragIdx = -1;
  renderNpThumbstrip();
}
```

- [ ] **Step 4: Update `clearNewPostPhoto` to clear posters**

Replace `clearNewPostPhoto` (lines 10176-10183) with:

```javascript
function clearNewPostPhoto() {
  newPostPreviews.forEach(u => URL.revokeObjectURL(u));
  newPostFiles = [];
  newPostPreviews = [];
  newPostPosters = [];
  npIdentifiedWatchId = null;
  dismissNpWatchSuggestion();
  renderNpThumbstrip();
}
```

- [ ] **Step 5: Update `openNewPost` reset to also clear posters**

Find `openNewPost` (search for `function openNewPost`). Find the lines that reset `newPostFiles = []` and `newPostPreviews = []`. After them, add:

```javascript
  newPostPosters = [];
```

(The exact location: in `openNewPost`, there's a block resetting state. The reset for files and previews already exists; add the posters reset right after.)

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: composer thumbstrip handles video badges and posters in reorder/remove"
```

---

## Task 7: Update saveNewPost for Type-Aware Upload

**Files:** Modify `index.html` (JS around lines 10309-10322)

- [ ] **Step 1: Replace the upload block in `saveNewPost`**

Replace lines 10309-10322 (the `if (newPostFiles.length && currentUser)` block) with:

```javascript
  if (newPostFiles.length && currentUser) {
    try {
      if (newPostFiles.length === 1) {
        const f = newPostFiles[0];
        const isVideo = !!newPostPosters[0];
        if (isVideo) {
          const ext = (f.name?.split('.').pop()?.toLowerCase() === 'webm') ? 'webm' : 'mp4';
          const videoUrl = await uploadVideo(f, `logs/${currentUser.id}/${entry.id}.${ext}`);
          await uploadImage(newPostPosters[0], `logs/${currentUser.id}/${entry.id}_poster.jpg`);
          entry.photoUrl = videoUrl;
        } else {
          entry.photoUrl = await uploadImage(f, `logs/${currentUser.id}/${entry.id}.jpg`);
        }
      } else {
        const urls = [];
        for (let i = 0; i < newPostFiles.length; i++) {
          const f = newPostFiles[i];
          const isVideo = !!newPostPosters[i];
          if (isVideo) {
            const ext = (f.name?.split('.').pop()?.toLowerCase() === 'webm') ? 'webm' : 'mp4';
            const videoUrl = await uploadVideo(f, `logs/${currentUser.id}/${entry.id}_${i}.${ext}`);
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

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: saveNewPost uploads videos with paired posters"
```

---

## Task 8: Extend Edit Post Composer for Videos

**Files:** Modify `index.html` (JS around lines 9744-9842)

Mirror the composer logic in the edit flow. Add `epPosters[]` parallel array, type-aware `handleEditPostPhotos`, video badges in `renderEpThumbstrip`, syncing `epPosters` in remove/reorder/clear.

- [ ] **Step 1: Add `epPosters[]` state variable**

Find lines 9744-9746:
```javascript
let epExistingUrls = [];
let epFiles = [];
let epPreviews = [];
```

Replace with:
```javascript
let epExistingUrls = [];
let epFiles = [];      // mix of URL strings (existing) and File objects (new)
let epPreviews = [];   // URL strings (for both existing photos and existing video posters) or objectURLs
let epPosters = [];    // null for any entry that is an existing URL or a new photo; Blob for new videos
```

- [ ] **Step 2: Update `openEditPost` to populate `epPosters`**

Find `openEditPost`. Find the block (currently sets `epExistingUrls`, `epFiles`, `epPreviews`):

```javascript
  const existingUrls = parsePhotoUrl(fi.photo_url);
  epExistingUrls = [...existingUrls];
  epFiles = [...existingUrls];
  epPreviews = [...existingUrls];
  renderEpThumbstrip();
```

Replace with:
```javascript
  const existingUrls = parsePhotoUrl(fi.photo_url);
  epExistingUrls = [...existingUrls];
  epFiles = [...existingUrls];
  // For existing video URLs, the visible preview is the poster, not the video URL
  epPreviews = existingUrls.map(u => isVideoUrl(u) ? posterUrlFor(u) : u);
  epPosters = existingUrls.map(() => null);
  renderEpThumbstrip();
```

- [ ] **Step 3: Replace `handleEditPostPhotos` with type-aware version**

Replace (lines 9808-9825) with:

```javascript
async function handleEditPostPhotos(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  input.value = '';
  const slots = 6 - epFiles.length;
  if (files.length > slots) toast('Maximum 6 photos and videos per post', 'error');
  const limited = files.slice(0, slots);
  for (const f of limited) {
    const isVideo = f.type?.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(f.name || '');
    if (isVideo) {
      if (!validateVideoFile(f)) continue;
      let poster, duration;
      try {
        ({ posterBlob: poster, duration } = await extractPosterBlob(f));
      } catch (e) {
        toast('Could not read this video', 'error');
        continue;
      }
      if (duration > 7.5) {
        toast('Videos must be 7 seconds or less', 'error');
        continue;
      }
      epFiles.push(f);
      epPosters.push(poster);
      epPreviews.push(URL.createObjectURL(poster));
    } else {
      if (!validateImageFile(f)) continue;
      epFiles.push(f);
      epPosters.push(null);
      epPreviews.push(URL.createObjectURL(f));
    }
  }
  renderEpThumbstrip();
}
```

- [ ] **Step 4: Update `renderEpThumbstrip` to show video badges**

Replace (lines 9776-9806) with:

```javascript
function renderEpThumbstrip() {
  const strip = document.getElementById('ep-thumbstrip');
  const counter = document.getElementById('ep-photo-counter');
  const placeholder = document.getElementById('ep-photo-placeholder');
  const area = document.getElementById('ep-photo-area');
  if (!epFiles.length) {
    strip.style.display = 'none';
    counter.style.display = 'none';
    placeholder.style.display = '';
    if (area) { area.classList.add('log-photo-area'); area.onclick = () => document.getElementById('ep-photo-input').click(); }
    return;
  }
  placeholder.style.display = 'none';
  strip.style.display = '';
  counter.style.display = '';
  if (area) { area.classList.remove('log-photo-area'); area.onclick = null; }
  counter.textContent = epFiles.length + '/6 photos';
  let html = '';
  for (let i = 0; i < epPreviews.length; i++) {
    const isVideo = !!epPosters[i] || (typeof epFiles[i] === 'string' && isVideoUrl(epFiles[i]));
    html += `<div class="np-thumb${i === 0 ? ' hero' : ''}" draggable="true"
      ondragstart="epThumbDragStart(event,${i})" ondragover="npThumbDragOver(event)"
      ondrop="epThumbDrop(event,${i})" ondragend="npThumbDragEnd(event)">
      <img src="${escHtml(epPreviews[i])}" alt="">
      ${isVideo ? '<div class="np-thumb-video-badge">▶</div>' : ''}
      <button type="button" class="np-thumb-remove" onclick="removeEpPhoto(${i})">✕</button>
    </div>`;
  }
  if (epFiles.length < 6) {
    html += `<button type="button" class="np-thumb-add" onclick="document.getElementById('ep-photo-input').click()">+</button>`;
  }
  strip.innerHTML = html;
}
```

- [ ] **Step 5: Update `removeEpPhoto` to splice posters**

Replace (lines 9827-9834) with:

```javascript
function removeEpPhoto(idx) {
  if (typeof epPreviews[idx] === 'string' && !epExistingUrls.includes(epPreviews[idx]) && !epExistingUrls.some(u => posterUrlFor(u) === epPreviews[idx])) {
    URL.revokeObjectURL(epPreviews[idx]);
  }
  epFiles.splice(idx, 1);
  epPreviews.splice(idx, 1);
  epPosters.splice(idx, 1);
  renderEpThumbstrip();
}
```

- [ ] **Step 6: Update drag-reorder for edit**

Find `epThumbDrop` (search for `function epThumbDrop`). Replace with:

```javascript
function epThumbDrop(e, targetIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (_epDragIdx < 0 || _epDragIdx === targetIdx) return;
  const [file] = epFiles.splice(_epDragIdx, 1);
  const [preview] = epPreviews.splice(_epDragIdx, 1);
  const [poster] = epPosters.splice(_epDragIdx, 1);
  epFiles.splice(targetIdx, 0, file);
  epPreviews.splice(targetIdx, 0, preview);
  epPosters.splice(targetIdx, 0, poster);
  _epDragIdx = -1;
  renderEpThumbstrip();
}
```

- [ ] **Step 7: Update `clearEditPostPhoto` to clear posters**

Replace (lines 9837-9842) with:

```javascript
function clearEditPostPhoto() {
  epPreviews.forEach((u, i) => {
    if (epPosters[i] || (typeof u === 'string' && !epExistingUrls.includes(u) && !epExistingUrls.some(eu => posterUrlFor(eu) === u))) {
      URL.revokeObjectURL(u);
    }
  });
  epFiles = [];
  epPreviews = [];
  epPosters = [];
  renderEpThumbstrip();
}
```

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "feat: edit composer handles videos with poster tracking"
```

---

## Task 9: Update saveEditPost for Type-Aware Upload

**Files:** Modify `index.html` (JS around lines 9952-9978)

- [ ] **Step 1: Replace the upload block in `saveEditPost`**

Replace lines 9952-9970 (the `if (epFiles.length)` block that builds `urls`) with:

```javascript
  let finalPhotoUrl = null;
  if (epFiles.length) {
    const urls = [];
    let nextSuffix = 0;
    const usedSuffixes = new Set();
    // Track which suffixes are already used by existing items so we don't collide
    for (const eu of epExistingUrls) {
      const p = storagePathFrom(eu);
      if (!p) continue;
      const m = p.match(/_(\d+)\.(jpg|mp4|webm|mov)$/i);
      if (m) usedSuffixes.add(parseInt(m[1], 10));
    }
    const nextFreeSuffix = () => {
      while (usedSuffixes.has(nextSuffix)) nextSuffix++;
      const s = nextSuffix;
      usedSuffixes.add(s);
      nextSuffix++;
      return s;
    };
    for (let idx = 0; idx < epFiles.length; idx++) {
      const item = epFiles[idx];
      if (typeof item === 'string') {
        urls.push(item);
      } else {
        const isVideo = !!epPosters[idx];
        const suffix = nextFreeSuffix();
        try {
          if (isVideo) {
            const ext = (item.name?.split('.').pop()?.toLowerCase() === 'webm') ? 'webm' : 'mp4';
            const videoUrl = await uploadVideo(item, `logs/${currentUser.id}/${editPostLogId}_${suffix}.${ext}`);
            await uploadImage(epPosters[idx], `logs/${currentUser.id}/${editPostLogId}_${suffix}_poster.jpg`);
            urls.push(videoUrl);
          } else {
            const url = await uploadImage(item, `logs/${currentUser.id}/${editPostLogId}_${suffix}.jpg`);
            urls.push(url);
          }
        } catch (e) {
          toast('Upload failed — ' + e.message, 'error'); return;
        }
      }
    }
    finalPhotoUrl = urls.length === 1 ? urls[0] : JSON.stringify(urls);
  }
```

Note: `deletePostPhotos` (already updated in Task 3) handles posters for removed videos automatically.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: saveEditPost uploads new videos with paired posters"
```

---

## Task 10: Type-Aware Feed Hero Rendering and `feedThumbTap`

**Files:** Modify `index.html` (JS lines 9276-9291 and 9525-9534)

Plus add helper functions: `observeFeedVideo`, `toggleFeedVideoSound`.

- [ ] **Step 1: Replace the feed card hero rendering block**

Replace lines 9276-9291 (the `if (item.photo_url) { ... }` block, including the thumbnail strip) with:

```javascript
  let heroHtml = '';
  if (item.photo_url) {
    const _urls = parsePhotoUrl(item.photo_url);
    const heroUrl = _urls[0] || '';
    const heroIsVideo = isVideoUrl(heroUrl);
    const heroInner = heroIsVideo
      ? `<video id="feed-hero-${item.id}" src="${escHtml(heroUrl)}" poster="${escHtml(posterUrlFor(heroUrl))}" autoplay muted loop playsinline preload="metadata"></video>
         <button class="feed-video-sound" onclick="event.stopPropagation();toggleFeedVideoSound(event,'${item.id}')">🔇</button>`
      : `<img id="feed-hero-${item.id}" src="${escHtml(heroUrl)}" loading="lazy" onerror="this.parentElement.style.display='none'">`;
    heroHtml = `<div class="feed-card-photo" onclick="openImageViewer(${escAttr(JSON.stringify(_urls))},0)">
      ${heroInner}
      ${_urls.length > 1 ? `<span class="feed-card-photo-count">1/${_urls.length}</span>` : ''}
    </div>`;
    if (_urls.length > 1) {
      heroHtml += `<div class="feed-card-thumbnails">`;
      _urls.forEach((u, i) => {
        const itemIsVideo = isVideoUrl(u);
        const thumbSrc = itemIsVideo ? posterUrlFor(u) : u;
        heroHtml += `<div class="feed-card-thumb${i === 0 ? ' active' : ''}" onclick="feedThumbTap('${item.id}',${i},${escAttr(JSON.stringify(_urls))})">
          <img src="${escHtml(thumbSrc)}" loading="lazy" alt="">
          ${itemIsVideo ? '<div class="feed-card-thumb-video-badge">▶</div>' : ''}
        </div>`;
      });
      heroHtml += `</div>`;
    }
  } else if (w) {
```

(The `} else if (w) {` line is the start of the existing else-if branch — leave it intact.)

- [ ] **Step 2: Replace `feedThumbTap` with type-aware version**

Replace `feedThumbTap` (lines 9525-9534) with:

```javascript
function feedThumbTap(logId, idx, urls) {
  const card = document.getElementById('feedcard-' + logId);
  if (!card) return;
  const heroContainer = card.querySelector('.feed-card-photo');
  if (!heroContainer) return;
  const url = urls[idx];
  const isVid = isVideoUrl(url);
  let innerHtml = '';
  if (isVid) {
    innerHtml = `<video id="feed-hero-${logId}" src="${escHtml(url)}" poster="${escHtml(posterUrlFor(url))}" autoplay muted loop playsinline preload="metadata"></video>
      <button class="feed-video-sound" onclick="event.stopPropagation();toggleFeedVideoSound(event,'${logId}')">🔇</button>`;
  } else {
    innerHtml = `<img id="feed-hero-${logId}" src="${escHtml(url)}" loading="lazy" onerror="this.parentElement.style.display='none'">`;
  }
  if (urls.length > 1) {
    innerHtml += `<span class="feed-card-photo-count">${idx + 1}/${urls.length}</span>`;
  }
  heroContainer.innerHTML = innerHtml;
  if (isVid) observeFeedVideo(document.getElementById('feed-hero-' + logId));
  card.querySelectorAll('.feed-card-thumb').forEach((el, i) => el.classList.toggle('active', i === idx));
}
```

- [ ] **Step 3: Add `observeFeedVideo` and `toggleFeedVideoSound` helpers**

Add these functions somewhere in the JS section near `feedThumbTap`:

```javascript
let _videoObserver = null;
function observeFeedVideo(v) {
  if (!v) return;
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

function toggleFeedVideoSound(event, logId) {
  event.stopPropagation();
  const v = document.getElementById('feed-hero-' + logId);
  if (!v || v.tagName !== 'VIDEO') return;
  v.muted = !v.muted;
  const btn = event.currentTarget;
  btn.textContent = v.muted ? '🔇' : '🔊';
}
```

- [ ] **Step 4: Register videos with the observer on initial render**

After `loadFeed` (or wherever feed cards are inserted into the DOM), videos in the feed need to be observed. The simplest approach is to register all video heroes after feed render completes.

Find `loadFeed` (search for `async function loadFeed`). At the END of its function body (just before the closing brace, after `renderFeed()` or equivalent is called), add:

```javascript
  // Register any video heroes with the autoplay observer
  document.querySelectorAll('.feed-card-photo > video').forEach(v => observeFeedVideo(v));
```

If `loadFeed` has multiple exit points, also add this after `refreshFeedCard` (search for `function refreshFeedCard`) at the end of its body.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: type-aware feed hero rendering with video autoplay and sound toggle"
```

---

## Task 11: Type-Aware Fullscreen Viewer

**Files:** Modify `index.html` (JS lines 22820-22855)

The viewer currently builds an `<img>` element. Extend `_buildViewer` and `_renderViewer` to swap between `<img>` and `<video>` based on the current item's type. Video plays unmuted with native controls.

- [ ] **Step 1: Replace `_buildViewer`**

Replace `_buildViewer` (lines 22820-22840) with:

```javascript
function _buildViewer() {
  _viewerOverlay = document.createElement('div');
  _viewerOverlay.className = 'img-viewer-overlay';
  _viewerOverlay.innerHTML = `
    <button class="img-viewer-close" onclick="closeImageViewer()">✕</button>
    <span class="img-viewer-counter"></span>
    <div class="img-viewer-media-slot" style="display:flex;align-items:center;justify-content:center;width:100%;max-height:85vh;"></div>
    <button class="img-viewer-arrow img-viewer-prev" onclick="viewerNav(-1)">‹</button>
    <button class="img-viewer-arrow img-viewer-next" onclick="viewerNav(1)">›</button>
    <div class="img-viewer-dots"></div>`;
  _viewerOverlay.addEventListener('click', e => { if (e.target === _viewerOverlay) closeImageViewer(); });
  let _touchX = 0;
  let _touchY = 0;
  _viewerOverlay.addEventListener('touchstart', e => { _touchX = e.touches[0].clientX; _touchY = e.touches[0].clientY; }, { passive: true });
  _viewerOverlay.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _touchX;
    const dy = e.changedTouches[0].clientY - _touchY;
    if (Math.abs(dy) > 80 && Math.abs(dy) > Math.abs(dx)) { closeImageViewer(); return; }
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { viewerNav(dx < 0 ? 1 : -1); }
  }, { passive: true });
}
```

- [ ] **Step 2: Replace `_renderViewer`**

Replace `_renderViewer` (lines 22842-22855) with:

```javascript
function _renderViewer() {
  const slot = _viewerOverlay.querySelector('.img-viewer-media-slot');
  const url = _viewerUrls[_viewerIdx];
  const isVid = isVideoUrl(url);
  if (isVid) {
    slot.innerHTML = `<video src="${escHtml(url)}" poster="${escHtml(posterUrlFor(url))}" autoplay loop playsinline controls style="max-width:100%;max-height:85vh;object-fit:contain;"></video>`;
  } else {
    slot.innerHTML = `<img src="${escHtml(url)}" alt="" style="max-width:100%;max-height:85vh;object-fit:contain;">`;
  }
  _viewerOverlay.querySelector('.img-viewer-counter').textContent = (_viewerIdx + 1) + ' / ' + _viewerUrls.length;
  _viewerOverlay.querySelector('.img-viewer-prev').style.display = _viewerUrls.length > 1 ? '' : 'none';
  _viewerOverlay.querySelector('.img-viewer-next').style.display = _viewerUrls.length > 1 ? '' : 'none';
  const dots = _viewerOverlay.querySelector('.img-viewer-dots');
  if (_viewerUrls.length > 1) {
    dots.innerHTML = _viewerUrls.map((_, i) => `<button class="img-viewer-dot${i === _viewerIdx ? ' active' : ''}" onclick="viewerJump(${i})"></button>`).join('');
    dots.style.display = '';
  } else {
    dots.style.display = 'none';
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: fullscreen viewer renders video with autoplay and sound"
```

---

## Task 12: Update deleteLog Comment for Clarity

**Files:** Modify `index.html` (line 14138)

The existing `deleteLog` already calls `deletePostPhotos`, which is now poster-aware after Task 3. Just update the comment for documentation.

- [ ] **Step 1: Update the comment**

At line 14138, change:
```javascript
  // Cleanup Storage photo if present
```
to:
```javascript
  // Cleanup Storage media (photos, videos, and video posters) if present
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "chore: clarify deleteLog comment for video support"
```

---

## Task 13: Bump SW Cache + Add Manual Verification Notes

**Files:** Modify `sw.js`

- [ ] **Step 1: Bump SW cache version**

Open `sw.js`. Find the cache name `wristlog-vNN` and increment by 1.

- [ ] **Step 2: Run full test suite**

Run: `npm test && npm run test:e2e`
Expected: All unit + mocked E2E tests pass.

- [ ] **Step 3: Manual end-to-end verification**

On http://192.168.1.246:3000 as testuser:

1. **Photo-only post** — still works, no behavior change.
2. **Single video post** — record a 5-sec video on phone → select → composer shows poster thumbnail with ▶ badge → counter "1/6 photos" → Post → feed card auto-plays muted → tap sound icon → audio on → tap to expand → fullscreen plays with sound.
3. **Mixed post (1 video + 2 photos)** — pick 1 video then 2 photos → composer shows 3 thumbnails (video has ▶) → counter "3/6" → drag video to first → save → feed card hero auto-plays the video → tap photo thumbnail → swap to photo (video pauses) → tap video thumbnail → swap back, video auto-plays.
4. **Video too long** — pick a 10-sec video → toast "Videos must be 7 seconds or less" → file is rejected.
5. **Video too large** — pick a > 30 MB video → toast "Video is too large" → rejected.
6. **Watch identification on video-only post** — pick a single video → wait → watch suggestion appears (identified from poster frame).
7. **Edit video post** — open edit modal → existing video shows with ▶ badge → remove it → save → post becomes text-only OR add a photo → save → mixed/photo post.
8. **Delete video post** — delete → verify both `.mp4` and `_poster.jpg` files are removed from Supabase storage.
9. **Multi-video autoplay** — scroll a feed with multiple videos → only the one in view plays at a time (IntersectionObserver works).
10. **iPhone Safari** — repeat 2+3 on iPhone, confirm `playsinline` prevents fullscreen jump and `muted` permits autoplay.

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "chore: bump SW cache for short video posts feature"
```
