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
export function escAttr(s) {
  return escHtml(s).replace(/'/g, '&#39;');
}

export function profileInitials(p) {
  if (!p) return '?';
  const name = (p.display_name || p.username || '').trim();
  const parts = name.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || '?';
}

export function formatFeedDate(dateStr, createdAt, now = new Date()) {
  if (!dateStr) return '';
  // If we have a full timestamp try relative time within 18 h
  const tsStr = createdAt || ((dateStr.includes('T') || dateStr.includes('Z')) ? dateStr : null);
  if (tsStr) {
    const diffH = (now - new Date(tsStr)) / 3600000;
    if (diffH < 1)  return 'Just now';
    if (diffH < 18) return `${Math.floor(diffH)}h ago`;
  }
  // Fall back to day-level comparison
  const todayNorm = new Date(now); todayNorm.setHours(0, 0, 0, 0);
  const d = (dateStr.includes('T') || dateStr.includes('Z'))
    ? new Date(dateStr)
    : new Date(dateStr + 'T00:00:00');
  const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
  const diff = Math.round((todayNorm - dayStart) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7)  return `${diff} day${diff === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatCommentTime(createdAt, now = new Date()) {
  if (!createdAt) return '';
  const ts  = new Date(createdAt);
  const diffMs = now - ts;
  const diffM  = Math.floor(diffMs / 60000);
  if (diffM < 1)  return 'Just now';
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7)  return `${diffD}d ago`;
  return ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  };
}

export function logToRow(l, userId) {
  const vis = l.visibility || 'public';
  return {
    id: l.id, user_id: userId, watch_id: l.watchId,
    date: l.date, use_case: l.useCase || 'unspecified',
    notes: l.notes || null, strap_id: l.strapId || null,
    photo_url: l.photoUrl || null,
    visibility: vis,
    club_id: l.clubId || null,
  };
}

export function rowToLog(r) {
  return {
    id: r.id, watchId: r.watch_id, date: r.date,
    useCase: r.use_case || 'unspecified', notes: r.notes || null,
    strapId: r.strap_id || null, photoUrl: r.photo_url || null,
    visibility: r.visibility || 'public',
    clubId: r.club_id || null,
  };
}

export function wishToRow(w, userId, idx) {
  return {
    id: w.id, user_id: userId,
    brand: w.brand || null, name: w.name || null, ref: w.ref || null,
    price: w.price || null, url: w.url || null, image: w.image || null,
    notes: w.notes || null, color: w.color || null, tags: w.tags || [],
    market_price: w.marketPrice || null, market_price_date: w.marketPriceDate || null,
    market_price_src: w.marketPriceSrc || null, watch_charts_url: w.watchChartsUrl || null,
    wish_privacy: w.wishPrivacy || null,
    added_date: w.addedDate || null,
    sort_order: typeof idx === 'number' ? idx : (w._rank ?? 0),
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
    _rank: r.sort_order ?? 0,
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
  const n = watchList.length;
  const totalPairs = n * (n - 1) / 2;
  const cap = Math.min(totalPairs, n * 3);  // cap at 3× collection size

  if (cap >= totalPairs) {
    // Small collection — generate all pairs, shuffle
    const pairs = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        pairs.push({ aId: watchList[i].id, bId: watchList[j].id });
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    return pairs;
  }
  // Large collection — sample random unique pairs
  const seen = new Set();
  const pairs = [];
  while (pairs.length < cap) {
    const a = Math.floor(Math.random() * n);
    let b = Math.floor(Math.random() * (n - 1));
    if (b >= a) b++;
    const key = a < b ? a * n + b : b * n + a;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ aId: watchList[a].id, bId: watchList[b].id });
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

const DEFAULT_REC_SETTINGS = { excluded: [], prioritizeUnworn: true, anniversaryPicks: true, weatherMatch: true, useCaseMatch: true };
export { DEFAULT_REC_SETTINGS };

export function computeWatchRec({ watches, logs, weatherData, skipSet, eloRatings = {}, recSettings = DEFAULT_REC_SETTINGS, now = new Date() }) {
  if (!watches.length) return null;
  const rs = { ...DEFAULT_REC_SETTINGS, ...recSettings };
  const excludedSet = new Set(rs.excluded || []);
  const today = todayStr(now);
  const todayDOW = now.getDay();
  const isWeekend = todayDOW === 0 || todayDOW === 6;

  // Tag-to-occasion mapping for smarter tag matching
  const WORK_TAGS   = new Set(['Dress','Chronograph','GMT','Complication']);
  const CASUAL_TAGS = new Set(['Daily Beater','Field','Sport','Dive','Pilot']);
  const DRESSY_TAGS = new Set(['Dress','Sport-Luxury','Complication','Skeleton','Vintage']);

  // Fair-share baseline: expected wears per watch if collection were rotated evenly
  const totalLogs = logs.length;
  const fairShare = watches.length > 0 ? totalLogs / watches.length : 0;

  const candidates = watches.map(w => {
    if (skipSet && skipSet.has(w.id)) return null;
    if (excludedSet.has(w.id)) return null;
    const wLogs = logs.filter(l => l.watchId === w.id);

    // Single pass over logs: check today, find last date, count DOW matches, count use cases
    let wornToday = false, lastDate = '', dowCount = 0;
    let dinnerWears = 0, workWears = 0, leisureWears = 0, travelWears = 0;
    for (let i = 0; i < wLogs.length; i++) {
      const l = wLogs[i];
      if (l.date === today) { wornToday = true; break; }
      if (l.date > lastDate) lastDate = l.date;
      if (new Date(l.date + 'T12:00:00').getDay() === todayDOW) dowCount++;
      if (l.useCase === 'dinner') dinnerWears++;
      else if (l.useCase === 'work') workWears++;
      else if (l.useCase === 'leisure') leisureWears++;
      else if (l.useCase === 'travel') travelWears++;
    }
    if (wornToday) return null;
    const daysSince = lastDate ? Math.floor((now - new Date(lastDate + 'T12:00:00')) / 86400000) : 999;

    // 1. Recency (capped at 90)
    const recencyScore = Math.min(daysSince, 90);

    // 2. Day-of-week habit matching
    const dowScore = dowCount * 8;

    // 3. Weather × color matching
    let weatherScore = 0, weatherReason = null;
    if (rs.weatherMatch && weatherData) {
      const isWarm = WARM.has(w.color), isCool = COOL.has(w.color), isDark = DARK.has(w.color);
      if (weatherData.condition === 'sunny' && isWarm) { weatherScore = 3; weatherReason = 'Warm tone for sunny skies'; }
      else if (weatherData.condition === 'sunny' && isCool) { weatherScore = 1; }
      else if ((weatherData.condition === 'cloudy' || weatherData.condition === 'rainy') && (isCool || isDark)) { weatherScore = 3; weatherReason = `Cool tone suits today's ${weatherData.condition} skies`; }
    }

    // 4. Weekend/dinner bonus
    const hasDressTag = (w.tags || []).includes('Dress');
    const weekendScore = isWeekend ? Math.min(dinnerWears * 5 + (hasDressTag ? 10 : 0), 30) : 0;
    const weekendReason = isWeekend && (dinnerWears > 0 || hasDressTag)
      ? (hasDressTag && dinnerWears === 0 ? 'Dress watch — perfect for the weekend' : `Worn to dinner ${dinnerWears}× — great for the weekend`)
      : null;

    // 5. Elo ranking boost (0-20 pts)
    let eloScore = 0, eloReason = null;
    const elo = eloRatings[w.id];
    if (elo != null) {
      eloScore = Math.max(0, Math.min(Math.round((elo - ELO_DEFAULT) / 10), 20));
      if (eloScore >= 10) eloReason = 'One of your top-ranked watches';
    }

    // 6. Use case × day type matching
    let useCaseScore = 0, useCaseReason = null;
    const totalUC = workWears + leisureWears + dinnerWears + travelWears;
    if (rs.useCaseMatch && totalUC > 0) {
      if (!isWeekend) {
        const workRatio = workWears / totalUC;
        useCaseScore = Math.round(workRatio * 15);
        if (workRatio >= 0.5 && workWears >= 3) useCaseReason = 'Your go-to work watch';
      } else {
        const leisureRatio = (leisureWears + dinnerWears) / totalUC;
        useCaseScore = Math.round(leisureRatio * 15);
        if (leisureRatio >= 0.5 && (leisureWears + dinnerWears) >= 3) useCaseReason = 'A weekend favorite';
      }
    }

    // 7. Honeymoon boost for recently purchased watches
    let honeymoonScore = 0, honeymoonReason = null;
    if (w.purchaseDate) {
      const daysSincePurchase = Math.floor((now - new Date(w.purchaseDate + 'T12:00:00')) / 86400000);
      if (daysSincePurchase <= 30 && daysSincePurchase >= 0) {
        honeymoonScore = 20;
        honeymoonReason = 'New addition — break it in!';
      } else if (daysSincePurchase <= 60 && daysSincePurchase > 30) {
        honeymoonScore = 10;
        honeymoonReason = 'Still getting to know this one';
      }
    }

    // 8. Neglected watch nudge
    let neglectedScore = 0, neglectedReason = null;
    if (rs.prioritizeUnworn && fairShare > 2 && wLogs.length < fairShare * 0.4) {
      neglectedScore = Math.min(Math.round((fairShare - wLogs.length) * 2), 25);
      if (wLogs.length === 0) neglectedReason = 'Never worn — give it a chance';
      else neglectedReason = 'Underrepresented in your rotation';
    }

    // 9. Tag-based occasion matching
    let tagScore = 0, tagReason = null;
    const wTags = new Set(w.tags || []);
    if (wTags.size > 0) {
      if (!isWeekend) {
        for (const t of wTags) {
          if (WORK_TAGS.has(t)) { tagScore = Math.max(tagScore, 8); }
          if (CASUAL_TAGS.has(t) && workWears === 0) { tagScore = Math.max(tagScore, 3); }
        }
        if (tagScore >= 8) tagReason = 'Tagged for the office';
      } else {
        for (const t of wTags) {
          if (CASUAL_TAGS.has(t)) { tagScore = Math.max(tagScore, 8); }
          if (DRESSY_TAGS.has(t)) { tagScore = Math.max(tagScore, 6); }
        }
        if (tagScore >= 8) tagReason = 'Perfect weekend watch';
        else if (tagScore >= 6) tagReason = 'Dress it up this weekend';
      }
    }

    // 10. Anniversary override
    let anniversaryScore = 0, anniversaryReason = null, anniversaryYears = 0;
    if (rs.anniversaryPicks && w.purchaseDate) {
      const pd = new Date(w.purchaseDate + 'T12:00:00');
      if (pd.getMonth() === now.getMonth() && pd.getDate() === now.getDate()) {
        anniversaryYears = now.getFullYear() - pd.getFullYear();
        if (anniversaryYears >= 1) {
          anniversaryScore = 9999; // force to top
          anniversaryReason = `${anniversaryYears} year${anniversaryYears !== 1 ? 's' : ''} in your collection today`;
        }
      }
    }

    const score = recencyScore + dowScore + weatherScore * 5 + weekendScore
                + eloScore + useCaseScore + honeymoonScore + neglectedScore + tagScore + anniversaryScore;
    return { w, daysSince, dowCount, weatherScore, weatherReason, weekendScore, weekendReason,
             eloScore, eloReason, useCaseScore, useCaseReason,
             honeymoonScore, honeymoonReason, neglectedScore, neglectedReason,
             tagScore, tagReason, anniversaryScore, anniversaryReason, anniversaryYears, score };
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
    ...(formData.image ? { image: formData.image } : {}),
  };

  // Market price logic
  const manualMp = formData.manualMp || 0;

  if (manualMp) {
    data.marketPrice = manualMp;
    data.marketPriceDate = todayFn();
    data.marketPriceSrc = 'User Entry';
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

/**
 * Compute the set of user IDs who are mutual friends with currentUserId.
 * A friendship is active when BOTH sides of the friend_request row are verified
 * AND the current user follows the other person (mutual-follow prerequisite).
 *
 * @param {Array}  friendRequests  - array of friend_request rows from DB
 *                                   each row: { initiator_id, target_id,
 *                                               initiator_verified, target_verified }
 * @param {Set}    followingSet    - set of user IDs the current user follows
 * @param {string} currentUserId  - the current user's ID
 * @returns {Set<string>}
 */
export function computeFriendships(friendRequests, followingSet, currentUserId) {
  const friendships = new Set();
  for (const r of friendRequests) {
    if (r.status === 'accepted') {
      const otherId = r.initiator_id === currentUserId ? r.target_id : r.initiator_id;
      if (followingSet.has(otherId)) friendships.add(otherId);
    }
  }
  return friendships;
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
  const srcHTML = w.marketPriceDate ? `<span class="mp-src">${fmtDate(w.marketPriceDate)}</span>` : '';
  return `<div class="market-price-row" onclick="openEditWatch('${w.id}')">
    <span class="mp-label">Market</span>
    <span class="mp-value">${fmtMoney(mp)}</span>
    ${deltaHTML}
    ${srcHTML}
  </div>`;
}

// ══════════════════════════════════════════
//  @MENTION HELPERS
// ══════════════════════════════════════════

/**
 * Given a text input element, return the @-query string immediately before
 * the cursor (e.g. "jo" if the text before cursor ends in "@jo"), or null
 * if the cursor is not in an active mention context.
 */
export function getMentionQuery(inputValue, cursorPos) {
  const before = inputValue.slice(0, cursorPos);
  const m = before.match(/@([\w.]*)$/);
  return m ? m[1] : null;
}

/**
 * Extract all @mentioned usernames from a comment body string.
 * Returns a de-duped array of username strings (without the @).
 */
export function extractMentionedUsernames(text) {
  if (!text) return [];
  return [...new Set((text.match(/@([\w.]+)/g) || []).map(m => m.slice(1)))];
}

/**
 * Render a comment body: escapes HTML then wraps @username tokens in
 * a clickable <span class="mention-link"> element.
 * onClickFn is a string like "viewUserByUsername" injected into onclick.
 */
export function renderCommentBody(body, onClickFn = 'viewUserByUsername') {
  if (!body) return '';
  return escHtml(body).replace(/@([\w.]+)/g, (match, username) =>
    `<span class="mention-link" onclick="${onClickFn}('${escAttr(username)}')">@${escHtml(username)}</span>`
  );
}

// ══════════════════════════════════════════
//  NOTIFICATION HELPERS
// ══════════════════════════════════════════

/**
 * Returns the human-readable body text for a notification.
 * actorName is the display_name or username of the actor.
 */
export function notificationBody(type, actorName) {
  const nm = actorName || 'Someone';
  switch (type) {
    case 'follow_request':     return `${nm} wants to follow you`;
    case 'follow_accepted':    return `${nm} accepted your follow request`;
    case 'follow':             return `${nm} started following you`;
    case 'like':               return `${nm} liked your post`;
    case 'comment':            return `${nm} commented on your post`;
    case 'comment_also':       return `${nm} also commented on a post you liked or commented on`;
    case 'comment_like':       return `${nm} liked your comment`;
    case 'mention':            return `${nm} mentioned you in a comment`;
    case 'club_join_request':  return `${nm} wants to join your club`;
    case 'club_join_accepted': return `${nm} approved your club request`;
    case 'club_invite':        return `${nm} invited you to join a club`;
    case 'club_promoted':        return `${nm} made you an owner of a club`;
    case 'friend_request':       return `${nm} wants to be close friends`;
    case 'friend_accepted':      return `You and ${nm} are now close friends`;
    default:                     return '';
  }
}

/**
 * Returns true for notification types that have Accept/Decline action buttons
 * and must NOT be auto-marked as read when the panel opens.
 */
export function notificationIsActionable(type) {
  return type === 'follow_request' || type === 'club_join_request' || type === 'club_invite' || type === 'friend_request';
}

/**
 * Returns true for types that tap-navigate to a feed post via scrollToFeedPost.
 * ref_id for these is a log/post ID.
 */
export function notificationScrollsToPost(type) {
  return type === 'like' || type === 'comment' || type === 'comment_also' || type === 'comment_like' || type === 'mention';
}

/**
 * Returns true for types that tap-navigate to a club detail view.
 * ref_id for these is a club ID.
 */
export function notificationOpensClub(type) {
  return type === 'club_join_accepted' || type === 'club_promoted';
}

/**
 * Returns true for types that tap-navigate to the actor's profile.
 */
export function notificationOpensProfile(type) {
  return type === 'follow' || type === 'follow_accepted'
      || type === 'friend_accepted';
}

/**
 * Returns true for types that must include a ref_id when inserted.
 * Follow types don't need one; all feed + club types do.
 */
export function notificationRequiresRefId(type) {
  return notificationScrollsToPost(type) || notificationOpensClub(type) || type === 'club_invite' || type === 'club_join_request';
}

/**
 * Format the bell badge count. Returns '9+' for counts over 9,
 * the count as a string for 1-9, and null (hidden) for 0 or below.
 */
export function formatBadgeCount(n) {
  if (n <= 0) return null;
  return n > 9 ? '9+' : String(n);
}

/**
 * Compute the set of user IDs that should receive a `comment_also` notification
 * when a new comment is posted. Excludes the current commenter and the post owner
 * (who gets a separate `comment` notification).
 */
export function buildCommentAlsoTargets(likerIds, commenterIds, currentUserId, postOwnerId) {
  return [...new Set([...likerIds, ...commenterIds])].filter(
    uid => uid !== currentUserId && uid !== postOwnerId
  );
}

// ══════════════════════════════════════════
//  RESILIENCE UTILITIES
// ══════════════════════════════════════════

/**
 * Safely parse JSON from a string. Returns fallback on parse failure.
 * Used for localStorage reads that may contain corrupted data.
 */
export function safeParseJSON(str, fallback = null) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

/**
 * Add one or more IDs to a dirty-tracking Set.
 * id can be a single string or an array of strings.
 */
export function markDirty(dirtyState, type, id) {
  const s = dirtyState[type];
  if (!s) return;
  if (Array.isArray(id)) id.forEach(i => s.add(i));
  else s.add(id);
}

/**
 * Filter an array of items to only those whose .id is in the dirtyIds set/array.
 * Used by cloudSync to upsert only changed items.
 */
export function filterDirtyItems(items, dirtyIds) {
  const idSet = dirtyIds instanceof Set ? dirtyIds : new Set(dirtyIds);
  return items.filter(item => idSet.has(item.id));
}

/**
 * Determine if a Supabase query error indicates auth expiry,
 * meaning notification polling should be stopped.
 */
export function shouldStopNotifPolling(error) {
  if (!error) return false;
  if (error.code === 'PGRST301') return true;
  if (error.status === 401) return true;
  if (error.message && error.message.includes('JWT')) return true;
  return false;
}

// ══════════════════════════════════════════
//  CONTENT FILTERING
// ══════════════════════════════════════════

const OBJECTIONABLE_PATTERNS = [
  /\b(?:f+[u*]+[c*]+[k*]+|sh[i*]+[t*]+|a[s*]+h[o*]+le|b[i*]+tch|d[i*]+ck|c[u*]+nt)\b/i,
  /\b(?:kill\s+your|go\s+die|kys|stfu)\b/i,
  /\b(?:buy\s+now|click\s+here|free\s+money|act\s+now)\b/i,
  /\b(?:n[i1]+[gq]+[e3]*r|f+[a@]+[gq]+[o0]*t|tr[a@]+nn)/i,
];

/**
 * Check if text contains objectionable content.
 * Returns { clean: boolean, matches: string[] }
 */
export function checkContent(text) {
  if (!text) return { clean: true, matches: [] };
  const matches = [];
  for (const pattern of OBJECTIONABLE_PATTERNS) {
    const m = text.match(pattern);
    if (m) matches.push(m[0]);
  }
  return { clean: matches.length === 0, matches };
}

// ── Timegrapher ──

/**
 * Compute timegrapher results from an array of tick timestamps.
 * @param {number[]} ticks - Array of tick timestamps in ms (e.g., performance.now() values)
 * @param {number} bph - Beats per hour (e.g., 28800)
 * @returns {{ rate: number|null, beatError: number|null, tickCount: number }}
 */
export function computeTgResults(ticks, bph) {
  if (ticks.length < 2) return { rate: null, beatError: null, tickCount: ticks.length, debug: 'Need more ticks' };
  const expectedInterval = 3600000 / bph;
  const intervals = [];
  for (let i = 1; i < ticks.length; i++) intervals.push(ticks[i] - ticks[i - 1]);

  // Two-pass filtering:
  // Pass 1: Keep intervals within generous range (0.3x–3x expected)
  let filtered = intervals.filter(iv => iv > expectedInterval * 0.3 && iv < expectedInterval * 3);

  // If strict filter fails, try statistical approach (IQR-based)
  if (filtered.length < 2) {
    const sorted = [...intervals].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    filtered = intervals.filter(iv => iv >= q1 - 1.5 * iqr && iv <= q3 + 1.5 * iqr);
  }

  const sorted = [...intervals].sort((a, b) => a - b);
  const medianIv = sorted[Math.floor(sorted.length / 2)];
  const debug = `${intervals.length} ivs, median=${Math.round(medianIv)}ms, kept=${filtered.length}`;

  if (filtered.length < 2) return { rate: null, beatError: null, tickCount: ticks.length, debug };

  const avgInterval = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  const rate = ((avgInterval - expectedInterval) / expectedInterval) * 86400;
  let beatError = null;
  if (filtered.length >= 4) {
    const odds = filtered.filter((_, i) => i % 2 === 0);
    const evens = filtered.filter((_, i) => i % 2 === 1);
    if (odds.length && evens.length) {
      const avgOdd = odds.reduce((a, b) => a + b, 0) / odds.length;
      const avgEven = evens.reduce((a, b) => a + b, 0) / evens.length;
      beatError = Math.abs(avgOdd - avgEven);
    }
  }
  return { rate: Math.round(rate * 10) / 10, beatError: beatError !== null ? Math.round(beatError * 100) / 100 : null, tickCount: ticks.length, debug };
}

// ══════════════════════════════════════════
//  SEARCH & INPUT SANITIZATION
// ══════════════════════════════════════════

export function sanitizeSearch(s) {
  return (s || '').replace(/[%_(),.*\\]/g, '').trim();
}

// ══════════════════════════════════════════
//  IMAGE / URL UTILITIES
// ══════════════════════════════════════════

export function sanitizeImageUrl(url, baseUrl) {
  if (!url) return null;
  url = url.trim();
  if (url.startsWith('//'))    return 'https:' + url;
  if (url.startsWith('/'))     return new URL(baseUrl).origin + url;
  if (url.startsWith('https://')) return url;
  // Block javascript:, data:, http:, and anything else
  return null;
}

export function isBase64(str) { return !!(str && str.startsWith('data:')); }

export function storagePathFrom(url) {
  if (!url) return null;
  const marker = '/storage/v1/object/public/media/';
  const idx = url.indexOf(marker);
  return idx >= 0 ? url.slice(idx + marker.length) : null;
}

// ══════════════════════════════════════════
//  DEVICE CLASSIFICATION
// ══════════════════════════════════════════

export function classifyDevice(ua) {
  if (!ua) return 'unknown';
  if (/Mobile|iPhone|iPod|Android.*Mobile|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return 'mobile';
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return 'tablet';
  return 'desktop';
}

// ══════════════════════════════════════════
//  WATCH IDENTIFICATION MATCHING
// ══════════════════════════════════════════

export function matchIdentifiedToCollection(identifiedWatches, watches) {
  const results = [];
  const seen = new Set();
  for (const identified of identifiedWatches) {
    const idBrand = (identified.brand || '').toLowerCase().trim();
    const idModel = (identified.model || '').toLowerCase().trim();
    const idRef = (identified.reference || '').toLowerCase().trim().replace(/[\s\-]/g, '');
    // Tier 1: exact reference match
    if (idRef) {
      for (const w of watches) {
        const wRef = (w.ref || '').toLowerCase().trim().replace(/[\s\-]/g, '');
        if (wRef && wRef === idRef && !seen.has(w.id)) {
          results.push({ watch: w, matchType: 'reference', confidence: identified.confidence || 'high' });
          seen.add(w.id);
        }
      }
    }
    // Tier 2: brand + model name match
    if (idBrand && idModel) {
      const idWords = idModel.split(/\s+/).filter(Boolean);
      for (const w of watches) {
        if (seen.has(w.id)) continue;
        const wBrand = (w.brand || '').toLowerCase().trim();
        const wName = (w.name || '').toLowerCase().trim();
        if (wBrand !== idBrand) continue;
        const wWords = wName.split(/\s+/).filter(Boolean);
        const idInW = idWords.every(word => wWords.includes(word));
        const wInId = wWords.every(word => idWords.includes(word));
        if (idInW || wInId) {
          results.push({ watch: w, matchType: 'brand+model', confidence: identified.confidence || 'medium' });
          seen.add(w.id);
        }
      }
    }
    // Tier 2.5: dial text match
    const idDial = (identified.dialText || '').toLowerCase().trim();
    if (idDial && idBrand) {
      const dialWords = idDial.split(/[\s,;.·]+/).filter(w => w.length > 1);
      for (const w of watches) {
        if (seen.has(w.id)) continue;
        const wBrand = (w.brand || '').toLowerCase().trim();
        if (wBrand !== idBrand) continue;
        const wName = (w.name || '').toLowerCase().trim();
        const nameWords = `${wBrand} ${wName}`.split(/\s+/).filter(w => w.length > 1);
        const matchCount = nameWords.filter(nw => dialWords.some(dw => dw.includes(nw) || nw.includes(dw))).length;
        if (matchCount >= 2 && matchCount >= nameWords.length * 0.5) {
          results.push({ watch: w, matchType: 'dial-text', confidence: identified.confidence || 'medium' });
          seen.add(w.id);
        }
      }
    }
    // Tier 3: brand-only if exactly one watch of that brand
    if (idBrand && results.length === 0) {
      const brandMatches = watches.filter(w => (w.brand || '').toLowerCase().trim() === idBrand && !seen.has(w.id));
      if (brandMatches.length === 1) {
        results.push({ watch: brandMatches[0], matchType: 'brand-only', confidence: 'low' });
        seen.add(brandMatches[0].id);
      }
    }
  }
  const typeOrder = { 'reference': 0, 'brand+model': 1, 'dial-text': 1.5, 'brand-only': 2 };
  const confOrder = { 'high': 0, 'medium': 1, 'low': 2 };
  results.sort((a, b) => (typeOrder[a.matchType] - typeOrder[b.matchType]) || (confOrder[a.confidence] - confOrder[b.confidence]));
  return results;
}

// ══════════════════════════════════════════
//  ASYNC UTILITIES
// ══════════════════════════════════════════

export function withTimeout(promise, ms = 10000) {
  let tid;
  return Promise.race([
    promise,
    new Promise((_, rej) => { tid = setTimeout(() => rej(new Error('Query timed out')), ms); })
  ]).finally(() => clearTimeout(tid));
}

// ══════════════════════════════════════════
//  WATCHCHARTS URL UTILITIES
// ══════════════════════════════════════════

export function normalizeWatchChartsUrl(url) {
  return url.replace(/\/(overview|prices|history|specs|charts?)(\?.*)?$/, '').replace(/\/$/, '');
}

export function extractMarketPriceFromHtml(html) {
  const fastMatch = html.match(/Market Price\.\s*\$([\d,]+)/);
  if (fastMatch) {
    const price = parseInt(fastMatch[1].replace(/,/g, ''), 10);
    if (price > 100 && price < 10_000_000) return { price, src: 'WatchCharts' };
  }
  return null;
}

export function buildWatchSearchQueries(brand, name, ref) {
  const queries = [];
  if (ref && ref.trim()) {
    queries.push(ref.trim());
  }
  if (!queries.length) {
    const nameWords = name.trim().split(/\s+/);
    queries.push(`${brand} ${nameWords.slice(0, 3).join(' ')}`);
  }
  return queries;
}

export function filterWatchChartsUrls(html, brandKey) {
  const allLinks = [...html.matchAll(/href="(https:\/\/watchcharts\.com\/watch_model\/[^"]+)"/g)]
    .map(m => m[1]);
  const modelUrl = allLinks.find(u => u.toLowerCase().includes(brandKey));
  return modelUrl ? modelUrl.replace(/\/[^/]+$/, '') : null;
}

// ══════════════════════════════════════════
//  BROADCAST EMAIL HELPERS
// ══════════════════════════════════════════

// Build inline image HTML snippet for email
export function imgSnippet(img) {
  return `</div></td></tr><tr><td style="padding:8px 28px;">
    <img src="${escHtml(img.src)}" alt="" style="max-width:100%;border-radius:8px;display:block;">
    ${img.caption ? `<div style="font-size:12px;color:#888;margin-top:4px;text-align:center;">${escHtml(img.caption)}</div>` : ''}
  </td></tr><tr><td style="padding:0 28px;"><div style="font-size:14px;color:#555;line-height:1.6;">`;
}

// Replace [img1], [img2] etc. markers in body HTML with inline images
export function inlineImages(bodyHtml, images) {
  for (let i = 0; i < images.length; i++) {
    const marker = `[img${i + 1}]`;
    if (bodyHtml.includes(marker) && images[i]) {
      bodyHtml = bodyHtml.replace(marker, imgSnippet(images[i]));
    }
  }
  return bodyHtml;
}

// Build share post URL
export function sharePostUrl(logId) {
  return `https://api.wrotate.com/functions/v1/share-post?id=${logId}`;
}
