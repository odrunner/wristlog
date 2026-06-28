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

export function addDaysStr(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00'); // noon-anchored to avoid DST/midnight drift
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function computeStreaks(logs, today) {
  const dates = [...new Set((logs || []).map(l => l.date).filter(Boolean))].sort();
  if (dates.length === 0) return { current: 0, best: 0, status: 'none' };
  const present = new Set(dates);
  let best = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    if (addDaysStr(dates[i - 1], 1) === dates[i]) { run++; best = Math.max(best, run); }
    else run = 1;
  }
  const latest = dates[dates.length - 1];
  const yesterday = addDaysStr(today, -1);
  if (latest !== today && latest !== yesterday) return { current: 0, best, status: 'none' };
  let current = 1, cursor = latest;
  while (present.has(addDaysStr(cursor, -1))) { current++; cursor = addDaysStr(cursor, -1); }
  return { current, best, status: latest === today ? 'active' : 'at_risk' };
}

export function computeStreaksFrozen(logs, today, weekendEarn) {
  const dates = [...new Set((logs || []).map(l => l.date).filter(Boolean))].sort();
  if (dates.length === 0) return { current: 0, best: 0, status: 'none', frozen: [], freezes: 2, restDays: [] };
  const loggedSet = new Set(dates);
  const dow = (s) => new Date(s + 'T12:00:00').getDay();
  const restSet = new Set();
  if (weekendEarn) {
    for (const ds of dates) {
      if (dow(ds) !== 5) continue;
      if (loggedSet.has(addDaysStr(ds, -4)) && loggedSet.has(addDaysStr(ds, -3)) && loggedSet.has(addDaysStr(ds, -2)) && loggedSet.has(addDaysStr(ds, -1))) {
        const sat = addDaysStr(ds, 1), sun = addDaysStr(ds, 2);
        if (!loggedSet.has(sat)) restSet.add(sat);
        if (!loggedSet.has(sun)) restSet.add(sun);
      }
    }
  }
  const nonRest = (a, b) => {
    let n = 0, x = addDaysStr(a, 1);
    while (x < b) { if (!restSet.has(x)) { n += 1; if (n > 1) break; } x = addDaysStr(x, 1); }
    return n;
  };
  const firstNonRest = (a, b) => {
    let x = addDaysStr(a, 1);
    while (x < b) { if (!restSet.has(x)) return x; x = addDaysStr(x, 1); }
    return null;
  };
  const frozen = [];
  let best = 0, runLen = 0, loggedInRun = 0, freezesAvail = 2, lastPresent = null;
  for (const d of dates) {
    if (lastPresent === null) {
      runLen = 1; loggedInRun = 1; freezesAvail = 2;
    } else {
      const nr = nonRest(lastPresent, d);
      if (nr === 0) {
        runLen += 1; loggedInRun += 1;
        if (loggedInRun % 7 === 0 && freezesAvail < 2) freezesAvail += 1;
      } else if (nr === 1 && freezesAvail > 0) {
        frozen.push(firstNonRest(lastPresent, d));
        freezesAvail -= 1; runLen += 2; loggedInRun += 1;
        if (loggedInRun % 7 === 0 && freezesAvail < 2) freezesAvail += 1;
      } else {
        best = Math.max(best, runLen);
        runLen = 1; loggedInRun = 1; freezesAvail = 2;
      }
    }
    lastPresent = d;
    best = Math.max(best, runLen);
  }
  let current, status;
  if (lastPresent === today) { current = runLen; status = 'active'; }
  else if (restSet.has(today)) { current = runLen; status = 'active'; }
  else {
    const nr = nonRest(lastPresent, today);
    if (nr === 0) { current = runLen; status = 'at_risk'; }
    else if (nr === 1 && freezesAvail > 0) {
      frozen.push(firstNonRest(lastPresent, today));
      freezesAvail -= 1; runLen += 1; current = runLen; status = 'at_risk';
    } else { current = 0; status = 'none'; }
  }
  best = Math.max(best, runLen);
  return { current, best, status, frozen, freezes: status === 'none' ? 2 : freezesAvail, restDays: [...restSet] };
}

export function streakChipState(sk, flagOn) {
  if (!flagOn || !sk) return { visible: false, count: null, dim: false, atRisk: false, invite: false };
  if (sk.status === 'active') return { visible: true, count: sk.current, dim: false, atRisk: false, invite: false };
  if (sk.status === 'at_risk') return { visible: true, count: sk.current, dim: true, atRisk: true, invite: false };
  if (sk.status === 'none' && sk.best >= 1) return { visible: true, count: null, dim: true, atRisk: false, invite: true };
  return { visible: false, count: null, dim: false, atRisk: false, invite: false };
}

export function streakCalendarGrid(loggedDates, year, monthIndex, today) {
  const has = (d) => (loggedDates instanceof Set ? loggedDates.has(d) : (loggedDates || []).includes(d));
  const pad = (n) => String(n).padStart(2, '0');
  const startDow = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${pad(monthIndex + 1)}-${pad(d)}`;
    cells.push({ day: d, date, logged: has(date), isToday: date === today, isFuture: date > today });
  }
  return cells;
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
  if (val.length < 2) return { valid: false, clean: val, error: 'At least 2 characters' };
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
    movement: w.movement || null,
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
    year_range: w.yearRange||null, movement_type: w.movementType||null,
    caliber: w.caliber||null, case_material: w.caseMaterial||null,
    case_diameter: w.caseDiameter||null, case_length: w.caseLength||null,
    case_thickness: w.caseThickness||null, weight: w.weight||null,
    water_resistance: w.waterResistance||null, crystal_type: w.crystalType||null,
    gender: w.gender||null, origin: w.origin||null,
    description: w.description||null, background: w.background||null,
    functions: w.functions||null, bph: w.bph||null,
  };
}

export function rowToWatch(r) {
  return {
    id: r.id, brand: r.brand || '', name: r.name || '', ref: r.ref || '',
    movement: r.movement || '',
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
    yearRange: r.year_range||null, movementType: r.movement_type||null,
    caliber: r.caliber||null, caseMaterial: r.case_material||null,
    caseDiameter: r.case_diameter||null, caseLength: r.case_length||null,
    caseThickness: r.case_thickness||null, weight: r.weight||null,
    waterResistance: r.water_resistance||null, crystalType: r.crystal_type||null,
    gender: r.gender||null, origin: r.origin||null,
    description: r.description||null, background: r.background||null,
    functions: r.functions||null, bph: r.bph||null,
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
    badgeRefs: r.badge_refs || null,
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
    movementType: formData.movementType || null,
    caliber: formData.caliber || null,
    caseDiameter: formData.caseDiameter || null,
    caseLength: formData.caseLength || null,
    caseThickness: formData.caseThickness || null,
    caseMaterial: formData.caseMaterial || null,
    crystalType: formData.crystalType || null,
    waterResistance: formData.waterResistance || null,
    weight: formData.weight || null,
    yearRange: formData.yearRange || null,
    gender: formData.gender || null,
    origin: formData.origin || null,
    functions: formData.functions || null,
    description: formData.description || null,
    background: formData.background || null,
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

// Track date picker: which of the Today / Yesterday / Pick chips is active for a
// given date value. Empty value defaults to Today (date is required, seeds today).
export function trackDateChipState(value, today) {
  if (!value || value === today) return 'today';
  if (value === addDaysStr(today, -1)) return 'yesterday';
  return 'pick';
}

// Post composer: the occasion + strap "Details" block appears only when a watch
// is tagged, and never for measurement shares (those are not wears).
export function npShouldShowDetails({ watchId, source }) {
  return !!watchId && source !== 'measurement';
}

// Post composer: resolve the use_case saved for a new post. Measurement shares
// stay 'measurement'; a tagged watch carries the chosen occasion; otherwise the
// post stays 'unspecified' (unchanged from before the harmonize).
export function newPostUseCase({ source, watchId, occasion }) {
  if (source === 'measurement') return 'measurement';
  if (!watchId) return 'unspecified';
  return occasion || 'unspecified';
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
export function notificationBody(type, actorName, opts = {}) {
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
    case 'badge_earned':
      return opts.badgeName
        ? `You earned the ${opts.badgeName} badge 🏅`
        : 'You earned a new badge 🏅';
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
 * Returns true for types that tap-navigate to the badge wall.
 */
export function notificationOpensBadgeWall(type) {
  return type === 'badge_earned';
}

/**
 * Build the bell-inbox rows for a set of newly-earned badges.
 * Self-addressed (recipient = earner) and actor-less, like 'system'.
 * badges: [{ ref, name }]. ref_id is the badge ref as a string.
 */
export function buildBadgeNotificationRows(badges, userId) {
  return (badges || []).map(b => ({
    user_id: userId,
    type: 'badge_earned',
    actor_id: null,
    ref_id: String(b.ref),
    is_read: false,
  }));
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

// Instagram/Strava model: you can delete a comment if you wrote it, or if you
// own the post it's on. Mirrors the RLS DELETE policy on the comments table.
export function canDeleteComment(comment, post, userId) {
  if (!userId || !comment || !post) return false;
  return comment.user_id === userId || post.user_id === userId;
}

// ══════════════════════════════════════════
//  ONBOARDING CHECKLIST STATE
// ══════════════════════════════════════════

export function onboardingChecklistState(earnedRefs) {
  const has = (r) => (earnedRefs instanceof Set ? earnedRefs.has(r) : (earnedRefs || []).includes(r));
  const steps = [
    { key: 'watch',   label: 'Add your first watch',  ref: 1, done: has(1) },
    { key: 'wear',    label: 'Log a wear',            ref: 3, done: has(3) },
    { key: 'measure', label: 'Measure accuracy', ref: 2, done: has(2) },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length };
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
//  BUCKET-RATIO INTERPOLATION (rate from pair deviations)
// ══════════════════════════════════════════

export function computeMedianRate(rates) {
  if (rates.length < 10) return null;
  const sorted = [...rates].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(median * 10) / 10;
}

// ══════════════════════════════════════════
//  ROBUST RATE (quality v2) — stability-gated rate from cumulative-dev stream
// ══════════════════════════════════════════

function _median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Theil-Sen slope+intercept of y vs x. Caps pair count for large N (deterministic stride).
function _theilSen(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0 };
  const slopes = [];
  const maxPairs = 200000;
  const total = (n * (n - 1)) / 2;
  const stride = total > maxPairs ? Math.ceil(total / maxPairs) : 1;
  let k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (stride === 1 || (k++ % stride === 0)) {
        const dx = xs[j] - xs[i];
        if (dx !== 0) slopes.push((ys[j] - ys[i]) / dx);
      }
    }
  }
  const slope = _median(slopes);
  const intercept = _median(xs.map((x, i) => ys[i] - slope * x));
  return { slope, intercept };
}

// Note: `converged` is a hard gate (residualSd<=maxResidualMs etc.); `quality`/`label` is an independent soft score — near thresholds they can disagree, by design.
export function computeRobustRate(samples, bph, opts = {}) { // bph: reserved for future BPH/harmonic checks (not yet used)
  const o = {
    minTicks: 60, convergeSday: 3, maxResidualMs: 2.0, madMult: 4,
    suspectSday: 60, suspectResidualMs: 3, residualRefMs: 3, outlierFloorMs: 5, ...opts,
  };
  const pts = (samples || []).filter(p => p && isFinite(p.t) && isFinite(p.cd));
  const nTicks = pts.length;
  const durationSec = nTicks ? pts[nTicks - 1].t - pts[0].t : 0;
  const weak = {
    rate: null, quality: 0, label: 'weak', nTicks, durationSec,
    residualSd: 0, subWindowDelta: 0, bphSuspect: false, converged: false,
  };
  if (nTicks < o.minTicks) return weak;

  const xs = pts.map(p => p.t), ys = pts.map(p => p.cd);
  let { slope, intercept } = _theilSen(xs, ys);

  // MAD outlier rejection on residuals, then refit.
  let res = ys.map((y, i) => y - (slope * xs[i] + intercept));
  const medRes = _median(res);
  const mad = _median(res.map(r => Math.abs(r - medRes)));
  // Robust scale: MAD-based, but floored (outlierFloorMs) so sparse spikes in an
  // otherwise-clean stream are still rejected — MAD collapses to 0 when fewer than
  // ~half the points are outliers, which is the common real-world case.
  const cutoff = Math.max(o.madMult * 1.4826 * (mad || 0), o.outlierFloorMs);
  const keep = res.map(r => Math.abs(r) <= cutoff);
  let ix = xs.filter((_, i) => keep[i]);
  let iy = ys.filter((_, i) => keep[i]);
  if (ix.length >= 2) ({ slope, intercept } = _theilSen(ix, iy));

  const rate = slope * 86.4;
  const inRes = iy.map((y, i) => y - (slope * ix[i] + intercept));
  const meanRes = inRes.reduce((a, b) => a + b, 0) / (inRes.length || 1);
  const residualSd = Math.sqrt(inRes.reduce((a, b) => a + (b - meanRes) ** 2, 0) / (inRes.length || 1));

  // Sub-window agreement: rate over the last half of the (time) window.
  const halfT = pts[0].t + durationSec / 2;
  const lhx = [], lhy = [];
  for (let i = 0; i < nTicks; i++) if (xs[i] >= halfT) { lhx.push(xs[i]); lhy.push(ys[i]); }
  const rateLastHalf = lhx.length >= 2 ? _theilSen(lhx, lhy).slope * 86.4 : rate;
  const subWindowDelta = Math.abs(rate - rateLastHalf);

  const bphSuspect = Math.abs(rate) > o.suspectSday && residualSd > o.suspectResidualMs;
  const quality = Math.max(0, Math.min(1,
    0.6 * (1 - subWindowDelta / o.convergeSday) + 0.4 * (1 - residualSd / o.residualRefMs)));
  const label = quality >= 0.7 ? 'solid' : quality >= 0.4 ? 'fair' : 'weak';
  const converged = nTicks >= o.minTicks && subWindowDelta <= o.convergeSday && residualSd <= o.maxResidualMs;

  return {
    rate: Math.round(rate * 10) / 10, quality: Math.round(quality * 100) / 100, label,
    nTicks, durationSec: Math.round(durationSec * 10) / 10,
    residualSd: Math.round(residualSd * 1000) / 1000,
    subWindowDelta: Math.round(subWindowDelta * 10) / 10, bphSuspect, converged,
  };
}

// ══════════════════════════════════════════
//  INCREMENTAL-STABILITY SETTLE TEST (quality v2 adaptive stop)
// ══════════════════════════════════════════

// Least-squares slope of cd vs t over [t0,t1], in s/day (slope_ms_per_s * 86.4). null if <8 pts.
export function _q2Ls(pts, t0, t1) {
  let sx = 0, sy = 0, n = 0;
  for (const p of pts) if (p.t >= t0 && p.t <= t1) { sx += p.t; sy += p.cd; n++; }
  if (n < 8) return null;
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0;
  for (const p of pts) if (p.t >= t0 && p.t <= t1) { const dx = p.t - mx; sxx += dx * dx; sxy += dx * (p.cd - my); }
  if (sxx === 0) return null;
  return sxy / sxx * 86.4;
}

// Settled when the from-start LS rate stops moving: |rate[start,t] - rate[start,t-look]| <= eps
// held for `hold` consecutive 1s steps (`look` is a lag on the SAME from-start window, not a rolling
// window). Assumes `samples` are time-ordered. `band` = worst drift across the hold window (error bar).
export function incrSettle(samples, params = {}) {
  const o = { eps: 0.4, look: 20, hold: 8, minTicks: 40, ...params };
  const pts = (samples || []).filter(p => p && isFinite(p.t) && isFinite(p.cd));
  const n = pts.length;
  const lastT = n ? pts[n - 1].t : 0;
  if (n < o.minTicks) return { settled: false, rate: null, band: null, t: lastT, nTicks: n };
  const start = pts[0].t;
  let consec = 0, bandMax = 0;
  for (let t = start + o.look + 1; t <= lastT + 1e-6; t += 1) {
    const a = _q2Ls(pts, start, t);
    const b = _q2Ls(pts, start, t - o.look);
    if (a == null || b == null) { consec = 0; bandMax = 0; continue; }
    const diff = Math.abs(a - b);
    if (diff <= o.eps) {
      consec += 1; bandMax = Math.max(bandMax, diff);
      if (consec >= o.hold) {
        return { settled: true, rate: Math.round(a * 10) / 10, band: Math.round(bandMax * 1000) / 1000, t: Math.round(t * 10) / 10, nTicks: n };
      }
    } else { consec = 0; bandMax = 0; }
  }
  const last = _q2Ls(pts, start, lastT);
  return { settled: false, rate: last == null ? null : Math.round(last * 10) / 10, band: null, t: lastT, nTicks: n };
}

// Effective tickDetectMult: local override (>0) wins, else table value (>0), else default.
export function resolveTdm(override, table, def) {
  const o = parseFloat(override);
  if (isFinite(o) && o > 0) return o;
  const t = parseFloat(table);
  if (isFinite(t) && t > 0) return t;
  return def;
}

// Maps a friendly sweep-knob name to its hidden tuning input id (or null if unknown).
export function resolveSweepKnob(name) {
  const map = {
    tickDetectMult: 'msr-tune-tick-detect-mult',
    maxPairThresh: 'msr-tune-max-pair-thresh',
    pairMadMult: 'msr-tune-pair-mad-mult',
    maxTickDevMs: 'msr-tune-max-tick-dev',
    coldStartThresh: 'msr-tune-cold-start',
    calibMultiplier: 'msr-tune-calib-multiplier',
    noiseFloorMult: 'msr-tune-noise-floor-mult',
  };
  return map[name] || null;
}

// Parses a comma-separated list into positive finite numbers (drops junk/zero/negatives).
export function parseSweepValues(str) {
  return String(str || '').split(',').map(s => parseFloat(s.trim())).filter(v => isFinite(v) && v > 0);
}

// Median + population std of a numeric array (rounded). { median, std, n }.
export function medianStd(arr) {
  const a = (arr || []).filter(x => isFinite(x));
  const n = a.length;
  if (!n) return { median: null, std: null, n: 0 };
  const s = [...a].sort((x, y) => x - y);
  const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const mean = a.reduce((x, y) => x + y, 0) / n;
  const std = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / n);
  return { median: Math.round(m * 10) / 10, std: Math.round(std * 100) / 100, n };
}

// Harvest calm sub-run segments ("chunks") from a tick stream [{t,cd}], skipping the warm-up
// transient and disturbances. Returns [{t0,t1,rate,residualSd,nTicks}] (rate = robust slope ×86.4;
// residualSd = spread of the local rate across the segment in s/day — small means a calm, steady run).
export function extractCleanChunks(samples, opts = {}) {
  const o = { warmupLook: 20, warmupEps: 0.5, warmupFloor: 15, win: 10,
              bandSday: 1, segMinSec: 15, rateStdMax: 0.3, ...opts };
  const pts = (samples || []).filter(p => p && isFinite(p.t) && isFinite(p.cd));
  if (pts.length < 8) return [];
  const start = pts[0].t, lastT = pts[pts.length - 1].t;
  let settleT = null;
  for (let t = start + o.warmupLook + 1; t <= lastT + 1e-6; t += 1) {
    const a = _q2Ls(pts, start, t), b = _q2Ls(pts, start, t - o.warmupLook);
    if (a != null && b != null && Math.abs(a - b) <= o.warmupEps) { settleT = t; break; }
  }
  const warmupEnd = settleT != null ? Math.max(settleT, start + o.warmupFloor) : start + o.warmupFloor;
  const series = [];
  for (let t = warmupEnd + o.win; t <= lastT + 1e-6; t += 1) {
    const r = _q2Ls(pts, t - o.win, t);
    if (r != null) series.push({ t, r });
  }
  const med = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const chunks = [];
  let seg = [];
  const flush = () => {
    if (seg.length >= 2) {
      const t0 = seg[0].t - o.win, t1 = seg[seg.length - 1].t;
      if (t1 - t0 >= o.segMinSec) {
        const rate = _q2Ls(pts, t0, t1);
        if (rate != null) {
          // residualSd = stability of the local (rolling-window) rate across the segment, in s/day.
          // A constant-rate run yields ~0; a boundary-contaminated or noisy run yields a large spread.
          const rs = seg.map(s => s.r);
          const rmean = rs.reduce((a, b) => a + b, 0) / rs.length;
          const resStd = Math.sqrt(rs.reduce((a, b) => a + (b - rmean) ** 2, 0) / rs.length);
          const w = pts.filter(p => p.t >= t0 && p.t <= t1);
          if (resStd <= o.rateStdMax) {
            chunks.push({ t0: Math.round(t0 * 10) / 10, t1: Math.round(t1 * 10) / 10, rate: Math.round(rate * 10) / 10, residualSd: Math.round(resStd * 1000) / 1000, nTicks: w.length });
          }
        }
      }
    }
    seg = [];
  };
  for (const pt of series) {
    if (!seg.length) { seg.push(pt); continue; }
    if (Math.abs(pt.r - med(seg.map(s => s.r))) <= o.bandSday) seg.push(pt);
    else flush();
  }
  flush();
  return chunks;
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
  if (idx < 0) return null;
  const path = url.slice(idx + marker.length);
  // Strip query params (cache-bust ?v=...) to get clean storage path
  const qIdx = path.indexOf('?');
  return qIdx >= 0 ? path.slice(0, qIdx) : path;
}

export function parsePhotoUrl(photoUrl) {
  if (!photoUrl) return [];
  if (photoUrl.startsWith('[')) {
    try { return JSON.parse(photoUrl); } catch (e) { return [photoUrl]; }
  }
  return [photoUrl];
}

export function isVideoUrl(url) {
  if (!url) return false;
  const path = (url.split('?')[0] || '').toLowerCase();
  return path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov') || path.endsWith('.m3u8');
}

export function posterUrlFor(videoUrl) {
  if (!videoUrl) return '';
  const [base, query] = videoUrl.split('?');
  const posterBase = base.replace(/\.(mp4|webm|mov)$/i, '_poster.jpg');
  return query ? `${posterBase}?${query}` : posterBase;
}

// Pick a displayable still image from a post's photo_url (single URL or JSON
// array of mixed images/videos): first non-video URL (an extracted frame is
// stored alongside videos), else the first video's poster, else nothing.
// Used by the shared-post viewer (/p/) to render a still preview.
export function displayImageFor(photoUrl) {
  const urls = parsePhotoUrl(photoUrl).filter(Boolean);
  if (!urls.length) return '';
  const firstImage = urls.find(u => !isVideoUrl(u));
  if (firstImage) return firstImage;
  return posterUrlFor(urls[0]);
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
    <a href="https://wrotate.com" style="text-decoration:none;display:block;"><img src="${escHtml(img.src)}" alt="" style="max-width:100%;border-radius:8px;display:block;border:0;"></a>
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

// Build share post URL.
// Public posts use the anonymous, server-rendered edge function (rich chat-link
// preview). Non-public posts (followers/friends/private) use the same-origin
// in-app viewer, where the recipient's logged-in session lets RLS decide whether
// they're allowed to see it — and the anonymous link preview can't leak content.
// Legacy null/undefined visibility is treated as public.
export function sharePostUrl(logId, visibility) {
  return (visibility && visibility !== 'public')
    ? `https://wrotate.com/p/?id=${logId}`
    : `https://api.wrotate.com/functions/v1/share-post?id=${logId}`;
}

// ══════════════════════════════════════════
//  WEAR DEDUP
// ══════════════════════════════════════════

/** Count unique wear days for a single watch from its logs */
export function wearsForWatchFromLogs(watchLogs) {
  if (watchLogs.length <= 1) return watchLogs.length;
  const dates = new Set();
  for (const l of watchLogs) if (l.date) dates.add(l.date);
  return dates.size;
}

/** Count unique wear days across all logs (composite key: watchId|date) */
export function uniqueWears(logArr) {
  if (logArr.length <= 1) return logArr.length;
  const dates = new Set();
  for (const l of logArr) if (l.date) dates.add(l.date + '|' + (l.watchId || ''));
  return dates.size;
}

// ══════════════════════════════════════════
//  DELETE ACCOUNT TABLE COLUMNS
// ══════════════════════════════════════════

/** Returns the delete filter for each table used by deleteAccount */
export function deleteAccountFilters(uid) {
  return {
    club_invites: { or: `invited_by.eq.${uid},invitee_id.eq.${uid}` },
    club_join_requests: { eq: ['user_id', uid] },
    content_reports: { eq: ['reporter_id', uid] },
    device_tokens: { eq: ['user_id', uid] },
    official_drafts: { eq: ['created_by', uid] },
  };
}

// ══════════════════════════════════════════
//  PROFILE COUNT PARSING
// ══════════════════════════════════════════

/**
 * Parse a Supabase count response (head: true query).
 * Returns the count value, defaulting to 0 on missing/null.
 * Used by loadAndRenderProfile for follower/following counts.
 */
export function parseCountResponse(response) {
  return response.count || 0;
}

// ══════════════════════════════════════════
//  PRICE UPDATE TOAST MESSAGE
// ══════════════════════════════════════════

/**
 * Build the toast message for saveUpdatedPrices.
 * @param {number} saved - number of successfully saved prices
 * @param {string[]} failed - names of watches that failed to save
 * @returns {{ message: string, type: string }}
 */
export function formatPriceUpdateToast(saved, failed) {
  if (failed.length) {
    return {
      message: `Updated ${saved} price${saved !== 1 ? 's' : ''}, ${failed.length} failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '...' : ''}`,
      type: 'error',
    };
  }
  return {
    message: `Updated ${saved} watch price${saved !== 1 ? 's' : ''}.`,
    type: 'success',
  };
}

// ══════════════════════════════════════════
//  DELETE ACCOUNT ERROR MESSAGE
// ══════════════════════════════════════════

/**
 * Build the error message when a deleteAccount phase fails.
 * The del() helper throws new Error(tableName), so e.message is the table name.
 * @param {string} tableName - the name of the table that failed
 * @returns {string}
 */
export function formatDeleteError(tableName) {
  return `Delete failed at ${tableName}. Please try again — already-deleted data will be skipped.`;
}

export function sanitizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/vbscript\s*:/gi, 'blocked:');
}

export function capScatterData(data, limit = 2000) {
  return data.length > limit ? data.slice(-limit) : data;
}

// ══════════════════════════════════════════
//  TIMEGRAPHER ADVANCED SETTINGS
// ══════════════════════════════════════════

export const TG_ALG_VERSION = 2;
export const TG_PRESETS = {
  default: { sensitivity: 5, noiseTolerance: 5, outlierStrictness: 5, convergenceSpeed: 5, maxDuration: 45, recalibrationAttempts: 4 },
  quiet:   { sensitivity: 4, noiseTolerance: 3, outlierStrictness: 7, convergenceSpeed: 7, maxDuration: 30, recalibrationAttempts: 2 },
  noisy:   { sensitivity: 6, noiseTolerance: 8, outlierStrictness: 4, convergenceSpeed: 4, maxDuration: 60, recalibrationAttempts: 6 },
  weak:    { sensitivity: 9, noiseTolerance: 7, outlierStrictness: 3, convergenceSpeed: 3, maxDuration: 90, recalibrationAttempts: 8 }
};

export function tgMapSliderToEngine(values) {
  const lerp = (a, b, t) => a + (t - 1) / 9 * (b - a);
  const lerpInv = (a, b, t) => a - (t - 1) / 9 * (a - b);
  return {
    calibMultiplier: lerpInv(2.0, 0.2, values.sensitivity),
    noiseFloorMult: lerpInv(3.2, 0.5, values.noiseTolerance),
    outlierMargin: lerp(0.08, 0.2375, values.outlierStrictness),
    stabilityThreshold: lerp(1.0, 5.5, values.convergenceSpeed),
    maxDuration: values.maxDuration,
    maxRecalibrations: values.recalibrationAttempts
  };
}

export function tgSaveSettings(preset, values) {
  localStorage.setItem('tg_advanced_settings', JSON.stringify({
    algVersion: TG_ALG_VERSION, preset: preset, values: values
  }));
}

export function tgLoadSettings() {
  try {
    const raw = localStorage.getItem('tg_advanced_settings');
    if (!raw) return { preset: 'default', values: { ...TG_PRESETS.default }, wasReset: false };
    const parsed = JSON.parse(raw);
    if (!parsed.algVersion || parsed.algVersion < TG_ALG_VERSION) {
      localStorage.removeItem('tg_advanced_settings');
      return { preset: 'default', values: { ...TG_PRESETS.default }, wasReset: true };
    }
    return { preset: parsed.preset || 'default', values: parsed.values || { ...TG_PRESETS.default }, wasReset: false };
  } catch (e) {
    return { preset: 'default', values: { ...TG_PRESETS.default }, wasReset: false };
  }
}

// Builds the advanced-mode tracking fields written into a measurement's
// session_summary. advanced_used is false only when the session ran on the
// untouched Default preset, so admin can distinguish deliberate tuning from
// never-opened-the-page. Mirrors the copy in index.html.
export function tgAdvancedSummaryFields(s) {
  if (!s) return { advanced_used: false, preset: null, settings: null };
  const v = s.values || {};
  const def = TG_PRESETS.default;
  const isDefault = s.preset === 'default' &&
    Object.keys(def).every(k => v[k] === def[k]);
  return { advanced_used: !isDefault, preset: s.preset || null, settings: v };
}

// ══════════════════════════════════════════
//  MEASUREMENT SHARE CARD (pure helpers)
//  Mirrors copies in index.html.
// ══════════════════════════════════════════

// Minimum scatter dots before a measurement is worth rendering as a graph card.
export const MSR_CARD_MIN_DOTS = 11;

// True when a measurement has enough dot data to render a meaningful graph card.
export function msrCardHasEnoughData(scatterData) {
  return Array.isArray(scatterData) && scatterData.length >= MSR_CARD_MIN_DOTS;
}

// Formats the result values shown on the share card.
export function msrCardResultText({ rate, beatError, bph }) {
  const out = {};
  const r = Number(rate);
  const rOk = rate != null && rate !== '' && isFinite(r);
  out.rate = (rOk ? (r > 0 ? '+' : '') + r.toFixed(1) : '—') + ' s/d';
  const be = Number(beatError);
  out.beatError = beatError != null && beatError !== '' && isFinite(be) ? be.toFixed(1) + ' ms' : null;
  const b = Number(bph);
  out.bph = bph != null && isFinite(b) && b > 0 ? Math.round(b).toLocaleString() + ' bph' : null;
  return out;
}

// ══════════════════════════════════════════
//  POST LOCATION (pure helpers) — mirrors index.html
// ══════════════════════════════════════════

// Normalize a post location: trim, collapse whitespace, cap 60 chars, empty->null.
export function normalizeLocation(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || null;
}

// Grayscale location-pin icon (inherits currentColor — i.e. the muted meta text
// color — so it blends in instead of the attention-grabbing red 📍 emoji).
const LOCATION_PIN_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';

// Render the pinned location label appended to a post's meta line.
// Returns '' when absent so it can be concatenated unconditionally.
export function renderPostLocationHtml(location) {
  const loc = normalizeLocation(location);
  return loc ? ' · ' + LOCATION_PIN_SVG + ' ' + escHtml(loc) : '';
}

export function badgePostPlan(newlyEarned, context, postId) {
  const notable = (newlyEarned || []).filter(b => b && b.category !== 'onboarding' && !b.isHidden).map(b => b.ref);
  if (!notable.length || context === 'retroactive') return { inline: [], standalone: [] };
  if (postId) return { inline: notable, standalone: [] };
  return { inline: [], standalone: notable };
}

// Pin the active featured post to the top of the feed (admin spotlight).
// Pure: removes any existing copy of featuredId, then prepends the pin marked __featured.
export function pinFeatured(rawLogs, featuredId, featuredLog) {
  if (!featuredId) return rawLogs.slice();
  const rest = rawLogs.filter(l => l.id !== featuredId);
  const pin = rawLogs.find(l => l.id === featuredId) || featuredLog;
  if (!pin) return rest;
  return [{ ...pin, __featured: true }, ...rest];
}

// Pick readable initials text color (#000/#fff) for a given avatar background
// via YIQ perceived brightness. Used for watch-color avatars (dark dials vs light).
export function initialsTextColor(bg) {
  if (!bg || typeof bg !== 'string') return '#000';
  let h = bg.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return '#000';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? '#000' : '#fff';
}
