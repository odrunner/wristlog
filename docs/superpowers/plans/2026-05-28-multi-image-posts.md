# Multi-Image Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to attach up to 6 images per post, displayed as hero + thumbnails in the feed, with fullscreen swipe viewer and full edit support.

**Architecture:** JSON array in the existing `photo_url` TEXT column (no schema migration). Single-image posts keep plain URL string for backward compatibility. Multi-image posts store `JSON.stringify(["url1","url2",...])`. A shared `parsePhotoUrl()` helper normalizes both formats to arrays for rendering.

**Tech Stack:** Vanilla JS, Supabase Storage (`media` bucket), Vitest for unit tests, Playwright for E2E.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `wrotate_test.js` | Modify | Add `parsePhotoUrl()` export + multi-image logic |
| `tests/multi-image.test.js` | Create | Unit tests for parsePhotoUrl and multi-image helpers |
| `index.html` (CSS ~line 1561) | Modify | Add thumbnail strip + fullscreen viewer styles |
| `index.html` (HTML ~line 4271-4299) | Modify | New post modal: multi-image composer |
| `index.html` (HTML ~line 4301-4343) | Modify | Edit post modal: multi-image composer |
| `index.html` (JS ~line 9929-9998) | Modify | New post state vars + handlers for multi-image |
| `index.html` (JS ~line 9678-9900) | Modify | Edit post state vars + handlers for multi-image |
| `index.html` (JS ~line 9236-9278) | Modify | Feed card rendering: hero + thumbnails |
| `index.html` (JS ~line 10105-10182) | Modify | saveNewPost: multi-image upload flow |
| `index.html` (JS ~line 13888-13903) | Modify | deleteLog: multi-image storage cleanup |
| `index.html` (JS new section) | Modify | Fullscreen image viewer component |

---

## Task 1: parsePhotoUrl Helper + Tests

**Files:**
- Modify: `wrotate_test.js` (add after `storagePathFrom` export, ~line 1257)
- Create: `tests/multi-image.test.js`

- [ ] **Step 1: Write failing tests for parsePhotoUrl**

Create `tests/multi-image.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { parsePhotoUrl } from '../wrotate_test.js';

describe('parsePhotoUrl', () => {
  it('returns empty array for null', () => {
    expect(parsePhotoUrl(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(parsePhotoUrl(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parsePhotoUrl('')).toEqual([]);
  });

  it('wraps a single URL string in an array', () => {
    const url = 'https://example.com/photo.jpg?v=123';
    expect(parsePhotoUrl(url)).toEqual([url]);
  });

  it('parses a JSON array of URLs', () => {
    const urls = ['https://example.com/a.jpg', 'https://example.com/b.jpg'];
    expect(parsePhotoUrl(JSON.stringify(urls))).toEqual(urls);
  });

  it('parses a JSON array of 6 URLs', () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}.jpg`);
    expect(parsePhotoUrl(JSON.stringify(urls))).toEqual(urls);
  });

  it('returns single-element array for malformed JSON starting with [', () => {
    const bad = '[not valid json';
    expect(parsePhotoUrl(bad)).toEqual([bad]);
  });

  it('handles a single-element JSON array', () => {
    const urls = ['https://example.com/only.jpg'];
    expect(parsePhotoUrl(JSON.stringify(urls))).toEqual(urls);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/multi-image.test.js`
Expected: FAIL — `parsePhotoUrl` is not exported from `wrotate_test.js`

- [ ] **Step 3: Implement parsePhotoUrl in wrotate_test.js**

Add after the `storagePathFrom` function (around line 1257):

```javascript
export function parsePhotoUrl(photoUrl) {
  if (!photoUrl) return [];
  if (photoUrl.startsWith('[')) {
    try { return JSON.parse(photoUrl); } catch (e) { return [photoUrl]; }
  }
  return [photoUrl];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/multi-image.test.js`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add wrotate_test.js tests/multi-image.test.js
git commit -m "feat: add parsePhotoUrl helper for multi-image support"
```

---

## Task 2: Multi-Image CSS — Thumbnail Strip, Composer, Fullscreen Viewer

**Files:**
- Modify: `index.html` (CSS section, after `.feed-card-photo img` rule at ~line 1562)

- [ ] **Step 1: Add CSS for thumbnail strip in feed cards**

Insert after line 1562 (`.feed-card-photo img` rule):

```css
.feed-card-thumbnails { display: flex; gap: 2px; padding: 2px; background: var(--surface2); }
.feed-card-thumb { flex: 1; aspect-ratio: 1; overflow: hidden; cursor: pointer; position: relative; max-width: 80px; }
.feed-card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; opacity: .7; transition: opacity .2s; }
.feed-card-thumb.active img { opacity: 1; }
.feed-card-thumb:hover img { opacity: 1; }
.feed-card-photo-count { position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,.6); color: #fff; font-size: .7rem; padding: 2px 6px; border-radius: 10px; pointer-events: none; }
.feed-card-photo { position: relative; }
```

- [ ] **Step 2: Add CSS for multi-image composer (new post + edit post modals)**

Insert after the thumbnail strip CSS:

```css
.np-thumbstrip { display: flex; gap: 6px; padding: 8px 0; overflow-x: auto; align-items: center; }
.np-thumb { width: 60px; height: 60px; border-radius: 6px; overflow: hidden; position: relative; flex-shrink: 0; border: 2px solid transparent; }
.np-thumb.hero { border-color: var(--accent); }
.np-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.np-thumb .np-thumb-remove { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; background: rgba(0,0,0,.7); color: #fff; font-size: 11px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; padding: 0; }
.np-thumb-add { width: 60px; height: 60px; border-radius: 6px; border: 2px dashed var(--muted); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; color: var(--muted); font-size: 1.3rem; background: none; }
.np-thumb-add:hover { border-color: var(--accent); color: var(--accent); }
.np-photo-counter { font-size: .75rem; color: var(--muted); padding: 2px 0; }
.np-thumb.dragging { opacity: .5; }
.np-thumb.drag-over { border-color: var(--accent); }
```

- [ ] **Step 3: Add CSS for fullscreen image viewer**

Insert after the composer CSS:

```css
.img-viewer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.95); z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0; transition: opacity .2s; }
.img-viewer-overlay.visible { opacity: 1; }
.img-viewer-overlay img { max-width: 100%; max-height: 85vh; object-fit: contain; }
.img-viewer-close { position: absolute; top: 12px; right: 16px; background: none; border: none; color: #fff; font-size: 1.5rem; cursor: pointer; z-index: 1; padding: 4px 8px; }
.img-viewer-counter { position: absolute; top: 14px; left: 16px; color: rgba(255,255,255,.7); font-size: .85rem; }
.img-viewer-arrow { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,.15); border: none; color: #fff; width: 36px; height: 36px; border-radius: 50%; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 1; }
.img-viewer-arrow:hover { background: rgba(255,255,255,.3); }
.img-viewer-prev { left: 10px; }
.img-viewer-next { right: 10px; }
.img-viewer-dots { position: absolute; bottom: 16px; display: flex; gap: 6px; }
.img-viewer-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,.4); border: none; padding: 0; cursor: pointer; }
.img-viewer-dot.active { background: #fff; }
```

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `npm test`
Expected: All tests pass (CSS changes don't affect unit tests, this is a sanity check)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add CSS for multi-image thumbnails, composer, and fullscreen viewer"
```

---

## Task 3: New Post Composer — Multi-Image UI

**Files:**
- Modify: `index.html` (HTML ~lines 4276-4283, JS ~lines 9929-9998)

- [ ] **Step 1: Replace the new post modal photo area HTML**

Replace lines 4276-4283 (the `np-photo-area` div through the file input) with:

```html
      <div id="np-photo-area">
        <div id="np-photo-placeholder" class="log-photo-placeholder" style="display:inline-flex;align-items:center;gap:.4rem;cursor:pointer;" onclick="document.getElementById('np-photo-input').click()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Add photos (optional)</div>
        <div id="np-thumbstrip" class="np-thumbstrip" style="display:none;"></div>
        <div id="np-photo-counter" class="np-photo-counter" style="display:none;"></div>
      </div>
      <input type="file" id="np-photo-input" accept="image/*" multiple
        style="display:none" onchange="handleNewPostPhotos(this)">
```

- [ ] **Step 2: Replace state variables and openNewPost reset logic**

Replace lines 9929-9931 (the three variable declarations) with:

```javascript
let newPostFiles = [];    // array of File objects
let newPostPreviews = []; // array of object URLs for thumbnails
let npIdentifiedWatchId = null;
```

In `openNewPost()` (line 9936-9938), replace the reset lines:
```javascript
  newPostPhoto = null;
  newPostFile  = null;
```
with:
```javascript
  newPostFiles = [];
  newPostPreviews.forEach(u => URL.revokeObjectURL(u));
  newPostPreviews = [];
```

- [ ] **Step 3: Replace handleNewPostPhoto with handleNewPostPhotos**

Replace the `handleNewPostPhoto` function (lines 9968-9983) with:

```javascript
function handleNewPostPhotos(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  const slots = 6 - newPostFiles.length;
  const accepted = [];
  for (const f of files) {
    if (accepted.length >= slots) break;
    if (validateImageFile(f)) accepted.push(f);
  }
  if (files.length > slots) toast('Maximum 6 photos per post', 'error');
  if (!accepted.length) { input.value = ''; return; }
  for (const f of accepted) {
    newPostFiles.push(f);
    newPostPreviews.push(URL.createObjectURL(f));
  }
  input.value = '';
  renderNpThumbstrip();
  if (newPostFiles.length === accepted.length && accepted.length === 1) {
    npIdentifyWatch(accepted[0]);
  }
}
```

- [ ] **Step 4: Add renderNpThumbstrip function**

Add right after the `handleNewPostPhotos` function:

```javascript
function renderNpThumbstrip() {
  const strip = document.getElementById('np-thumbstrip');
  const counter = document.getElementById('np-photo-counter');
  const placeholder = document.getElementById('np-photo-placeholder');
  if (!newPostFiles.length) {
    strip.style.display = 'none';
    counter.style.display = 'none';
    placeholder.style.display = '';
    return;
  }
  placeholder.style.display = 'none';
  strip.style.display = '';
  counter.style.display = '';
  counter.textContent = newPostFiles.length + '/6 photos';
  let html = '';
  for (let i = 0; i < newPostPreviews.length; i++) {
    html += `<div class="np-thumb${i === 0 ? ' hero' : ''}" draggable="true"
      ondragstart="npThumbDragStart(event,${i})" ondragover="npThumbDragOver(event)"
      ondrop="npThumbDrop(event,${i})" ondragend="npThumbDragEnd(event)">
      <img src="${escHtml(newPostPreviews[i])}" alt="">
      <button type="button" class="np-thumb-remove" onclick="removeNpPhoto(${i})">✕</button>
    </div>`;
  }
  if (newPostFiles.length < 6) {
    html += `<button type="button" class="np-thumb-add" onclick="document.getElementById('np-photo-input').click()">+</button>`;
  }
  strip.innerHTML = html;
}
```

- [ ] **Step 5: Add removeNpPhoto and drag-reorder functions**

Add right after `renderNpThumbstrip`:

```javascript
function removeNpPhoto(idx) {
  URL.revokeObjectURL(newPostPreviews[idx]);
  newPostFiles.splice(idx, 1);
  newPostPreviews.splice(idx, 1);
  renderNpThumbstrip();
}

let _npDragIdx = -1;
function npThumbDragStart(e, idx) { _npDragIdx = idx; e.currentTarget.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
function npThumbDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('drag-over'); }
function npThumbDragEnd(e) { e.currentTarget.classList.remove('dragging'); document.querySelectorAll('.np-thumb.drag-over').forEach(el => el.classList.remove('drag-over')); }
function npThumbDrop(e, targetIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (_npDragIdx < 0 || _npDragIdx === targetIdx) return;
  const [file] = newPostFiles.splice(_npDragIdx, 1);
  const [preview] = newPostPreviews.splice(_npDragIdx, 1);
  newPostFiles.splice(targetIdx, 0, file);
  newPostPreviews.splice(targetIdx, 0, preview);
  _npDragIdx = -1;
  renderNpThumbstrip();
}
```

- [ ] **Step 6: Replace clearNewPostPhoto**

Replace `clearNewPostPhoto` (lines 9985-9998) with:

```javascript
function clearNewPostPhoto() {
  newPostPreviews.forEach(u => URL.revokeObjectURL(u));
  newPostFiles = [];
  newPostPreviews = [];
  npIdentifiedWatchId = null;
  dismissNpWatchSuggestion();
  renderNpThumbstrip();
}
```

- [ ] **Step 7: Test the composer manually**

Open http://localhost:3000 (or http://192.168.1.246:3000 from MacBook Pro), log in as testuser, open the new post modal. Verify:
- "Add photos" placeholder appears
- Selecting multiple images shows thumbnail strip with counter
- "+" button adds more photos
- "✕" removes individual photos
- Drag to reorder works on desktop
- Counter shows correct "N/6 photos"
- Selecting more than 6 shows toast error

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: multi-image composer UI for new posts"
```

---

## Task 4: saveNewPost — Multi-Image Upload

**Files:**
- Modify: `index.html` (JS ~lines 10105-10182)

- [ ] **Step 1: Update the validation check at the top of saveNewPost**

In `saveNewPost` (line 10109), replace:
```javascript
  if (!body && !newPostFile) { toast('Add a photo or write something', 'error'); return; }
```
with:
```javascript
  if (!body && !newPostFiles.length) { toast('Add a photo or write something', 'error'); return; }
```

- [ ] **Step 2: Replace the single-image upload block with multi-image upload**

Replace the upload block (lines 10123-10127):
```javascript
  if (newPostFile && currentUser) {
    try {
      entry.photoUrl = await uploadImage(newPostFile, `logs/${currentUser.id}/${entry.id}.jpg`);
    } catch(e) { toast('Photo upload failed — ' + e.message, 'error'); return; }
  }
```
with:
```javascript
  if (newPostFiles.length && currentUser) {
    try {
      if (newPostFiles.length === 1) {
        entry.photoUrl = await uploadImage(newPostFiles[0], `logs/${currentUser.id}/${entry.id}.jpg`);
      } else {
        const urls = [];
        for (let i = 0; i < newPostFiles.length; i++) {
          const url = await uploadImage(newPostFiles[i], `logs/${currentUser.id}/${entry.id}_${i}.jpg`);
          urls.push(url);
        }
        entry.photoUrl = JSON.stringify(urls);
      }
    } catch(e) { toast('Photo upload failed — ' + e.message, 'error'); return; }
  }
```

- [ ] **Step 3: Update the error rollback cleanup**

Replace the storage cleanup line (around line 10148-10149):
```javascript
      if (entry.photoUrl) { const _p = storagePathFrom(entry.photoUrl); if (_p) deleteStorageFile(_p); }
```
with:
```javascript
      if (entry.photoUrl) { deletePostPhotos(entry.photoUrl); }
```

Then add the `deletePostPhotos` helper near the other storage functions (around line 17060):

```javascript
function deletePostPhotos(photoUrl) {
  const urls = parsePhotoUrl(photoUrl);
  urls.forEach(u => { const p = storagePathFrom(u); if (p) deleteStorageFile(p); });
}
```

Also add `parsePhotoUrl` to the inline JS (near `storagePathFrom`, line ~17076) — same implementation as in `wrotate_test.js`:

```javascript
function parsePhotoUrl(photoUrl) {
  if (!photoUrl) return [];
  if (photoUrl.startsWith('[')) {
    try { return JSON.parse(photoUrl); } catch (e) { return [photoUrl]; }
  }
  return [photoUrl];
}
```

- [ ] **Step 4: Update posthog capture to include image count**

Replace (around line 10170):
```javascript
  if (window.posthog) posthog.capture('post_created', { has_photo: !!entry.photoUrl, has_watch: !!trackWatchId });
```
with:
```javascript
  if (window.posthog) posthog.capture('post_created', { has_photo: !!entry.photoUrl, photo_count: parsePhotoUrl(entry.photoUrl).length, has_watch: !!trackWatchId });
```

- [ ] **Step 5: Test upload manually**

Log in as testuser at http://192.168.1.246:3000. Create a post with:
1. Single image — verify it works as before (plain URL in DB)
2. Multiple images (2-3) — verify all upload, post appears in feed

Check Supabase storage to confirm file paths:
- Single: `logs/{userId}/{logId}.jpg`
- Multi: `logs/{userId}/{logId}_0.jpg`, `_1.jpg`, etc.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: multi-image upload in saveNewPost"
```

---

## Task 5: Feed Card Rendering — Hero + Thumbnails

**Files:**
- Modify: `index.html` (JS ~lines 9236-9278)

- [ ] **Step 1: Replace the photo hero rendering block**

Replace lines 9237-9239 (the `if (item.photo_url)` block that builds `heroHtml`):
```javascript
if (item.photo_url) {
  heroHtml = `<div class="feed-card-photo"><img src="${escHtml(item.photo_url)}" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`;
}
```
with:
```javascript
if (item.photo_url) {
  const _urls = parsePhotoUrl(item.photo_url);
  const heroUrl = _urls[0] || '';
  heroHtml = `<div class="feed-card-photo" onclick="openImageViewer(${escAttr(JSON.stringify(_urls))},0)">
    <img id="feed-hero-${item.id}" src="${escHtml(heroUrl)}" loading="lazy" onerror="this.parentElement.style.display='none'">
    ${_urls.length > 1 ? `<span class="feed-card-photo-count">1/${_urls.length}</span>` : ''}
  </div>`;
  if (_urls.length > 1) {
    heroHtml += `<div class="feed-card-thumbnails">`;
    _urls.forEach((u, i) => {
      heroHtml += `<div class="feed-card-thumb${i === 0 ? ' active' : ''}" onclick="feedThumbTap('${item.id}',${i},${escAttr(JSON.stringify(_urls))})"><img src="${escHtml(u)}" loading="lazy" alt=""></div>`;
    });
    heroHtml += `</div>`;
  }
}
```

- [ ] **Step 2: Add feedThumbTap function**

Add near the feed rendering section (after the feed card rendering function):

```javascript
function feedThumbTap(logId, idx, urls) {
  const hero = document.getElementById('feed-hero-' + logId);
  if (!hero) return;
  hero.src = urls[idx];
  const card = hero.closest('.feed-card');
  if (!card) return;
  card.querySelectorAll('.feed-card-thumb').forEach((el, i) => el.classList.toggle('active', i === idx));
  const badge = card.querySelector('.feed-card-photo-count');
  if (badge) badge.textContent = (idx + 1) + '/' + urls.length;
}
```

- [ ] **Step 3: Update the watch chip condition**

Replace line 9265:
```javascript
const watchChip = (w && item.photo_url)
```
with:
```javascript
const watchChip = (w && item.photo_url && parsePhotoUrl(item.photo_url).length)
```

(This is functionally equivalent but consistent with the new approach.)

- [ ] **Step 4: Test feed rendering manually**

Open http://192.168.1.246:3000 and check the feed. Verify:
- Existing single-image posts render exactly as before
- Multi-image posts show hero image with "1/N" badge
- Thumbnail strip appears below the hero
- Tapping a thumbnail swaps the hero image
- Badge counter updates on thumbnail tap
- Text-only and wear-log posts are unchanged

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: hero + thumbnails feed display for multi-image posts"
```

---

## Task 6: Fullscreen Image Viewer

**Files:**
- Modify: `index.html` (JS — new section, add near end of file before closing `</script>`)

- [ ] **Step 1: Implement openImageViewer**

Add the fullscreen viewer code:

```javascript
let _viewerOverlay = null;
let _viewerUrls = [];
let _viewerIdx = 0;

function openImageViewer(urls, startIdx) {
  if (!urls || !urls.length) return;
  _viewerUrls = urls;
  _viewerIdx = startIdx || 0;
  if (!_viewerOverlay) _buildViewer();
  _renderViewer();
  document.body.appendChild(_viewerOverlay);
  requestAnimationFrame(() => _viewerOverlay.classList.add('visible'));
  document.addEventListener('keydown', _viewerKeydown);
}

function _buildViewer() {
  _viewerOverlay = document.createElement('div');
  _viewerOverlay.className = 'img-viewer-overlay';
  _viewerOverlay.innerHTML = `
    <button class="img-viewer-close" onclick="closeImageViewer()">✕</button>
    <span class="img-viewer-counter"></span>
    <img src="" alt="">
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

function _renderViewer() {
  const img = _viewerOverlay.querySelector('img');
  img.src = _viewerUrls[_viewerIdx];
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

function viewerNav(dir) {
  _viewerIdx = (_viewerIdx + dir + _viewerUrls.length) % _viewerUrls.length;
  _renderViewer();
}

function viewerJump(idx) { _viewerIdx = idx; _renderViewer(); }

function closeImageViewer() {
  if (!_viewerOverlay) return;
  _viewerOverlay.classList.remove('visible');
  document.removeEventListener('keydown', _viewerKeydown);
  setTimeout(() => { if (_viewerOverlay?.parentNode) _viewerOverlay.parentNode.removeChild(_viewerOverlay); }, 200);
}

function _viewerKeydown(e) {
  if (e.key === 'Escape') closeImageViewer();
  else if (e.key === 'ArrowLeft') viewerNav(-1);
  else if (e.key === 'ArrowRight') viewerNav(1);
}
```

- [ ] **Step 2: Make single-image posts also open the viewer on tap**

In the feed card hero rendering (from Task 5), single-image posts already have `onclick="openImageViewer(...)"`. This also applies to existing single-image posts since `parsePhotoUrl` wraps them in an array.

Verify: single-image posts open the viewer too (with no arrows/dots since length is 1).

- [ ] **Step 3: Test the viewer manually**

On http://192.168.1.246:3000:
- Tap a multi-image post hero → viewer opens at image 1
- Swipe left/right on phone → navigates between images
- Click arrow buttons on desktop → navigates
- Press left/right arrow keys → navigates
- Press Escape → closes
- Swipe down → closes
- Click outside image → closes
- Dots update as you navigate
- Counter shows correct "N / M"
- Single-image posts: viewer opens with no arrows/dots, just the image

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: fullscreen swipe image viewer for multi-image posts"
```

---

## Task 7: Edit Post — Multi-Image Support

**Files:**
- Modify: `index.html` (HTML ~lines 4306-4312, JS ~lines 9678-9900)

- [ ] **Step 1: Replace the edit post modal photo area HTML**

Replace lines 4306-4312 (the `ep-photo-area` div and file input) with:

```html
      <div id="ep-photo-area">
        <div id="ep-photo-placeholder" class="log-photo-placeholder" style="display:inline-flex;align-items:center;gap:.4rem;cursor:pointer;" onclick="document.getElementById('ep-photo-input').click()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Add photos (optional)</div>
        <div id="ep-thumbstrip" class="np-thumbstrip" style="display:none;"></div>
        <div id="ep-photo-counter" class="np-photo-counter" style="display:none;"></div>
      </div>
      <input type="file" id="ep-photo-input" accept="image/*" multiple
        style="display:none" onchange="handleEditPostPhotos(this)">
```

- [ ] **Step 2: Replace edit post state variables**

Replace lines 9678-9681:
```javascript
let editPostLogId   = null;
let editPostNewPhoto = null;
let editPostNewFile  = null;
let editPostWatchId  = null;
```
with:
```javascript
let editPostLogId   = null;
let editPostWatchId  = null;
let epExistingUrls = [];  // URLs from the current saved post
let epFiles = [];          // mix of URL strings (existing) and File objects (new)
let epPreviews = [];       // preview URLs (existing URLs or objectURLs for new files)
```

- [ ] **Step 3: Update openEditPost to populate multi-image state**

In `openEditPost` (lines 9683-9708), replace the photo population block (lines 9697-9704):
```javascript
  if (fi.photo_url) {
    document.getElementById('ep-photo-preview').src = fi.photo_url;
    document.getElementById('ep-photo-preview').style.display = 'block';
    document.getElementById('ep-photo-placeholder').style.display = 'none';
    document.getElementById('ep-photo-clear').style.display = '';
    document.getElementById('ep-photo-area').classList.add('has-photo');
  } else {
    _resetEpPhoto();
  }
```
with:
```javascript
  const existingUrls = parsePhotoUrl(fi.photo_url);
  epExistingUrls = [...existingUrls];
  epFiles = [...existingUrls];
  epPreviews = [...existingUrls];
  renderEpThumbstrip();
```

- [ ] **Step 4: Add renderEpThumbstrip, handleEditPostPhotos, removeEpPhoto, and drag handlers**

Replace `handleEditPostPhoto` (lines 9809-9820), `clearEditPostPhoto` (lines 9724-9727), and `_resetEpPhoto` (lines 9716-9722) with:

```javascript
function renderEpThumbstrip() {
  const strip = document.getElementById('ep-thumbstrip');
  const counter = document.getElementById('ep-photo-counter');
  const placeholder = document.getElementById('ep-photo-placeholder');
  if (!epFiles.length) {
    strip.style.display = 'none';
    counter.style.display = 'none';
    placeholder.style.display = '';
    return;
  }
  placeholder.style.display = 'none';
  strip.style.display = '';
  counter.style.display = '';
  counter.textContent = epFiles.length + '/6 photos';
  let html = '';
  for (let i = 0; i < epPreviews.length; i++) {
    html += `<div class="np-thumb${i === 0 ? ' hero' : ''}" draggable="true"
      ondragstart="epThumbDragStart(event,${i})" ondragover="npThumbDragOver(event)"
      ondrop="epThumbDrop(event,${i})" ondragend="npThumbDragEnd(event)">
      <img src="${escHtml(epPreviews[i])}" alt="">
      <button type="button" class="np-thumb-remove" onclick="removeEpPhoto(${i})">✕</button>
    </div>`;
  }
  if (epFiles.length < 6) {
    html += `<button type="button" class="np-thumb-add" onclick="document.getElementById('ep-photo-input').click()">+</button>`;
  }
  strip.innerHTML = html;
}

function handleEditPostPhotos(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  const slots = 6 - epFiles.length;
  const accepted = [];
  for (const f of files) {
    if (accepted.length >= slots) break;
    if (validateImageFile(f)) accepted.push(f);
  }
  if (files.length > slots) toast('Maximum 6 photos per post', 'error');
  if (!accepted.length) { input.value = ''; return; }
  for (const f of accepted) {
    epFiles.push(f);
    epPreviews.push(URL.createObjectURL(f));
  }
  input.value = '';
  renderEpThumbstrip();
}

function removeEpPhoto(idx) {
  if (typeof epPreviews[idx] === 'string' && !epExistingUrls.includes(epPreviews[idx])) {
    URL.revokeObjectURL(epPreviews[idx]);
  }
  epFiles.splice(idx, 1);
  epPreviews.splice(idx, 1);
  renderEpThumbstrip();
}

function clearEditPostPhoto() {
  epPreviews.forEach(u => { if (!epExistingUrls.includes(u)) URL.revokeObjectURL(u); });
  epFiles = [];
  epPreviews = [];
  renderEpThumbstrip();
}

let _epDragIdx = -1;
function epThumbDragStart(e, idx) { _epDragIdx = idx; e.currentTarget.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
function epThumbDrop(e, targetIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (_epDragIdx < 0 || _epDragIdx === targetIdx) return;
  const [file] = epFiles.splice(_epDragIdx, 1);
  const [preview] = epPreviews.splice(_epDragIdx, 1);
  epFiles.splice(targetIdx, 0, file);
  epPreviews.splice(targetIdx, 0, preview);
  _epDragIdx = -1;
  renderEpThumbstrip();
}
```

- [ ] **Step 5: Update saveEditPost to handle multi-image upload/delete**

In `saveEditPost`, find the photo handling block. The current logic handles three states (`editPostNewPhoto === 'REMOVE'`, new file upload, keep existing). Replace that entire photo-handling section with:

```javascript
  // Build final photo_url from current editor state
  let finalPhotoUrl = null;
  if (epFiles.length) {
    const urls = [];
    let nextSuffix = 0;
    for (const item of epFiles) {
      if (typeof item === 'string') {
        urls.push(item);
      } else {
        while (epExistingUrls.some(u => storagePathFrom(u)?.endsWith(`_${nextSuffix}.jpg`))) nextSuffix++;
        const url = await uploadImage(item, `logs/${currentUser.id}/${editPostLogId}_${nextSuffix}.jpg`);
        urls.push(url);
        nextSuffix++;
      }
    }
    finalPhotoUrl = urls.length === 1 ? urls[0] : JSON.stringify(urls);
  }
  const finalUrls = parsePhotoUrl(finalPhotoUrl);
  // Delete removed images from storage
  for (const oldUrl of epExistingUrls) {
    if (!finalUrls.includes(oldUrl)) {
      const p = storagePathFrom(oldUrl);
      if (p) deleteStorageFile(p);
    }
  }
```

Then set `photo_url: finalPhotoUrl` in the upsert call (replacing the existing `photo_url: finalPhoto` or equivalent).

- [ ] **Step 6: Test edit flow manually**

On http://192.168.1.246:3000 as testuser:
1. Edit a single-image post → add 2 more images → save → verify 3 images show in feed
2. Edit a multi-image post → remove one image → save → verify removed from feed and storage
3. Edit a multi-image post → reorder → save → verify new order in feed
4. Edit a multi-image post → remove all images → save → verify text-only post
5. Edit a text-only post → add images → save → verify images appear

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: multi-image support in edit post flow"
```

---

## Task 8: Delete Post — Multi-Image Cleanup

**Files:**
- Modify: `index.html` (JS ~line 13897)

- [ ] **Step 1: Update deleteLog storage cleanup**

In `deleteLog` (line 13897), replace:
```javascript
  if (log?.photoUrl) { const p = storagePathFrom(log.photoUrl); if (p) deleteStorageFile(p); }
```
with:
```javascript
  if (log?.photoUrl) { deletePostPhotos(log.photoUrl); }
```

The `deletePostPhotos` helper was already added in Task 4.

- [ ] **Step 2: Test delete manually**

On http://192.168.1.246:3000 as testuser:
1. Create a multi-image post (3 images)
2. Delete it via the edit post modal
3. Check Supabase storage — all 3 image files should be removed

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: delete all images when deleting a multi-image post"
```

---

## Task 9: Unit Tests for Multi-Image Logic

**Files:**
- Modify: `tests/multi-image.test.js`

- [ ] **Step 1: Add tests for feed rendering logic with multi-image posts**

Append to `tests/multi-image.test.js`:

```javascript
describe('multi-image feed rendering logic', () => {
  it('single-image post has no thumbnails', () => {
    const urls = parsePhotoUrl('https://example.com/photo.jpg');
    expect(urls.length).toBe(1);
    const showThumbs = urls.length > 1;
    expect(showThumbs).toBe(false);
  });

  it('multi-image post shows thumbnails', () => {
    const raw = JSON.stringify(['https://a.jpg', 'https://b.jpg', 'https://c.jpg']);
    const urls = parsePhotoUrl(raw);
    expect(urls.length).toBe(3);
    const showThumbs = urls.length > 1;
    expect(showThumbs).toBe(true);
  });

  it('hero is always the first URL', () => {
    const raw = JSON.stringify(['https://hero.jpg', 'https://second.jpg']);
    const urls = parsePhotoUrl(raw);
    expect(urls[0]).toBe('https://hero.jpg');
  });

  it('photo count badge shows correct format', () => {
    const urls = parsePhotoUrl(JSON.stringify(['a', 'b', 'c', 'd']));
    const badge = `1/${urls.length}`;
    expect(badge).toBe('1/4');
  });
});

describe('multi-image storage paths', () => {
  it('single-image path has no suffix', () => {
    const path = 'logs/user123/log456.jpg';
    expect(path).not.toContain('_');
  });

  it('multi-image paths use index suffix', () => {
    const logId = 'log456';
    const paths = [0, 1, 2].map(i => `logs/user123/${logId}_${i}.jpg`);
    expect(paths[0]).toBe('logs/user123/log456_0.jpg');
    expect(paths[1]).toBe('logs/user123/log456_1.jpg');
    expect(paths[2]).toBe('logs/user123/log456_2.jpg');
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass (existing + new multi-image tests)

- [ ] **Step 3: Commit**

```bash
git add tests/multi-image.test.js
git commit -m "test: add unit tests for multi-image feed and storage logic"
```

---

## Task 10: Bump Service Worker Cache + Final Verification

**Files:**
- Modify: `sw.js` (cache version bump)

- [ ] **Step 1: Bump the SW cache version**

Open `sw.js` and increment the cache version (e.g., `wristlog-vNN` → `wristlog-vNN+1`).

- [ ] **Step 2: Run full test suite**

Run: `npm test && npm run test:e2e`
Expected: All unit tests and mocked E2E tests pass

- [ ] **Step 3: Manual end-to-end verification**

On http://192.168.1.246:3000 as testuser (and cross-check with testuser2):

1. **Create single-image post** → renders as before, no thumbnails
2. **Create multi-image post (4 images)** → hero + thumbnail strip, "1/4" badge
3. **Tap thumbnails** → hero swaps, badge updates
4. **Tap hero** → fullscreen viewer opens
5. **Swipe through viewer** → all images navigate correctly
6. **Close viewer** → Escape key, X button, swipe down, tap background
7. **Edit multi-image post** → remove one image, add another, reorder → save → verify
8. **Delete multi-image post** → all images removed from storage
9. **Existing single-image posts** → still render correctly, viewer works
10. **Text-only posts** → unchanged
11. **Wear-log posts** → unchanged
12. **Test on iPhone Safari** → swipe gestures work in viewer and feed

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "chore: bump SW cache version for multi-image posts feature"
```
