// ═══════════════════════════════════════════════════════════════════════════
// AF1 (Add Flow V1) — Photo Identify — ARCHIVED 2026-04-22
// Replaced by AF2 (Add Flow V2). Kept for reference/rollback.
// ═══════════════════════════════════════════════════════════════════════════

// ── CSS ──
    /* ── Photo Identify ── */
    .pi-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:.9rem 1rem; margin-bottom:.6rem; display:flex; gap:.85rem; align-items:center; }
    .pi-card-avatar { width:44px; height:44px; border-radius:8px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:.7rem; font-weight:700; color:#fff; }
    .pi-card-info { flex:1; min-width:0; }
    .pi-card-name { font-size:.88rem; font-weight:600; }
    .pi-card-brand { font-size:.76rem; color:var(--muted); margin-top:.1rem; }
    .pi-card-ref { font-size:.72rem; color:var(--muted); margin-top:.1rem; }
    .pi-card-conf { font-size:.65rem; text-transform:uppercase; letter-spacing:.05em; font-weight:600; padding:.12rem .4rem; border-radius:4px; }
    .pi-card-conf.high { color:#4ade80; background:rgba(74,222,128,.1); }
    .pi-card-conf.medium { color:#fbbf24; background:rgba(251,191,36,.1); }
    .pi-card-conf.low { color:#f87171; background:rgba(248,113,113,.1); }
    .pi-card-actions { display:flex; gap:.4rem; flex-shrink:0; }
    .pi-img-status { margin-top:.3rem; display:flex; align-items:center; gap:.3rem; }
    .pi-img-loading { font-size:.68rem; color:var(--muted); display:inline-flex; align-items:center; gap:.25rem; }
    .pi-img-thumb { width:32px; height:32px; object-fit:cover; border-radius:4px; flex-shrink:0; }
    .pi-img-found { font-size:.68rem; color:#4ade80; font-weight:500; }
    .pi-img-notfound { font-size:.68rem; color:var(--muted); }
    .pi-img-thumb { cursor:pointer; }

    /* Crop adjuster overlay */
    .crop-adjuster { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,.92); display:flex; flex-direction:column; }
    .crop-adjuster-header { display:flex; justify-content:space-between; align-items:center; padding:.8rem 1rem; padding-top:max(.8rem, env(safe-area-inset-top, .8rem)); flex-shrink:0; }
    .crop-adjuster-header button { background:none; border:none; color:#fff; font-size:.88rem; padding:.4rem .8rem; cursor:pointer; border-radius:6px; }
    .crop-adjuster-header .crop-done { background:var(--gold); color:#000; font-weight:600; }
    .crop-viewport { flex:1; overflow:hidden; position:relative; touch-action:none; }
    .crop-viewport img { position:absolute; user-select:none; -webkit-user-drag:none; pointer-events:none; }
    .crop-guide { position:absolute; inset:0; pointer-events:none; }
    .crop-guide-border { position:absolute; border:2px solid rgba(255,255,255,.5); border-radius:8px; box-shadow:0 0 0 9999px rgba(0,0,0,.5); }
    .pi-loading { text-align:center; padding:2rem 1rem; color:var(--muted); }
    .pi-loading-spinner { display:inline-block; width:28px; height:28px; border:2.5px solid var(--border); border-top-color:var(--gold); border-radius:50%; animation:spin .7s linear infinite; margin-bottom:.7rem; }

// ── HTML (photo-identify-modal) ──
<!-- ════ PHOTO IDENTIFY MODAL ════ -->
<div id="photo-identify-modal" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="photo-identify-modal-title">
  <div class="modal" style="max-width:480px;">
    <div class="modal-title" id="photo-identify-modal-title" style="display:flex;align-items:center;gap:.5rem;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Identified Watches
    </div>
    <div id="photo-identify-list" style="max-height:60vh;overflow-y:auto;"></div>
    <div id="photo-identify-actions" class="modal-actions" style="margin-top:1rem;">
      <button class="btn btn-ghost" onclick="closePhotoIdentify()">Skip for now</button>
    </div>
  </div>
</div>

// ── JavaScript ──
let _photoIdentifyResults = []; // cached results for the modal
function openPhotoIdentify() {
  if (demoGuard()) return;
  if (!currentUser) { toast('Sign in to use photo identification', 'error'); return; }
  if (featureFlag('add_flow_v2')) { openAddFlowV2(); return; }
  window._identifyAborted = false;
  _photoAddedWatchIds = [];
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.position = 'absolute';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  input.addEventListener('cancel', () => { input.remove(); resumeWelcome(); });
  input.onchange = async () => {
    input.remove();
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    if (!validateImageFile(file)) return;

    const modal = document.getElementById('photo-identify-modal');
    const list = document.getElementById('photo-identify-list');
    list.innerHTML = `<div class="pi-loading"><div class="pi-loading-spinner"></div><div style="font-size:.85rem;">Detecting watches\u2026</div><div style="font-size:.75rem;margin-top:.3rem;">Scanning your photo</div></div>`;
    modal.classList.remove('hidden');
    modal.dataset.justOpened = '1';
    setTimeout(() => delete modal.dataset.justOpened, 600);

    try {
      const base64 = await blobToResizedBase64ForIdentify(file);
      window._photoIdentifyBase64 = base64;
      try { window._photoIdentifyBlob = await blobToResizedBlob(file); } catch (_) { window._photoIdentifyBlob = file; }

      // Step 1: Detect how many watches are in the photo (~4s)
      list.innerHTML = `<div class="pi-loading"><div class="pi-loading-spinner"></div><div class="pi-status-msg" style="font-size:.85rem;">Scanning your photo\u2026</div><div class="pi-status-sub" style="font-size:.75rem;margin-top:.3rem;color:var(--muted);">Detecting watches</div></div>`;
      const detectResp = await authedFetch(`${SUPABASE_URL}/functions/v1/identify-watch`, {
        method: 'POST',
        body: JSON.stringify({ image: base64, mode: 'detect' }),
      }, 30000);
      if (!detectResp.ok) throw new Error('Watch detection failed');
      const detectData = await detectResp.json();
      const watchCount = detectData.count || detectData.watches?.length || 0;

      if (watchCount === 0) {
        list.innerHTML = `<div class="pi-loading"><div style="font-size:.85rem;">No watches identified</div><div style="font-size:.75rem;color:var(--muted);margin-top:.5rem;text-align:left;max-width:260px;line-height:1.5;">Tips for better results:<br>\u2022 Use a close-up of the watch dial<br>\u2022 Make sure the brand name is readable<br>\u2022 Avoid heavy shadows or glare<br>\u2022 Try a photo from directly above</div><button onclick="closePhotoIdentify();openPhotoIdentify()" style="margin-top:.75rem;padding:.45rem 1rem;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:.82rem;cursor:pointer;">Try another photo</button></div>`;
        return;
      }

      // Step 2: Single watch → identify with status messages; multiple → progressive one-by-one
      if (watchCount === 1) {
        list.innerHTML = `<div class="pi-loading"><div class="pi-loading-spinner"></div><div class="pi-status-msg" style="font-size:.85rem;">Identifying watch\u2026</div><div class="pi-status-sub" style="font-size:.75rem;margin-top:.3rem;color:var(--muted);">Analyzing your photo</div></div>`;
        const _piMsgs = [
          ['Reading dial text\u2026', 'Looking for brand and model clues'],
          ['Searching watch databases\u2026', 'Cross-referencing with manufacturers'],
          ['Verifying reference number\u2026', 'Checking specs and year range'],
          ['Looking up specifications\u2026', 'Case size, movement, materials'],
          ['Almost there\u2026', 'Finalizing identification'],
        ];
        let _piMsgIdx = 0;
        const _piMsgTimer = setInterval(() => {
          if (_piMsgIdx < _piMsgs.length) {
            const msg = _piMsgs[_piMsgIdx++];
            const el = list.querySelector('.pi-status-msg');
            const sub = list.querySelector('.pi-status-sub');
            if (el) el.textContent = msg[0];
            if (sub) sub.textContent = msg[1];
          }
        }, 6000);
        try {
          const resp = await authedFetch(`${SUPABASE_URL}/functions/v1/identify-watch`, {
            method: 'POST',
            body: JSON.stringify({ image: base64, mode: 'identify' }),
          }, 120000);
          clearInterval(_piMsgTimer);
          if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'Identification failed'); }
          const data = await resp.json();
          if (!data.watches || data.watches.length === 0) {
            list.innerHTML = `<div class="pi-loading"><div style="font-size:.85rem;">No watches identified</div><div style="font-size:.75rem;color:var(--muted);margin-top:.5rem;text-align:left;max-width:260px;line-height:1.5;">Tips for better results:<br>\u2022 Use a close-up of the watch dial<br>\u2022 Make sure the brand name is readable<br>\u2022 Avoid heavy shadows or glare<br>\u2022 Try a photo from directly above</div><button onclick="closePhotoIdentify();openPhotoIdentify()" style="margin-top:.75rem;padding:.45rem 1rem;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:.82rem;cursor:pointer;">Try another photo</button></div>`;
            return;
          }
          _photoIdentifyResults = data.watches;
          console.log('[WristLog] identify result', {engine: data._engine, watches: data.watches.map(w => ({brand: w.brand, model: w.model, bbox: w.boundingBox}))});
          renderPhotoIdentifyResults();
        } catch (e1) { clearInterval(_piMsgTimer); throw e1; }
      } else {
        await _identifyMultipleWatches(detectData, base64, list);
      }
    } catch (e) {
      clearInterval(_piMsgTimer);
      console.error('[WristLog] Photo identify error:', e);
      list.innerHTML = `<div class="pi-loading"><div style="font-size:.85rem;color:var(--danger);">Identification failed</div><div style="font-size:.75rem;color:var(--muted);margin-top:.3rem;">${escHtml(e.message || 'Unknown error')}</div></div>`;
    }
  };
  input.click();
}

async function _identifyMultipleWatches(detectData, fullBase64, listEl) {
  const count = detectData.count || detectData.watches?.length || 0;
  const blob = window._photoIdentifyBlob;

  // Use AI bounding boxes from detect, fall back to grid
  const boxes = (detectData.watches || []).map(w => w.boundingBox).filter(b => b && b.length === 4);
  const useAIBoxes = boxes.length === count;
  const gridBoxes = [];
  if (!useAIBoxes) {
    const rows = detectData.rows || count;
    const cols = detectData.cols || 1;
    const cellW = 100 / cols;
    const cellH = 100 / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (gridBoxes.length >= count) break;
        gridBoxes.push([c * cellW, r * cellH, cellW, cellH]);
      }
    }
  }

  _photoIdentifyResults = (useAIBoxes ? boxes : gridBoxes).map((bbox, i) => ({
    boundingBox: bbox,
    brand: null, model: null, reference: '', dialText: '',
    estimatedColor: '#94a3b8', confidence: null, productUrl: '',
    _pending: true, _position: i,
  }));

  // Crop all watches using grid strips and show thumbnails immediately
  for (let i = 0; i < count; i++) {
    const w = _photoIdentifyResults[i];
    try {
      const cropped = await cropWatchFromPhoto(blob, w.boundingBox, 0.05);
      w._prefetchedCroppedBlob = cropped;
      w._prefetchedImageUrl = URL.createObjectURL(cropped);
      w._imageFound = true;
      w._imageSource = 'cropped';
      w._imageSearched = true;
    } catch (err) { console.error('[WristLog] Crop failed for watch', i, err); }
  }

  // Render cards with cropped thumbnails but no brand/model yet
  listEl.innerHTML = _photoIdentifyResults.map((w, i) => {
    const hasImg = w._imageFound && w._prefetchedImageUrl;
    const avatarStyle = hasImg
      ? `background-image:url(${w._prefetchedImageUrl});background-size:cover;background-position:center;`
      : 'background:#94a3b8';
    return `<div class="pi-card" data-pi-idx="${i}">
      <div class="pi-card-avatar" style="${avatarStyle}">${hasImg ? '' : '?'}</div>
      <div class="pi-card-info">
        <div class="pi-card-name" style="color:var(--muted);font-style:italic;">Watch ${i + 1}</div>
        <div class="pi-card-brand pi-status" style="font-size:.72rem;color:var(--muted);">Waiting\u2026</div>
      </div>
      <div class="pi-card-actions"></div>
    </div>`;
  }).join('');

  // Sequentially identify each watch from its crop
  for (let i = 0; i < count; i++) {
    if (window._identifyAborted) break;
    const w = _photoIdentifyResults[i];
    if (!w) continue;

    // Update status to "Identifying..."
    const card = document.querySelector(`.pi-card[data-pi-idx="${i}"]`);
    const statusEl = card?.querySelector('.pi-status');
    if (statusEl) statusEl.innerHTML = `<span class="pi-loading-spinner" style="display:inline-block;width:12px;height:12px;border-width:1.5px;margin-right:.4rem;vertical-align:middle;"></span>Identifying ${i + 1} of ${count}\u2026`;

    try {
      // Convert cropped blob to base64 and send to Opus
      const cropBase64 = w._prefetchedCroppedBlob
        ? await blobToResizedBase64ForIdentify(w._prefetchedCroppedBlob)
        : fullBase64;

      const resp = await authedFetch(`${SUPABASE_URL}/functions/v1/identify-watch`, {
        method: 'POST',
        body: JSON.stringify({ image: cropBase64, mode: 'identify' }),
      }, 90000);

      if (window._identifyAborted) break;

      if (resp.ok) {
        const data = await resp.json();
        const id = data.watches?.[0];
        if (id) {
          w.brand = id.brand || 'Unknown';
          w.model = id.model || 'Unknown';
          w.reference = id.reference || '';
          w.dialText = id.dialText || '';
          w.estimatedColor = id.estimatedColor || '#94a3b8';
          w.confidence = id.confidence || 'medium';
          w.productUrl = id.productUrl || '';
          w.yearRange = id.yearRange || '';
          w.movementType = id.movementType || '';
          w.caliber = id.caliber || '';
          w.caseMaterial = id.caseMaterial || '';
          w.caseDiameter = id.caseDiameter || '';
        } else {
          w.brand = 'Unknown'; w.model = 'Unknown'; w.confidence = 'low';
        }
      } else {
        w.brand = 'Unknown'; w.model = 'Identification failed'; w.confidence = 'low';
      }
    } catch (err) {
      console.error('[WristLog] Identify failed for watch', i, err);
      w.brand = 'Unknown'; w.model = 'Identification failed'; w.confidence = 'low';
    }

    w._pending = false;

    // Update the card in-place with results
    if (card) {
      const nameEl = card.querySelector('.pi-card-name');
      if (nameEl) { nameEl.textContent = w.model || 'Unknown'; nameEl.style.color = ''; nameEl.style.fontStyle = ''; }
      const brandEl = card.querySelector('.pi-status');
      if (brandEl) { brandEl.textContent = w.brand || 'Unknown'; brandEl.style.color = ''; brandEl.className = 'pi-card-brand'; }
      if (w.reference) {
        const refEl = document.createElement('div');
        refEl.className = 'pi-card-ref';
        refEl.textContent = `Ref. ${w.reference}`;
        card.querySelector('.pi-card-info')?.appendChild(refEl);
      }
      const specs = [w.caseDiameter, w.caseMaterial, w.movementType].filter(Boolean).join(' \u00b7 ');
      if (specs) {
        const specEl = document.createElement('div');
        specEl.className = 'pi-card-ref';
        specEl.style.cssText = 'color:var(--muted);font-size:.68rem;';
        specEl.textContent = specs;
        card.querySelector('.pi-card-info')?.appendChild(specEl);
      }
      if (w.yearRange) {
        const yrEl = document.createElement('div');
        yrEl.className = 'pi-card-ref';
        yrEl.style.cssText = 'color:var(--muted);font-size:.68rem;';
        yrEl.textContent = `Years: ${w.yearRange}`;
        card.querySelector('.pi-card-info')?.appendChild(yrEl);
      }
      const actionsEl = card.querySelector('.pi-card-actions');
      if (actionsEl) actionsEl.innerHTML = `<button class="btn btn-ghost" style="font-size:.72rem;padding:.3rem .55rem;" onclick="addFromIdentified(${i})" title="Review before adding">Edit</button><button class="btn btn-primary" style="font-size:.78rem;padding:.35rem .7rem;" onclick="quickAddFromIdentified(${i})">Add</button>`;
    }
  }
  // Add "Add All" button after all watches identified
  if (_photoIdentifyResults.length > 1 && !window._identifyAborted) {
    listEl.insertAdjacentHTML('beforeend', `<div style="display:flex;justify-content:flex-end;margin-top:.5rem;"><button class="btn btn-primary" style="font-size:.78rem;padding:.35rem .9rem;" onclick="addAllFromIdentified()">Add All</button></div>`);
  }
}

function renderPhotoIdentifyResults() {
  const list = document.getElementById('photo-identify-list');
  if (!_photoIdentifyResults.length) {
    list.innerHTML = '<div class="pi-loading"><div style="font-size:.85rem;">No watches found</div></div>';
    return;
  }
  list.innerHTML = _photoIdentifyResults.map((w, i) => {
    const color = w.estimatedColor || '#c9a84c';
    const ini = initials(w.brand || '?', w.model || '?');
    const specs = [w.caseDiameter, w.caseMaterial, w.movementType].filter(Boolean).join(' · ');
    return `<div class="pi-card" data-pi-idx="${i}">
      <div class="pi-card-avatar" style="background:${escHtml(color)}">${ini}</div>
      <div class="pi-card-info">
        <div class="pi-card-name">${escHtml(w.model || 'Unknown')}</div>
        <div class="pi-card-brand">${escHtml(w.brand || 'Unknown')}</div>
        ${w.reference ? `<div class="pi-card-ref">Ref. ${escHtml(w.reference)}</div>` : ''}
        ${specs ? `<div class="pi-card-ref" style="color:var(--muted);font-size:.68rem;">${escHtml(specs)}</div>` : ''}
        ${w.yearRange ? `<div class="pi-card-ref" style="color:var(--muted);font-size:.68rem;">Years: ${escHtml(w.yearRange)}</div>` : ''}
      </div>
      <div class="pi-card-actions">
        <button class="btn btn-ghost" style="font-size:.72rem;padding:.3rem .55rem;" onclick="addFromIdentified(${i})" title="Review before adding">Edit</button>
        <button class="btn btn-primary" style="font-size:.78rem;padding:.35rem .7rem;" onclick="quickAddFromIdentified(${i})">Add</button>
      </div>
    </div>`;
  }).join('');
  if (_photoIdentifyResults.length > 1) {
    list.insertAdjacentHTML('beforeend', `<div style="display:flex;justify-content:flex-end;margin-top:.5rem;"><button class="btn btn-primary" style="font-size:.78rem;padding:.35rem .9rem;" onclick="addAllFromIdentified()">Add All</button></div>`);
  }
  _photoIdentifyResults.forEach((w, i) => { if (w._imageSearched) updateIdentifyCard(i); });
  prefetchIdentifiedImages();
}

function updateIdentifyCard(idx) {
  const card = document.querySelector(`.pi-card[data-pi-idx="${idx}"]`);
  if (!card) return;
  const w = _photoIdentifyResults[idx];
  if (!w) return;

  // Remove old status element
  card.querySelector('.pi-img-status')?.remove();

  // Swap avatar with photo when available
  const avatar = card.querySelector('.pi-card-avatar');
  if (avatar && w._imageFound && w._prefetchedImageUrl) {
    avatar.style.backgroundImage = `url(${w._prefetchedImageUrl})`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
    avatar.textContent = '';
    if (w._imageSource === 'cropped') {
      avatar.style.cursor = 'pointer';
      avatar.onclick = () => openCropAdjuster(idx);
      avatar.title = 'Tap to adjust crop';
    }
  }

  const statusEl = document.createElement('div');
  statusEl.className = 'pi-img-status';

  if (w._imageLoading) {
    statusEl.innerHTML = '<span class="pi-img-loading">⟳ Cropping photo…</span>';
  } else if (!w._imageFound && w._imageSearched) {
    statusEl.innerHTML = '<span class="pi-img-notfound">No photo found</span>';
  }

  const infoEl = card.querySelector('.pi-card-info');
  if (infoEl) infoEl.appendChild(statusEl);
}

async function prefetchIdentifiedImages() {
  const promises = _photoIdentifyResults.map(async (w, i) => {
    if (w._imageSearched) return;
    w._imageSearched = true;
    w._imageLoading = true;
    updateIdentifyCard(i);

    if (!w._imageFound && window._photoIdentifyBlob) {
      const hasBbox = w.boundingBox && Array.isArray(w.boundingBox) && w.boundingBox.length === 4;
      const bbox = hasBbox ? w.boundingBox : [0, 0, 100, 100];
      console.log('[WristLog] prefetch crop attempt', i, {bbox, hasBbox, rawBbox: w.boundingBox, blobSize: window._photoIdentifyBlob.size});
      try {
        const cropped = await cropWatchFromPhoto(window._photoIdentifyBlob, bbox);
        w._prefetchedCroppedBlob = cropped;
        w._prefetchedImageUrl = URL.createObjectURL(cropped);
        w._imageFound = true;
        w._imageSource = 'cropped';
      } catch (cropErr) {
        console.error('[WristLog] crop failed', i, {bbox, error: cropErr.message, blobSize: window._photoIdentifyBlob.size, blobType: window._photoIdentifyBlob.type});
        try {
          w._prefetchedCroppedBlob = window._photoIdentifyBlob;
          w._prefetchedImageUrl = URL.createObjectURL(window._photoIdentifyBlob);
          w._imageFound = true;
          w._imageSource = 'cropped';
        } catch (_) {}
      }
    } else if (!w._imageFound) {
      console.warn('[WristLog] prefetch skip', i, {imageFound: w._imageFound, hasBlob: !!window._photoIdentifyBlob});
    }
    if (!w._imageFound) w._imageFound = false;

    w._imageLoading = false;
    updateIdentifyCard(i);
  });

  await Promise.allSettled(promises);
}

async function addFromIdentified(idx) {
  try {
    const w = _photoIdentifyResults[idx];
    if (!w) return;

    // Flag so saveWatch knows to return to identify modal
    window._addingFromIdentify = true;

    // Close identify modal (but keep blob for crop)
    closePhotoIdentify();

    // Open the add watch form
    openAddWatch();

    // Pre-fill fields from Claude's identification
    const aiBrand = w.brand || '';
    const aiModel = w.model || '';
    const aiRef   = w.reference || '';
    if (aiBrand) {
      ensureBrand(aiBrand);
      buildBrandSelect(aiBrand);
      document.getElementById('w-brand').value = aiBrand;
      document.getElementById('w-brand-display').value = aiBrand;
      autoSizeInput(document.getElementById('w-brand-display'));
    }
    if (aiModel) document.getElementById('w-name').value = aiModel;
    if (aiRef)   document.getElementById('w-ref').value = aiRef;
    const aiMovement = w.caliber || w.movementType || '';
    if (aiMovement) document.getElementById('w-caliber').value = aiMovement;
    if (w.estimatedColor) {
      selColor = w.estimatedColor;
      buildSwatches();
    }

    // Use cropped image from user's photo
    if (w._imageFound && w._prefetchedCroppedBlob) {
      if (w._prefetchedImageUrl) URL.revokeObjectURL(w._prefetchedImageUrl);
      wPendingFile  = w._prefetchedCroppedBlob;
      wPendingImage = URL.createObjectURL(w._prefetchedCroppedBlob);
      renderWatchModalImg();
    } else if (w._imageFound && w._prefetchedImageUrl) {
      wPendingFile  = null;
      wPendingImage = w._prefetchedImageUrl;
      renderWatchModalImg();
    }

    // Remove this item from the results (mark as added)
    _photoIdentifyResults.splice(idx, 1);

    // Show persistent banner instead of a quick toast
    document.getElementById('ai-prefill-banner').classList.remove('hidden');
  } catch (e) {
    console.error('[WristLog] addFromIdentified error:', e);
    toast('Add failed: ' + (e?.message || e), 'error');
  }
}

async function quickAddFromIdentified(idx) {
  const w = _photoIdentifyResults[idx];
  if (!w || !currentUser) return;
  const btn = document.querySelector(`.pi-card[data-pi-idx="${idx}"] .btn-primary`);
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  try {
    const newId = uid();
    let imageUrl = null;
    if (w._prefetchedCroppedBlob) {
      imageUrl = await uploadImage(w._prefetchedCroppedBlob, `watches/${currentUser.id}/${newId}.jpg`);
    }
    ensureBrand(w.brand);
    const data = {
      id: newId,
      brand: w.brand || '',
      name: w.model || '',
      ref: w.reference || '',
      movement: w.caliber || w.movementType || '',
      color: w.estimatedColor || '#94a3b8',
      ...(imageUrl ? { image: imageUrl } : {}),
    };
    watches.push(data);
    markDirty('watches', newId);
    _photoAddedWatchIds.push(newId);
    if (window.posthog) posthog.capture('watch_added', { brand: data.brand, source: 'photo_quick' });
    save();
    if (w._prefetchedImageUrl) URL.revokeObjectURL(w._prefetchedImageUrl);
    _photoIdentifyResults.splice(idx, 1);
    if (_photoIdentifyResults.length === 0) {
      closePhotoIdentify();
      renderCollection();
      toast('Watch added to collection!');
    } else {
      renderPhotoIdentifyResults();
      toast(`${w.brand} ${w.model} added!`);
    }
  } catch (e) {
    console.error('[WristLog] quickAdd error:', e);
    toast('Add failed: ' + (e?.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Add'; }
  }
}

async function addAllFromIdentified() {
  if (!currentUser || !_photoIdentifyResults.length) return;
  const allBtn = document.querySelector('#photo-identify-list .btn-primary');
  const total = _photoIdentifyResults.length;
  let added = 0;
  for (let i = _photoIdentifyResults.length - 1; i >= 0; i--) {
    const w = _photoIdentifyResults[i];
    try {
      const newId = uid();
      let imageUrl = null;
      if (w._prefetchedCroppedBlob) {
        imageUrl = await uploadImage(w._prefetchedCroppedBlob, `watches/${currentUser.id}/${newId}.jpg`);
      }
      ensureBrand(w.brand);
      watches.push({
        id: newId,
        brand: w.brand || '',
        name: w.model || '',
        ref: w.reference || '',
        movement: w.caliber || w.movementType || '',
        color: w.estimatedColor || '#94a3b8',
        ...(imageUrl ? { image: imageUrl } : {}),
      });
      markDirty('watches', newId);
      _photoAddedWatchIds.push(newId);
      if (w._prefetchedImageUrl) URL.revokeObjectURL(w._prefetchedImageUrl);
      added++;
    } catch (e) { console.error('[WristLog] addAll item error:', e); }
  }
  _photoIdentifyResults = [];
  if (window.posthog) posthog.capture('watch_added', { source: 'photo_add_all', count: added });
  save();
  closePhotoIdentify();
  renderCollection();
  toast(`${added} watch${added !== 1 ? 'es' : ''} added to collection!`);
}

let _photoAddedWatchIds = [];

let _postEnhanceValueIds = null;

async function maybeOfferPostPhotoEnhance() {
  const ids = _photoAddedWatchIds.slice();
  _photoAddedWatchIds = [];
  if (!ids.length) return;
  const count = ids.length;
  if (count === 1) window._photoFlowSingleWatchId = ids[0];
  _postEnhanceValueIds = ids;
  const specPrompt = await showConfirm(
    `Want to look up full specs, materials, dimensions, and history for ${count === 1 ? 'this watch' : `these ${count} watches`}?`,
    { title: 'Fill in specs?', confirmLabel: 'Yes, enhance', danger: false }
  );
  if (specPrompt) {
    await enhanceAllWatches(ids);
  } else {
    maybeOfferPostPhotoValue();
  }
}

async function maybeOfferPostPhotoValue() {
  const ids = _postEnhanceValueIds;
  _postEnhanceValueIds = null;
  if (!ids || !ids.length) return;
  const count = ids.length;
  const valuePrompt = await showConfirm(
    `Want to check market ${count === 1 ? 'value' : 'values'} for ${count === 1 ? 'this watch' : `these ${count} watches`}?`,
    { title: 'Check market value?', confirmLabel: 'Yes, check value', danger: false }
  );
  if (valuePrompt) {
    await checkBatchWatchValues(ids);
  } else if (window._photoFlowSingleWatchId) {
    const wid = window._photoFlowSingleWatchId;
    window._photoFlowSingleWatchId = null;
    openEditWatch(wid);
  }
}

// ── closePhotoIdentify + crop helpers ──
function openCropAdjuster(idx) {
  const w = _photoIdentifyResults[idx];
  if (!w || !window._photoIdentifyBlob) return;
  const bbox = (w.boundingBox && w.boundingBox.length === 4) ? w.boundingBox : null;
  _openCropUI(window._photoIdentifyBlob, bbox, (croppedBlob, bboxPct) => {
    if (w._prefetchedImageUrl) URL.revokeObjectURL(w._prefetchedImageUrl);
    w._prefetchedCroppedBlob = croppedBlob;
    w._prefetchedImageUrl = URL.createObjectURL(croppedBlob);
    w._imageFound = true;
    w._imageSource = 'cropped';
    w._userCropped = true;
    w.boundingBox = bboxPct;
    updateIdentifyCard(idx);
  });
}

// _showPhotoSourcePicker removed — native OS menu (Photo Library / Take Photo / Choose File) used instead

function closePhotoIdentify() {
  window._identifyAborted = true;
  document.getElementById('photo-identify-modal').classList.add('hidden');
  window._photoIdentifyBase64 = null;
  // If adding from identify, keep blob + results for the watch modal / crop adjuster.
  // Otherwise clean up all blob URLs to prevent memory leaks (esp. iOS Safari).
  if (!window._addingFromIdentify) {
    _photoIdentifyResults.forEach(w => {
      if (w._prefetchedImageUrl) URL.revokeObjectURL(w._prefetchedImageUrl);
    });
    _photoIdentifyResults = [];
    window._photoIdentifyBlob = null;
  }
  // Don't resume welcome wizard if we're transitioning to the add-watch form —
  // the welcome modal would cover it. Welcome resumes after save/cancel instead.
  if (!window._addingFromIdentify) {
    resumeWelcome();
    if (_photoAddedWatchIds.length) setTimeout(() => maybeOfferPostPhotoEnhance(), 600);
  }
}

/**
 * Crop a specific watch from the user's original photo using bounding box percentages.
 * Uses blob URL (more reliable than data URL for Image loading).
 * @param {Blob} blob - the original photo blob
 * @param {number[]} bbox - [xPct, yPct, wPct, hPct] percentages (0-100)
 * @returns {Promise<Blob>} cropped JPEG blob
 */
function cropWatchFromPhoto(blob, bbox, padding = 0.15) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      let [xPct, yPct, wPct, hPct] = bbox;
      // Add padding (15% default) so the dial is never cut off
      const padW = wPct * padding, padH = hPct * padding;
      xPct = Math.max(0, xPct - padW);
      yPct = Math.max(0, yPct - padH);
      wPct = Math.min(100 - xPct, wPct + padW * 2);
      hPct = Math.min(100 - yPct, hPct + padH * 2);
      const sx = Math.max(0, Math.round(img.width * xPct / 100));
      const sy = Math.max(0, Math.round(img.height * yPct / 100));
      const sw = Math.min(Math.round(img.width * wPct / 100), img.width - sx);
      const sh = Math.min(Math.round(img.height * hPct / 100), img.height - sy);
      if (sw <= 0 || sh <= 0) { reject(new Error('invalid crop region')); return; }
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('img load failed')); };
    img.src = blobUrl;
  });
}
