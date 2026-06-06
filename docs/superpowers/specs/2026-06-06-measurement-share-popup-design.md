# Measurement "Share to feed?" Popup — Design

**Date:** 2026-06-06
**Status:** Approved (pending spec review)

## Problem

When a user completes a successful timegrapher measurement, there is a "Share"
button, but almost nobody uses it. The button is not prominent, and the share
path always routes through the full New Post composer ("edit post mode"), which
adds friction. We want to drive more measurement posts to the feed.

## Goal

After a *good-quality* measurement, proactively prompt the user with a popup
asking whether they want to share the result. If they tap **Share to feed**, the
measurement is posted **directly to the feed** (public), bypassing the composer
entirely — one tap, no editing.

## Decisions (settled during brainstorming)

| Topic | Decision |
|-------|----------|
| **Visibility** | Direct post is **public**. Popup wording makes clear it goes "to the feed". |
| **Trigger** | Auto-popup, **only on good-quality (converged) results**. |
| **Frequency** | At most **once per watch**. Once a watch has been prompted (Share or Not now), never prompt again for that watch. Tracked in `localStorage`. |
| **Post content** | Auto-caption (`Measured my [watch]: [rate] s/d.`) **+ the accuracy card image** — same as the composer default today. |
| **Popup actions** | **Share to feed** (primary) and **Not now** (ghost). No "Edit" option. |
| **Implementation** | Approach A — drive the existing composer headlessly (reuse `saveNewPost()`). |
| **Existing buttons** | Keep the existing manual Share buttons unchanged. The popup is additive. |
| **Save to history** | Popup's Share also persists the reading to `timegrapher_results` first (so the user gets a matching entry in their own history), mirroring the existing "Share at completion" button. |

## Flow

```
Measurement stops (stopMsrListen) ──> converged (good quality)
                                        & watch not yet prompted?
        │ yes
        ▼
   Show "Share to feed?" popup        ──> mark watch as prompted (localStorage)
        │                                  log post_cta_event 'shown'
   ┌────┴─────┐
[Share to feed]   [Not now]
   │                 └─> close popup; do nothing (manual Save still available)
   ▼
persistMsrReading()  (save to timegrapher_results)
   │ ok          │ fail → toast shown by persistMsrReading, stop
   ▼
build accuracy card → openNewPost({..., headless:true})
                    → force vis = public → saveNewPost()
   │
   ▼
"Posted!" toast + haptic (saveNewPost's own feedback); feed cache invalidated
```

## Components & Changes (all in `index.html`)

### 1. Quality / trigger hook — `stopMsrListen()` (~line 23588)

When listening stops with a valid rate (`_msrLastRate != null`), the save section
is revealed and the completion message is set. "Good quality" = the **CONVERGED**
badge was showing (`wasConverged`, line 23600) — the same signal that produces the
"Measurement complete" message vs. the "retry recommended" messages.

After that block, add:

```js
if (wasConverged && _msrLastRate != null) {
  const watchId = document.getElementById('msr-watch-select')?.value;
  if (watchId && !msrSharePromptSeen(watchId)) {
    markMsrSharePromptSeen(watchId);
    showMsrSharePopup(watchId, _msrLastRate);
  }
}
```

Note: `wasConverged` is currently computed inside the `if (completeMsg)` block.
Lift it so it is in scope for the trigger check (compute once, reuse).

### 2. Per-watch "already prompted" tracking (localStorage)

```js
const STORE_MSR_SHARE_PROMPTED = 'wr_msr_share_prompted'; // JSON array of watch IDs

function msrSharePromptSeen(watchId) {
  try {
    const arr = JSON.parse(localStorage.getItem(STORE_MSR_SHARE_PROMPTED) || '[]');
    return Array.isArray(arr) && arr.includes(watchId);
  } catch (_) { return false; }
}

function markMsrSharePromptSeen(watchId) {
  try {
    const arr = JSON.parse(localStorage.getItem(STORE_MSR_SHARE_PROMPTED) || '[]');
    const set = new Set(Array.isArray(arr) ? arr : []);
    set.add(watchId);
    localStorage.setItem(STORE_MSR_SHARE_PROMPTED, JSON.stringify([...set]));
  } catch (_) { /* storage unavailable — popup may reappear next session, acceptable */ }
}
```

Device-local. If the user switches devices the popup may appear once more per
watch on the new device — accepted simplification (no server-side persistence).

### 3. The popup UI

A centered modal overlay shown over the measure modal. Follows existing inline
toast/modal styling (no browser `confirm()` — per CLAUDE.md code style).

- **Headline:** "Share to feed?"
- **Sub-line:** e.g. "Your **[watch]** measured **+2.3 s/d**. Share it to the feed?"
  (rate formatted with sign, one decimal, " s/d", matching existing share caption).
- **Buttons:** **Share to feed** (primary) → `confirmMsrSharePopup()`;
  **Not now** (ghost) → `dismissMsrSharePopup()`.

```js
function showMsrSharePopup(watchId, rate) {
  // populate headline/sub-line from watch + rate, wire buttons to watchId/rate,
  // reveal the popup element
  _logPostCtaEvent('shown', 'measurement_auto');
}

function dismissMsrSharePopup() {
  // hide popup only; leave measure modal + save section as-is so manual Save works
}

async function confirmMsrSharePopup(watchId, rate) {
  // hide popup, then persist + direct-post
  const res = await persistMsrReading();
  if (!res.ok) return; // toast shown by persistMsrReading
  shareMsrToFeed(res.watchId, res.rate, { direct: true });
}
```

`'measurement_auto'` is a distinct `post_cta_events` source so the auto-popup
funnel can be analyzed separately from the existing manual CTA (`'measurement'`).

### 4. Headless direct post

**`openNewPost(opts)`** (line 10401): add an `o.headless` option. When true,
skip un-hiding the modal and skip the focus `setTimeout` — everything else (state
setup, prefill body, prefill files, watch, vis chips) runs identically.

```js
if (!o.headless) {
  document.getElementById('new-post-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('np-body').focus(), 50);
}
```

**`shareMsrToFeed(watchId, rate, opts)`** (line 23703): add an `opts.direct`
flag. The card-building stays identical. In the `open(files)` callback:

```js
const open = (files) => {
  closeMeasureModal();
  if (opts && opts.direct) {
    openNewPost({ prefillBody, watchId, source: 'measurement', prefillFiles: files, headless: true });
    document.getElementById('np-vis-chips').innerHTML = visChipsHtml('np-vis-chips', 'public');
    saveNewPost();
  } else {
    openNewPost({ prefillBody, watchId, source: 'measurement', prefillFiles: files });
  }
};
```

`saveNewPost()` ([index.html:10746](../../../index.html)) then handles everything
already-tested: photo upload to `logs/<user>/<id>_accuracy.jpg`, insert into
`logs` (`use_case: 'measurement'`, `visibility: 'public'`), local cache update,
mention notifications, `closeNewPost()` (re-hides the already-hidden modal),
PostHog `post_created`, "Posted!" toast + success haptic, review prompt, badges,
feed re-fetch. `_npBtn` (the composer's primary button) exists in the DOM even
while hidden, so its disable/relabel logic is harmless.

## Error handling

- **Reading save fails** → `persistMsrReading()` shows its own error toast; we
  stop before posting. No feed post, no popup state corruption.
- **Card render fails** → existing `shareMsrToFeed` fallback posts text-only
  (caption only). Acceptable.
- **Upload / insert fails** → `saveNewPost()` already rolls back local state,
  cleans up orphaned storage, and toasts the error.
- **localStorage blocked** (private mode) → `markMsrSharePromptSeen` no-ops; the
  popup may reappear in a later session. Acceptable.

## Out of scope

- Removing/redesigning the existing manual Share buttons or post-save CTA.
- Server-side (cross-device) tracking of which watches were prompted.
- Changing default visibility for the manual composer path.

## Testing

- **Unit:** `msrSharePromptSeen` / `markMsrSharePromptSeen` (add, dedupe, blocked
  storage, malformed JSON). Caption/rate formatting reused from existing helpers.
- **E2E (mocked):** measurement converges → popup shows; "Not now" hides popup &
  leaves Save usable; "Share to feed" → public post inserted into `logs` with the
  accuracy card and `use_case: 'measurement'`, composer never visibly opens;
  popup does NOT reappear for the same watch on a second measurement.
- **UAT:** This feature posts **public** by design, but the project rule is that
  test accounts must NEVER post publicly. So verify the public payload via the
  **mocked E2E** path (assert the intercepted `logs` insert has
  `visibility: 'public'`, the accuracy card, and `use_case: 'measurement'`) rather
  than producing a real public post from a test account. Reserve any real
  public-post check for the owner's own account, and delete the post afterward.
- Run `npm test && npm run test:e2e` before commit; bump `sw.js` cache version.
```
