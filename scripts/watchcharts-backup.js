/**
 * WatchCharts Pricing Integration — BACKUP
 * ==========================================
 * Removed from the app on 2026-03-04 before App Store submission.
 * This file preserves all WatchCharts-related code for potential future restoration.
 *
 * Features backed up:
 * 1. CORS proxy fetch helper
 * 2. WatchCharts model URL search
 * 3. Market price extraction from WatchCharts pages
 * 4. Edit modal: Find URL + Get Price buttons
 * 5. Collection page: "Update All Prices" batch function
 * 6. Price confirmation modal (Override/Skip/Cancel dialog)
 * 7. Related HTML snippets
 */

// ══════════════════════════════════════════
//  CORS PROXY + WATCHCHARTS FUNCTIONS
// ══════════════════════════════════════════

// Retries once with a 2.5s backoff on 429 (rate limit).
async function _fetchViaProxy(url) {
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2500));
    try {
      const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
      if (r.status === 429) continue; // rate-limited → wait and retry
      if (!r.ok) throw new Error(`proxy ${r.status}`);
      const text = await r.text();
      if (text.length < 200) throw new Error('empty response');
      return text;
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }
  throw new Error('proxy failed after retry');
}

// Search WatchCharts for a model URL using reference number only (most precise).
// Falls back to brand + name if no ref is provided. Returns a model root URL or null.
async function findWatchChartsModelUrl(brand, name, ref) {
  const brandKey = brand.toLowerCase().split(/\s+/)[0];
  const queries = [];
  if (ref && ref.trim()) {
    queries.push(ref.trim());
  }
  if (!queries.length) {
    const nameWords = name.trim().split(/\s+/);
    queries.push(`${brand} ${nameWords.slice(0, 3).join(' ')}`);
  }
  for (const q of queries) {
    try {
      const searchHtml = await _fetchViaProxy(
        `https://watchcharts.com/watches/search?q=${encodeURIComponent(q)}`
      );
      const allLinks = [...searchHtml.matchAll(/href="(https:\/\/watchcharts\.com\/watch_model\/[^"]+)"/g)]
        .map(m => m[1]);
      const modelUrl = allLinks.find(u => u.toLowerCase().includes(brandKey));
      if (modelUrl) return modelUrl.replace(/\/[^/]+$/, '');
    } catch (_) {}
  }
  return null;
}

// Fetch the market price from a given WatchCharts model URL.
async function fetchPriceFromWatchChartsUrl(url) {
  const modelRoot = url.replace(/\/(overview|prices|history|specs|charts?)(\?.*)?$/, '').replace(/\/$/, '');
  const html = await _fetchViaProxy(modelRoot);
  const fastMatch = html.match(/Market Price\.\s*\$([\d,]+)/);
  if (fastMatch) {
    const price = parseInt(fastMatch[1].replace(/,/g, ''), 10);
    if (price > 100 && price < 10_000_000) return { price, src: 'WatchCharts' };
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const mpEl = doc.querySelector('.market-price');
  if (mpEl) {
    const price = parseInt(mpEl.textContent.replace(/[$,\s]/g, ''), 10);
    if (price > 100 && price < 10_000_000) return { price, src: 'WatchCharts' };
  }
  return null;
}

// Edit modal: auto-find WatchCharts URL for the watch being edited
async function modalFindWcUrl() {
  const brand = document.getElementById('w-brand').value;
  const name  = document.getElementById('w-name').value.trim();
  const ref   = document.getElementById('w-ref').value.trim();
  if (!brand || !name) {
    toast('Fill in Brand and Model name first', 'error'); return;
  }
  const btn      = document.getElementById('wc-find-btn');
  const statusEl = document.getElementById('wc-status');
  btn.disabled = true; btn.textContent = 'Searching…';
  statusEl.textContent = '';
  try {
    const url = await findWatchChartsModelUrl(brand, name, ref);
    if (!url) {
      statusEl.textContent = 'No match found — paste the URL manually';
    } else {
      document.getElementById('w-wc-url').value = url;
      updateWcUrlBtn();
      statusEl.textContent = '✓ URL found — click Get Price to get the price';
    }
  } catch (_) {
    statusEl.textContent = 'Search failed — try again';
  }
  btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Find';
}

// Edit modal: fetch price from the WatchCharts URL currently in the URL field
async function modalFetchPrice() {
  const wcUrl = document.getElementById('w-wc-url').value.trim();
  if (!wcUrl) { toast('Enter or Find a WatchCharts URL first', 'error'); return; }
  const btn      = document.getElementById('wc-fetch-btn');
  const statusEl = document.getElementById('wc-status');
  btn.disabled = true; btn.textContent = 'Fetching…';
  statusEl.textContent = '';
  try {
    const result = await fetchPriceFromWatchChartsUrl(wcUrl);
    if (!result) {
      statusEl.textContent = 'Price not found on that page';
    } else {
      modalFetchedPrice = result.price;
      setPriceInput('w-manual-mp', result.price);
      statusEl.textContent = `✓ ${fmtMoney(result.price)} from WatchCharts — edit the value below to override`;
    }
  } catch (_) {
    statusEl.textContent = 'Fetch failed — check the URL or try again';
  }
  btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Get Price <span style="font-size:.6rem;font-weight:700;letter-spacing:.06em;background:rgba(201,168,76,.18);color:var(--gold);border-radius:4px;padding:.1rem .35rem;vertical-align:middle;">BETA</span>';
}

// "Update All Prices" — batch update all watches that have a WatchCharts URL
async function updateAllMarketPrices() {
  const btn      = document.getElementById('update-all-btn');
  const toUpdate = watches.filter(w => w.watchChartsUrl);
  if (!toUpdate.length) {
    toast('No watches have a WatchCharts URL yet. Edit a watch to add one.', 'error'); return;
  }
  const isManual = w => w.marketPrice && w.marketPriceSrc !== 'WatchCharts';
  const pricedOnes = toUpdate.filter(w => w.marketPrice);
  let skipManual = false;
  if (pricedOnes.length) {
    const choice = await showUpdatePricesConfirm(pricedOnes);
    if (choice === 'abort') return;
    skipManual = (choice === 'skip');
  }
  btn.disabled = true; btn.textContent = 'Updating…';
  let updated = 0, failed = 0, skipped = 0;
  for (const w of toUpdate) {
    if (skipManual && isManual(w)) { skipped++; continue; }
    try {
      const result = await fetchPriceFromWatchChartsUrl(w.watchChartsUrl);
      if (result) {
        const idx = watches.findIndex(x => x.id === w.id);
        if (watches[idx].marketPrice && watches[idx].marketPrice !== result.price) {
          watches[idx].priceHistory = [
            ...(watches[idx].priceHistory || []),
            { price: watches[idx].marketPrice, date: watches[idx].marketPriceDate || todayStr(), src: watches[idx].marketPriceSrc || 'WatchCharts' }
          ];
        }
        watches[idx].marketPrice     = result.price;
        watches[idx].marketPriceDate = todayStr();
        watches[idx].marketPriceSrc  = result.src;
        updated++;
      } else { failed++; }
    } catch (_) { failed++; }
    await new Promise(r => setTimeout(r, 900));
  }
  save();
  renderCollection();
  btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg> Update Prices <span style="font-size:.6rem;font-weight:700;letter-spacing:.06em;background:rgba(201,168,76,.18);color:var(--gold);border-radius:4px;padding:.1rem .35rem;vertical-align:middle;">BETA</span>';
  const parts = [`Updated ${updated} watch${updated !== 1 ? 'es' : ''}`];
  if (skipped) parts.push(`${skipped} manual price${skipped > 1 ? 's' : ''} kept`);
  if (failed)  parts.push(`${failed} failed`);
  toast(parts.join(' · '));
}

function updateWcUrlBtn() {
  const val = document.getElementById('w-wc-url').value.trim();
  const btn = document.getElementById('wc-url-open-btn');
  if (val && val.startsWith('http')) {
    btn.href = val;
    btn.classList.remove('hidden');
  } else {
    btn.href = '#';
    btn.classList.add('hidden');
  }
}

// ── Update Prices — manual override dialog (3-choice) ─────────────────────
let _priceConfirmResolve = null;
function showUpdatePricesConfirm(manualOnes) {
  return new Promise(resolve => {
    _priceConfirmResolve = resolve;
    const list = document.getElementById('price-confirm-list');
    list.innerHTML = manualOnes.map(w => {
      const isManualEntry = w.marketPriceSrc !== 'WatchCharts';
      const badge = isManualEntry
        ? `<span style="font-size:.68rem;font-weight:700;letter-spacing:.05em;color:var(--gold);background:rgba(201,168,76,.15);border-radius:4px;padding:.05rem .3rem;flex-shrink:0;">MANUAL</span>`
        : '';
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;">
         <span style="color:var(--text);font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(w.brand)} ${escHtml(w.name)}</span>
         <span style="display:flex;align-items:center;gap:.4rem;flex-shrink:0;">${badge}<span style="color:var(--gold);">${fmtMoney(w.marketPrice)}</span></span>
       </div>`;
    }).join('');
    document.getElementById('price-confirm-modal').classList.remove('hidden');
  });
}
function _priceConfirmOverride() { document.getElementById('price-confirm-modal').classList.add('hidden'); if (_priceConfirmResolve) { _priceConfirmResolve('override'); _priceConfirmResolve = null; } }
function _priceConfirmSkip()     { document.getElementById('price-confirm-modal').classList.add('hidden'); if (_priceConfirmResolve) { _priceConfirmResolve('skip');     _priceConfirmResolve = null; } }
function _priceConfirmAbort()    { document.getElementById('price-confirm-modal').classList.add('hidden'); if (_priceConfirmResolve) { _priceConfirmResolve('abort');    _priceConfirmResolve = null; } }


// ══════════════════════════════════════════
//  HTML SNIPPETS (for reference)
// ══════════════════════════════════════════

/*
── Update Prices button (collection page header) ──
<button class="btn btn-ghost" id="update-all-btn" onclick="updateAllMarketPrices()" title="Update Prices" style="display:inline-flex;align-items:center;gap:.4rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg><span class="btn-label"> Update Prices <span style="font-size:.6rem;font-weight:700;letter-spacing:.06em;background:rgba(201,168,76,.18);color:var(--gold);border-radius:4px;padding:.1rem .35rem;vertical-align:middle;">BETA</span></span></button>

── WatchCharts URL form group (edit modal) ──
<div class="form-group">
  <label>WatchCharts URL</label>
  <div class="wc-url-row">
    <input type="url" id="w-wc-url" placeholder="https://watchcharts.com/watch_model/…" oninput="updateWcUrlBtn()">
    <button class="btn btn-ghost btn-sm" id="wc-find-btn" onclick="modalFindWcUrl()" style="white-space:nowrap;flex-shrink:0;display:inline-flex;align-items:center;gap:.3rem;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Find</button>
    <button class="btn btn-ghost btn-sm" id="wc-fetch-btn" onclick="modalFetchPrice()" style="white-space:nowrap;flex-shrink:0;display:inline-flex;align-items:center;gap:.3rem;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Get Price <span style="font-size:.6rem;font-weight:700;letter-spacing:.06em;background:rgba(201,168,76,.18);color:var(--gold);border-radius:4px;padding:.1rem .35rem;vertical-align:middle;">BETA</span></button>
    <a id="wc-url-open-btn" href="#" target="_blank" rel="noopener noreferrer" class="url-open-btn hidden" title="Open in new tab" style="flex-shrink:0;font-size:.78rem;padding:.35rem .5rem;">↗</a>
  </div>
  <div class="wc-status" id="wc-status"></div>
</div>

── Price confirmation modal ──
<div id="price-confirm-modal" class="overlay hidden" onclick="if(event.target===this)_priceConfirmAbort()">
  <div class="modal" style="max-width:380px;">
    <div class="modal-title">Existing prices will be updated</div>
    <p style="color:var(--muted);font-size:.85rem;margin-bottom:.75rem;line-height:1.5;">
      These watches already have prices. <b style="color:var(--text);">Manual</b> prices will be kept if you press Skip; WatchCharts prices will always refresh.
    </p>
    <div id="price-confirm-list" style="background:var(--surface2);border-radius:8px;padding:.55rem .75rem;margin-bottom:1.1rem;max-height:160px;overflow-y:auto;font-size:.83rem;line-height:1.9;"></div>
    <div class="modal-actions" style="flex-direction:column;gap:.5rem;">
      <button class="btn btn-primary" style="width:100%;" onclick="_priceConfirmOverride()">Override — update all</button>
      <button class="btn btn-ghost"   style="width:100%;" onclick="_priceConfirmSkip()">Skip — keep manual, refresh WatchCharts</button>
      <button class="btn btn-ghost"   style="width:100%;color:var(--muted);" onclick="_priceConfirmAbort()">Cancel — stop the update</button>
    </div>
  </div>
</div>

── CSS ──
.wc-url-row { display: flex; gap: .45rem; align-items: center; }
.wc-url-row input { flex: 1; min-width: 0; }
.wc-status { font-size: .78rem; color: var(--muted); margin-top: .35rem; min-height: 1.1em; }

── Save logic (inside saveWatch()) ──
// Market price: if field has a value, save it.
// Source = WatchCharts if Fetch was used AND value matches what was fetched; User Entry otherwise.
if (manualMp) {
  data.marketPrice     = manualMp;
  data.marketPriceDate = todayStr();
  data.marketPriceSrc  = (modalFetchedPrice && manualMp === modalFetchedPrice) ? 'WatchCharts' : 'User Entry';
} else if (modalFetchedPrice) {
  // Fetch was used but user cleared the field — still honour the fetched value
  data.marketPrice     = modalFetchedPrice;
  data.marketPriceDate = todayStr();
  data.marketPriceSrc  = 'WatchCharts';
}

── Edit modal open — WatchCharts fields ──
modalFetchedPrice = null;
document.getElementById('w-wc-url').value = w.watchChartsUrl || '';
if (w.marketPrice) {
  setPriceInput('w-manual-mp', w.marketPrice);
  modalFetchedPrice = (w.marketPriceSrc === 'WatchCharts') ? w.marketPrice : null;
} else {
  document.getElementById('w-manual-mp').value = '';
}
const wcStatusEl = document.getElementById('wc-status');
if (w.marketPrice) {
  wcStatusEl.textContent = `Current: ${fmtMoney(w.marketPrice)}${w.marketPriceSrc ? ' · ' + w.marketPriceSrc : ''}${w.marketPriceDate ? ' · ' + fmtDate(w.marketPriceDate) : ''}`;
} else {
  wcStatusEl.textContent = '';
}
*/
