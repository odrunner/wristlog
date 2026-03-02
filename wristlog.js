// WristLog — Extracted pure-logic functions for testability
// These are the core business logic functions extracted from app.html.

// ══════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════

export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function fmtDate(d) {
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtMonYear(d) {
  if (!d) return null;
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function fmtMoney(n) {
  return n ? '$' + Number(n).toLocaleString() : '—';
}

export function initials(b, n) {
  return ((b[0] || '') + (n[0] || '')).toUpperCase();
}

export function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function profileInitials(p) {
  if (!p) return '?';
  const name = (p.display_name || p.username || '').trim();
  const parts = name.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || '?';
}

export function formatFeedDate(dateStr, today = new Date()) {
  if (!dateStr) return '';
  const todayNorm = new Date(today); todayNorm.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((todayNorm - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7)  return `${diff} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ══════════════════════════════════════════
//  USERNAME VALIDATION
// ══════════════════════════════════════════

export function validateUsername(raw) {
  const val = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (val.length < 3) return { valid: false, clean: val, error: 'At least 3 characters' };
  if (val.length > 30) return { valid: false, clean: val, error: 'Max 30 characters' };
  if (!/^[a-z][a-z0-9_]*$/.test(val)) return { valid: false, clean: val, error: 'Must start with a letter' };
  return { valid: true, clean: val, error: null };
}

// ══════════════════════════════════════════
//  PRICE FORMATTING
// ══════════════════════════════════════════

export function formatPriceString(value) {
  const raw = value.replace(/[^\d.]/g, '');
  const dotIdx = raw.indexOf('.');
  const intPart = dotIdx >= 0 ? raw.slice(0, dotIdx) : raw;
  const decPart = dotIdx >= 0 ? raw.slice(dotIdx) : '';
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + decPart;
}

export function parsePrice(formattedValue) {
  return parseFloat(formattedValue.replace(/,/g, '')) || 0;
}

// ══════════════════════════════════════════
//  DATA SERIALIZATION
// ══════════════════════════════════════════

export function watchToRow(w, userId, eloRatings = {}) {
  return {
    id: w.id, user_id: userId,
    brand: w.brand || null, name: w.name || null, ref: w.ref || null,
    price: w.price || null, purchase_date: w.purchaseDate || null,
    color: w.color || null, image: w.image || null, url: w.url || null,
    tags: w.tags || [], straps: w.straps || [], owner: w.owner || null,
    market_price: w.marketPrice || null, market_price_date: w.marketPriceDate || null,
    market_price_src: w.marketPriceSrc || null, watch_charts_url: w.watchChartsUrl || null,
    price_history: w.priceHistory || [], warranty_expiry: w.warrantyExpiry || null,
    has_box: w.hasBox === 'yes' ? true : w.hasBox === 'no' ? false : null,
    has_papers: w.hasPapers === 'yes' ? true : w.hasPapers === 'no' ? false : null,
    insurance: w.insurance || null, insured_value: w.insuredValue || null,
    insurance_notes: w.insuranceNotes || null, receipts: w.receipts || [],
    elo_rating: eloRatings[w.id] || 1000,
    watch_privacy: w.watchPrivacy ?? null,
    is_public: w.watchPrivacy !== 'private',
  };
}

export function rowToWatch(r) {
  return {
    id: r.id, brand: r.brand || '', name: r.name || '', ref: r.ref || '',
    price: r.price || null, purchaseDate: r.purchase_date || null,
    color: r.color || '#c9a84c',
    image: r.image ? r.image.replace(/^http:\/\//i, 'https://') : null,
    url: r.url || null,
    tags: r.tags || [], straps: r.straps || [], owner: r.owner || null,
    marketPrice: r.market_price || null, marketPriceDate: r.market_price_date || null,
    marketPriceSrc: r.market_price_src || null, watchChartsUrl: r.watch_charts_url || null,
    priceHistory: r.price_history || [], warrantyExpiry: r.warranty_expiry || null,
    hasBox: r.has_box === true ? 'yes' : r.has_box === false ? 'no' : null,
    hasPapers: r.has_papers === true ? 'yes' : r.has_papers === false ? 'no' : null,
    insurance: r.insurance || null, insuredValue: r.insured_value || null,
    insuranceNotes: r.insurance_notes || null, receipts: r.receipts || [],
    watchPrivacy: r.watch_privacy ?? null,
    isPublic: r.watch_privacy !== 'private',
  };
}

export function logToRow(l, userId) {
  const vis = l.visibility || 'public';
  return {
    id: l.id, user_id: userId, watch_id: l.watchId,
    date: l.date, use_case: l.useCase || 'unspecified',
    notes: l.notes || null, strap_id: l.strapId || null,
    photo_url: l.photoUrl || null, is_public: vis !== 'private',
    visibility: vis,
    club_id: l.clubId || null,
  };
}

export function rowToLog(r) {
  return {
    id: r.id, watchId: r.watch_id, date: r.date,
    useCase: r.use_case || 'unspecified', notes: r.notes || null,
    strapId: r.strap_id || null, photoUrl: r.photo_url || null,
    isPublic: r.is_public !== false,
    visibility: r.visibility || (r.is_public !== false ? 'public' : 'private'),
    clubId: r.club_id || null,
  };
}

export function wishToRow(w, userId) {
  return {
    id: w.id, user_id: userId,
    brand: w.brand || null, name: w.name || null, ref: w.ref || null,
    price: w.price || null, url: w.url || null, image: w.image || null,
    notes: w.notes || null, color: w.color || null, tags: w.tags || [],
    market_price: w.marketPrice || null, market_price_date: w.marketPriceDate || null,
    market_price_src: w.marketPriceSrc || null, watch_charts_url: w.watchChartsUrl || null,
    wish_privacy: w.wishPrivacy || null,
    added_date: w.addedDate || null,
  };
}

export function rowToWish(r) {
  return {
    id: r.id, brand: r.brand || '', name: r.name || '', ref: r.ref || '',
    price: r.price || null, url: r.url || null, image: r.image || null,
    notes: r.notes || null, color: r.color || '#c9a84c', tags: r.tags || [],
    marketPrice: r.market_price || null, marketPriceDate: r.market_price_date || null,
    marketPriceSrc: r.market_price_src || null, watchChartsUrl: r.watch_charts_url || null,
    wishPrivacy: r.wish_privacy || null,
    addedDate: r.added_date || null,
  };
}

// ══════════════════════════════════════════
//  ELO RANKING
// ══════════════════════════════════════════

const ELO_DEFAULT = 1000;
const ELO_K = 32;

export function eloExpected(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

export function buildGameQueue(watchList) {
  const pairs = [];
  for (let i = 0; i < watchList.length; i++)
    for (let j = i + 1; j < watchList.length; j++)
      pairs.push({ aId: watchList[i].id, bId: watchList[j].id });
  // Fisher-Yates shuffle
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  return pairs;
}

export function computeEloUpdate(winnerId, loserId, ratings) {
  const wElo = ratings[winnerId] ?? ELO_DEFAULT;
  const lElo = ratings[loserId] ?? ELO_DEFAULT;
  const exp = eloExpected(wElo, lElo);
  return {
    [winnerId]: Math.round(wElo + ELO_K * (1 - exp)),
    [loserId]: Math.round(lElo + ELO_K * (0 - (1 - exp))),
  };
}

// ══════════════════════════════════════════
//  WATCH RECOMMENDATION
// ══════════════════════════════════════════

const WARM = new Set(['#c9a84c', '#fbbf24', '#fb923c', '#ef7942', '#f43f5e']);
const COOL = new Set(['#38bdf8', '#818cf8', '#a78bfa', '#34d399', '#4caf7d']);
const DARK = new Set(['#94a3b8']);

export function computeWatchRec({ watches, logs, weatherData, skipSet, now = new Date() }) {
  if (!watches.length) return null;
  const today = todayStr(now);
  const todayDOW = now.getDay();
  const isWeekend = todayDOW === 0 || todayDOW === 6;
  const candidates = watches.map(w => {
    if (skipSet && skipSet.has(w.id)) return null;
    const wLogs = logs.filter(l => l.watchId === w.id);
    if (wLogs.some(l => l.date === today)) return null;
    let daysSince = 999;
    if (wLogs.length) {
      const last = wLogs.reduce((a, b) => a.date > b.date ? a : b).date;
      daysSince = Math.floor((now - new Date(last + 'T12:00:00')) / 86400000);
    }
    const dowCount = wLogs.filter(l => new Date(l.date + 'T12:00:00').getDay() === todayDOW).length;
    let weatherScore = 0, weatherReason = null;
    if (weatherData) {
      const isWarm = WARM.has(w.color), isCool = COOL.has(w.color), isDark = DARK.has(w.color);
      if (weatherData.condition === 'sunny' && isWarm) { weatherScore = 3; weatherReason = 'Warm tone for sunny skies'; }
      else if (weatherData.condition === 'sunny' && isCool) { weatherScore = 1; }
      else if ((weatherData.condition === 'cloudy' || weatherData.condition === 'rainy') && (isCool || isDark)) { weatherScore = 3; weatherReason = `Cool tone suits today's ${weatherData.condition} skies`; }
    }
    const dinnerWears = wLogs.filter(l => l.useCase === 'dinner').length;
    const hasDressTag = (w.tags || []).includes('Dress');
    const weekendScore = isWeekend ? Math.min(dinnerWears * 5 + (hasDressTag ? 10 : 0), 30) : 0;
    const weekendReason = isWeekend && (dinnerWears > 0 || hasDressTag)
      ? (hasDressTag && dinnerWears === 0 ? 'Dress watch — perfect for the weekend' : `Worn to dinner ${dinnerWears}× — great for the weekend`)
      : null;
    const score = Math.min(daysSince, 90) + dowCount * 8 + weatherScore * 5 + weekendScore;
    return { w, daysSince, dowCount, weatherScore, weatherReason, weekendScore, weekendReason, score };
  }).filter(Boolean);
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

// ══════════════════════════════════════════
//  SAVE WATCH LOGIC (pure data transform)
// ══════════════════════════════════════════

export function buildSaveWatchData({ formData, editingId, watches, todayFn = todayStr }) {
  const { brand, name } = formData;
  if (!brand || brand === '__new__') return { error: 'Please select or add a brand' };
  if (!name) return { error: 'Model name is required' };

  const data = {
    brand,
    name,
    ref: formData.ref || '',
    price: formData.price || 0,
    purchaseDate: formData.purchaseDate || '',
    url: formData.url || '',
    color: formData.color || '#c9a84c',
    insurance: formData.insurance || null,
    insuredValue: formData.insurance === 'insured' ? (formData.insuredValue || null) : null,
    insuranceNotes: formData.insurance === 'not_insured' ? (formData.insuranceNotes || '') : '',
    warrantyExpiry: formData.warrantyExpiry || null,
    hasBox: formData.hasBox || null,
    hasPapers: formData.hasPapers || null,
    watchChartsUrl: formData.watchChartsUrl || null,
    tags: formData.tags || [],
    straps: formData.straps || [],
    isPublic: formData.isPublic || false,
    ...(formData.image ? { image: formData.image } : {}),
  };

  // Market price logic
  const manualMp = formData.manualMp || 0;
  const modalFetchedPrice = formData.modalFetchedPrice || null;

  if (manualMp) {
    data.marketPrice = manualMp;
    data.marketPriceDate = todayFn();
    data.marketPriceSrc = (modalFetchedPrice && manualMp === modalFetchedPrice) ? 'WatchCharts' : 'User Entry';
  } else if (modalFetchedPrice) {
    data.marketPrice = modalFetchedPrice;
    data.marketPriceDate = todayFn();
    data.marketPriceSrc = 'WatchCharts';
  }

  if (editingId) {
    const existing = watches.find(x => x.id === editingId);
    if (!existing) return { error: 'Watch not found' };
    if (data.marketPrice && existing.marketPrice && existing.marketPrice !== data.marketPrice) {
      data.priceHistory = [
        ...(existing.priceHistory || []),
        { price: existing.marketPrice, date: existing.marketPriceDate || todayFn(), src: existing.marketPriceSrc || 'WatchCharts' }
      ];
    } else if (!data.marketPrice) {
      data.priceHistory = existing.priceHistory;
    }
    return { data: { ...existing, ...data }, isNew: false };
  } else {
    return { data: { id: null, ...data }, isNew: true };
  }
}

// ══════════════════════════════════════════
//  WEAR LOG LOGIC (pure data transforms)
// ══════════════════════════════════════════

export function validateLog({ date, watchId }) {
  if (!date) return 'Please select a date';
  if (!watchId) return 'Please select a watch';
  return null;
}

export function buildLogEntry({ id, watchId, date, useCase, notes, strapId, photoUrl }) {
  const entry = { id, watchId, date, useCase: useCase || 'unspecified', notes: notes || null, photoUrl: photoUrl || null };
  if (strapId) entry.strapId = strapId;
  return entry;
}

export function applyStrapSelection(watches, watchId, strapId) {
  if (!strapId) return watches;
  return watches.map(w => {
    if (w.id !== watchId || !(w.straps || []).length) return w;
    return { ...w, straps: w.straps.map(s => ({ ...s, isOn: s.id === strapId })) };
  });
}

// ══════════════════════════════════════════
//  STATISTICS (pure computations)
// ══════════════════════════════════════════

export function filterLogsByPeriod(logs, period, now = new Date()) {
  if (period === 'all') return logs;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - parseInt(period));
  const cs = cutoff.toISOString().split('T')[0];
  return logs.filter(l => l.date >= cs);
}

export function computeStats(filteredLogs, watches) {
  const total = filteredLogs.length;
  const days = new Set(filteredLogs.map(l => l.date)).size;
  const unique = new Set(filteredLogs.map(l => l.watchId)).size;

  const wm = {};
  filteredLogs.forEach(l => { wm[l.watchId] = (wm[l.watchId] || 0) + 1; });
  const favId = Object.keys(wm).sort((a, b) => wm[b] - wm[a])[0];
  const fav = favId ? watches.find(x => x.id === favId) : null;

  const collectionValue = watches.reduce((s, w) => s + (w.price || 0), 0);

  return { total, days, unique, collectionSize: watches.length, favourite: fav, collectionValue };
}

export function computeCollectionReport(filteredLogs, allLogs, watches) {
  const wm = {};
  filteredLogs.forEach(l => { wm[l.watchId] = (wm[l.watchId] || 0) + 1; });

  return watches.map(w => {
    const cnt = wm[w.id] || 0;
    const cpw = (w.price && cnt) ? w.price / cnt : null;
    const paid = w.price || null;
    const mp = w.marketPrice || null;
    const delta = (mp != null && paid != null) ? mp - paid : null;
    const pct = (delta != null && paid) ? delta / paid * 100 : null;
    const pdate = w.purchaseDate || null;

    const allWLogs = allLogs.filter(l => l.watchId === w.id).map(l => l.date).sort();
    let avgFreq = null;
    if (allWLogs.length >= 2) {
      let totalGap = 0;
      for (let i = 1; i < allWLogs.length; i++) {
        totalGap += (new Date(allWLogs[i] + 'T12:00:00') - new Date(allWLogs[i - 1] + 'T12:00:00')) / 86400000;
      }
      avgFreq = Math.round(totalGap / (allWLogs.length - 1));
    }
    return { w, cnt, cpw, paid, mp, delta, pct, pdate, avgFreq };
  });
}

export function computeReportTotals(rows) {
  const totWears = rows.reduce((s, r) => s + r.cnt, 0);
  const totPaidAll = rows.reduce((s, r) => s + (r.paid || 0), 0);
  const rowsWDelta = rows.filter(r => r.delta != null);
  const totMktSum = rows.reduce((s, r) => s + (r.mp || 0), 0);
  const totGain = rowsWDelta.reduce((s, r) => s + r.delta, 0);
  const paidWMkt = rowsWDelta.reduce((s, r) => s + (r.paid || 0), 0);
  const totGainPct = paidWMkt > 0 ? totGain / paidWMkt * 100 : null;
  const avgCpw = totWears > 0 && totPaidAll > 0 ? totPaidAll / totWears : null;

  return { totWears, totPaidAll, totMktSum, totGain, totGainPct, avgCpw };
}

export function sortReportRows(rows, sortSpec) {
  const [sortField, sortDir] = sortSpec.split('-');
  const asc = sortDir === 'asc';
  const numSort = (va, vb) => {
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return asc ? va - vb : vb - va;
  };
  return [...rows].sort((a, b) => {
    switch (sortField) {
      case 'watch': {
        const sa = (a.w.brand + ' ' + a.w.name).toLowerCase();
        const sb = (b.w.brand + ' ' + b.w.name).toLowerCase();
        return asc ? sa.localeCompare(sb) : sb.localeCompare(sa);
      }
      case 'wears':  return numSort(a.cnt, b.cnt);
      case 'cpw':    return numSort(a.cpw, b.cpw);
      case 'paid':   return numSort(a.paid, b.paid);
      case 'market': return numSort(a.mp, b.mp);
      case 'delta':  return numSort(a.delta, b.delta);
      case 'pct':    return numSort(a.pct, b.pct);
      case 'pdate': {
        if (!a.pdate && !b.pdate) return 0;
        if (!a.pdate) return 1;
        if (!b.pdate) return -1;
        return asc ? a.pdate.localeCompare(b.pdate) : b.pdate.localeCompare(a.pdate);
      }
      case 'freq': return numSort(a.avgFreq, b.avgFreq);
      default: return 0;
    }
  });
}

// ══════════════════════════════════════════
//  YEAR-IN-REVIEW (pure computation)
// ══════════════════════════════════════════

export function computeYearInReview(year, watches, logs) {
  const yr = String(year);
  const watchIds = new Set(watches.map(w => w.id));
  const yLogs = logs.filter(l => l.date.startsWith(yr) && watchIds.has(l.watchId));

  const totalWears = yLogs.length;
  const wearDays = new Set(yLogs.map(l => l.date)).size;
  const newWatches = watches.filter(w => w.purchaseDate && w.purchaseDate.startsWith(yr)).length;
  const wornSet = new Set(yLogs.map(l => l.watchId));
  const unworn = watches.filter(w => !wornSet.has(w.id)).length;

  const wearMap = {};
  yLogs.forEach(l => { wearMap[l.watchId] = (wearMap[l.watchId] || 0) + 1; });
  const topWatchId = Object.keys(wearMap).sort((a, b) => wearMap[b] - wearMap[a])[0] || null;
  const topWatch = topWatchId ? watches.find(w => w.id === topWatchId) : null;

  const ucMap = {};
  yLogs.forEach(l => { ucMap[l.useCase] = (ucMap[l.useCase] || 0) + 1; });
  const topUC = Object.keys(ucMap).sort((a, b) => ucMap[b] - ucMap[a])[0] || null;

  const mMap = {};
  yLogs.forEach(l => { const m = l.date.slice(0, 7); mMap[m] = (mMap[m] || 0) + 1; });
  const topMonth = Object.keys(mMap).sort((a, b) => mMap[b] - mMap[a])[0] || null;
  const topMonthLabel = topMonth ? new Date(topMonth + '-15').toLocaleDateString('en-US', { month: 'long' }) : null;

  return {
    totalWears, wearDays, newWatches, unworn,
    topWatch, topWatchWears: topWatchId ? wearMap[topWatchId] : 0,
    topUC, topUCWears: topUC ? ucMap[topUC] : 0,
    topMonth, topMonthLabel, topMonthWears: topMonth ? mMap[topMonth] : 0,
  };
}

// ══════════════════════════════════════════
//  MONTHLY REVIEW (pure computation)
// ══════════════════════════════════════════

export function computeMonthlyReview(year, month, watches, logs) {
  const watchIds = new Set(watches.map(w => w.id));
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const mLogs = logs.filter(l => l.date.startsWith(prefix) && watchIds.has(l.watchId));

  if (!mLogs.length) return { totalWears: 0, wearDays: 0, uniqueCount: 0, topWatch: null, topUC: null, topDow: null };

  const totalWears = mLogs.length;
  const wearDays = new Set(mLogs.map(l => l.date)).size;
  const uniqueCount = new Set(mLogs.map(l => l.watchId)).size;

  const wm = {}; mLogs.forEach(l => { wm[l.watchId] = (wm[l.watchId] || 0) + 1; });
  const topWId = Object.keys(wm).sort((a, b) => wm[b] - wm[a])[0];
  const topWatch = topWId ? watches.find(w => w.id === topWId) : null;
  const topWatchWears = topWId ? wm[topWId] : 0;

  const ucm = {}; mLogs.forEach(l => { ucm[l.useCase] = (ucm[l.useCase] || 0) + 1; });
  const topUC = Object.keys(ucm).sort((a, b) => ucm[b] - ucm[a])[0] || null;
  const topUCWears = topUC ? ucm[topUC] : 0;

  const dowm = {}; mLogs.forEach(l => { const d = new Date(l.date + 'T12:00:00').getDay(); dowm[d] = (dowm[d] || 0) + 1; });
  const topDow = Object.keys(dowm).sort((a, b) => dowm[b] - dowm[a])[0];
  const topDowWears = topDow !== undefined ? dowm[topDow] : 0;

  return { totalWears, wearDays, uniqueCount, topWatch, topWatchWears, topUC, topUCWears, topDow: Number(topDow), topDowWears };
}

// ══════════════════════════════════════════
//  MONTH NAVIGATION
// ══════════════════════════════════════════

export function monthRevNav(year, month, dir) {
  let m = month + dir;
  let y = year;
  if (m < 0)  { m = 11; y--; }
  if (m > 11) { m = 0;  y++; }
  return { year: y, month: m };
}

// ══════════════════════════════════════════
//  WARRANTY STATUS
// ══════════════════════════════════════════

export function warrantyStatus(w, today = new Date()) {
  if (!w.warrantyExpiry) return null;
  const todayNorm = new Date(today); todayNorm.setHours(0, 0, 0, 0);
  const exp = new Date(w.warrantyExpiry + 'T12:00:00');
  const days = Math.round((exp - todayNorm) / 86400000);
  if (days < 0)   return { cls: 'warranty-expired', text: 'Warranty expired' };
  if (days <= 60) return { cls: 'warranty-expiring', text: `Warranty: ${days}d left` };
  const mo = Math.round(days / 30);
  return { cls: 'warranty-active', text: `✓ Warranty: ${mo}mo left` };
}

// ══════════════════════════════════════════
//  WISHLIST REORDER (pure array logic)
// ══════════════════════════════════════════

export function reorderList(list, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return list;
  const fromIdx = list.findIndex(x => x.id === fromId);
  const toIdx = list.findIndex(x => x.id === toId);
  if (fromIdx < 0 || toIdx < 0) return list;
  const result = [...list];
  const [item] = result.splice(fromIdx, 1);
  result.splice(toIdx, 0, item);
  return result;
}

// ══════════════════════════════════════════
//  FRIEND REQUEST STATE MACHINE
// ══════════════════════════════════════════

export function computeFriendState(sentRequests, receivedRequests) {
  const friends = new Set();
  for (const [, req] of sentRequests) {
    if (req.status === 'accepted') friends.add(req.receiver_id || req.userId);
  }
  for (const [, req] of receivedRequests) {
    if (req.status === 'accepted') friends.add(req.sender_id || req.userId);
  }
  return friends;
}

export function getFriendStatus(userId, { friends, sentRequests, receivedRequests }) {
  if (friends.has(userId)) return 'friends';
  const sent = sentRequests.get(userId);
  if (sent && sent.status === 'pending') return 'pending_sent';
  const received = receivedRequests.get(userId);
  if (received && received.status === 'pending') return 'pending_received';
  return 'none';
}

// ══════════════════════════════════════════
//  FEED LIKES AGGREGATION
// ══════════════════════════════════════════

export function aggregateLikes(likesData, logIds, currentUserId) {
  const feedLikes = {};
  logIds.forEach(id => feedLikes[id] = { count: 0, liked: false });
  (likesData || []).forEach(l => {
    if (feedLikes[l.log_id]) {
      feedLikes[l.log_id].count++;
      if (l.user_id === currentUserId) feedLikes[l.log_id].liked = true;
    }
  });
  return feedLikes;
}

export function aggregateCommentCounts(commentData) {
  const counts = {};
  (commentData || []).forEach(c => { counts[c.log_id] = (counts[c.log_id] || 0) + 1; });
  return counts;
}

// ══════════════════════════════════════════
//  COLLECTION VALUE CHART DATA
// ══════════════════════════════════════════

export function computeCollectionValuePoints(watches) {
  let cum = 0;
  const wWithDate = watches
    .filter(w => w.purchaseDate && w.price)
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));
  return wWithDate.map(w => {
    cum += w.price;
    return { x: w.purchaseDate, y: cum, label: w.brand + ' ' + w.name, price: w.price };
  });
}

// ══════════════════════════════════════════
//  DAY-OF-WEEK REPORT (pure computation)
// ══════════════════════════════════════════

export function computeDowReport(logs, watches) {
  const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return DOW_NAMES.map((dayName, dow) => {
    const dayLogs = logs.filter(l => new Date(l.date + 'T12:00:00').getDay() === dow);
    if (!dayLogs.length) return { dayName, dow, w: null, cnt: 0, total: 0 };
    const wm = {}; dayLogs.forEach(l => { wm[l.watchId] = (wm[l.watchId] || 0) + 1; });
    const topId = Object.keys(wm).sort((a, b) => wm[b] - wm[a])[0];
    return { dayName, dow, w: watches.find(x => x.id === topId) || null, cnt: wm[topId], total: dayLogs.length };
  });
}

// ══════════════════════════════════════════
//  AUTO-SUGGEST TAGS (pure pattern matching)
// ══════════════════════════════════════════

export function autoSuggestTags(brand, name, ref) {
  const t = `${brand} ${name} ${ref || ''}`.toLowerCase();
  const r = [];
  if (/sub(mariner)?|dive|aqua|sea|marine|diver|fathom/.test(t)) r.push('Dive');
  if (/chrono(graph)?/.test(t)) r.push('Chronograph');
  if (/\bgmt\b|dual.?time/.test(t)) r.push('GMT');
  if (/pilot|aviator|navitimer|fli[ei]ger/.test(t)) r.push('Pilot');
  if (/\bfield\b|military/.test(t)) r.push('Field');
  if (/dress|calatrava|\btank\b|senator|datejust/.test(t)) r.push('Dress');
  if (/skeleton|squelette/.test(t)) r.push('Skeleton');
  if (/vintage/.test(t)) r.push('Vintage');
  if (/tourbillon|perpetual|moonphase|complication/.test(t)) r.push('Complication');
  if (/aquanaut|nautilus|royal.?oak|sport.?lux/.test(t)) r.push('Sport-Luxury');
  else if (/sport/.test(t)) r.push('Sport');
  return r;
}

// ══════════════════════════════════════════
//  OEM STRAP GUESSER (pure pattern matching)
// ══════════════════════════════════════════

export function guessOEMStrap(w) {
  const ref   = (w.ref   || '').toLowerCase();
  const brand = (w.brand || '').toLowerCase();
  const name  = (w.name  || '').toLowerCase();

  // Specific ref matches
  if (ref.includes('77451or') || ref.includes('1361or'))
    return { name: 'Integrated Pink Gold Bracelet', material: '18K Pink Gold' };
  if (ref.includes('26715st') || ref.includes('1356st'))
    return { name: 'Integrated Steel Bracelet', material: 'Steel' };
  if (ref.includes('5010') && (ref.includes('b64') || brand.includes('blancpain')))
    return { name: 'Black Rubber Strap', material: 'Rubber' };
  if (ref.includes('77605ok') || ref.includes('a101ca'))
    return { name: 'Grey Rubber Strap', material: 'Rubber' };
  if (brand.includes('kurono') && name.includes('jubilee'))
    return { name: 'Black Calfskin Leather Strap', material: 'Calf Leather' };

  // Brand + model keyword fallbacks
  if (brand.includes('audemars')) {
    if (name.includes('offshore'))  return { name: 'Rubber Strap', material: 'Rubber' };
    if (name.includes('royal oak')) return { name: 'Integrated Steel Bracelet', material: 'Steel' };
  }
  if (brand.includes('blancpain') && (name.includes('fathom') || name.includes('fifty')))
    return { name: 'Rubber Strap', material: 'Rubber' };
  if (brand.includes('rolex')) {
    if (name.includes('cellini') || name.includes('day-date'))
      return { name: 'Leather Strap', material: 'Leather' };
    return { name: 'Oyster Bracelet', material: 'Steel' };
  }
  if (brand.includes('omega')) {
    if (name.includes('de ville')) return { name: 'Leather Strap', material: 'Leather' };
    return { name: 'Metal Bracelet', material: 'Steel' };
  }
  if (brand.includes('tudor')) {
    if (name.includes('black bay') || name.includes('pelagos')) return { name: 'Fabric Strap', material: 'Fabric' };
    return { name: 'Steel Bracelet', material: 'Steel' };
  }
  if (brand.includes('tag heuer')) return { name: 'Rubber Strap', material: 'Rubber' };
  if (brand.includes('patek')) {
    if (name.includes('aquanaut') || name.includes('nautilus')) return { name: 'Rubber Strap', material: 'Rubber' };
    return { name: 'Leather Strap', material: 'Leather' };
  }
  if (brand.includes('cartier') || brand.includes('vacheron') || brand.includes('jaeger'))
    return { name: 'Leather Strap', material: 'Leather' };
  if (brand.includes('iwc')) {
    if (name.includes('aquatimer')) return { name: 'Rubber Strap', material: 'Rubber' };
    return { name: 'Leather Strap', material: 'Leather' };
  }
  if (brand.includes('panerai'))  return { name: 'Leather Strap', material: 'Leather' };
  if (brand.includes('grand seiko') || brand.includes('seiko') || brand.includes('orient'))
    return { name: 'Leather Strap', material: 'Leather' };

  // Generic name-keyword fallback
  if (/sub(mariner)?|dive|diver|fathom|pelagos|aqua/.test(name))
    return { name: 'Rubber Strap', material: 'Rubber' };
  if (/pilot|aviator|field|explorer/.test(name))
    return { name: 'Leather Strap', material: 'Leather' };

  return null;
}

// ══════════════════════════════════════════
//  BOX & PAPERS HTML (pure formatter)
// ══════════════════════════════════════════

export function boxPapersHTML(w) {
  const b = w.hasBox, p = w.hasPapers;
  if (!b && !p) return '';
  if (b === 'yes' && p === 'yes')
    return `<div class="bp-indicator"><span class="bp-item-yes">Box &amp; Papers</span></div>`;
  const parts = [];
  if      (b === 'yes') parts.push(`<span class="bp-item-yes">Box</span>`);
  else if (b === 'no')  parts.push(`<span class="bp-item-no">No Box</span>`);
  if      (p === 'yes') parts.push(`<span class="bp-item-yes">Papers</span>`);
  else if (p === 'no')  parts.push(`<span class="bp-item-no">No Papers</span>`);
  return parts.length ? `<div class="bp-indicator">${parts.join('<span style="color:var(--border)"> · </span>')}</div>` : '';
}

// ══════════════════════════════════════════
//  WARRANTY BADGE HTML (pure formatter)
// ══════════════════════════════════════════

export function warrantyBadgeHTML(w, today = new Date()) {
  const ws = warrantyStatus(w, today);
  if (!ws) return '';
  return `<div class="warranty-badge ${ws.cls}">${ws.text}</div>`;
}

// ══════════════════════════════════════════
//  MARKET PRICE ROW HTML (pure formatter)
// ══════════════════════════════════════════

export function marketPriceRowHTML(w) {
  const mp = w.marketPrice;
  if (!mp) return '';
  const delta = w.price ? mp - w.price : null;
  const pct   = delta != null && w.price ? (delta / w.price * 100).toFixed(0) : null;
  const sign  = delta >= 0 ? '+' : '-';
  const deltaHTML = delta != null
    ? `<span class="mp-delta ${delta >= 0 ? 'mp-up' : 'mp-down'}">${sign}${fmtMoney(Math.abs(delta))} (${sign}${Math.abs(pct)}%)</span>`
    : '';
  const srcParts = [w.marketPriceSrc, w.marketPriceDate ? fmtDate(w.marketPriceDate) : ''].filter(Boolean);
  const srcHTML = srcParts.length ? `<span class="mp-src">${srcParts.join(' · ')}</span>` : '';
  return `<div class="market-price-row">
    <span class="mp-label">Market</span>
    <span class="mp-value">${fmtMoney(mp)}</span>
    ${deltaHTML}
    ${srcHTML}
  </div>`;
}
