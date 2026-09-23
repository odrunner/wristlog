// WRotate — shared model (reference) page renderer. Used by the app
// (index.html, #page-model) and the public page (w/index.html). One
// renderer, one look; the host supplies data (ctx) and handlers (h).
//   WRModelPage.render(el, ctx, h) -> effective tab
//   ctx: { m, o, st, facts, tab, loggedIn, publicMode }
//   h:   { back, share, setTab(tab, scroll), openModel(id, slug), brandExplore(brand),
//          requestEdit(kind), openWatch(id), addToCollection(b, n), addToWishlist(b, n), openApp }
(function () {
  const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escAttr = escHtml;

  // Hero images are stored as 1500 px originals (~170-245 KB) but render in a
  // 180 px-tall box (max 480 px wide). Supabase Storage render transforms
  // downscale on the fly — /storage/v1/render/image/public/media/…?width=960&
  // height=360&resize=cover returns the box at 2x DPR (never upscaled; ~49 KB
  // vs 245 KB measured). data-full carries the original: on any transform
  // error the capture listener below swaps it back in — the same fallback
  // pattern as index.html's initThumbFallback (both listeners are idempotent,
  // so the pair coexists inside the app).
  const MEDIA_MARKER = '/storage/v1/object/public/media/';
  function heroSrcAttrs(url) {
    if ((url || '').indexOf(MEDIA_MARKER) < 0) return `src="${escAttr(url)}"`;
    const t = url.replace(MEDIA_MARKER, '/storage/v1/render/image/public/media/')
      + (url.indexOf('?') >= 0 ? '&' : '?') + 'width=960&height=360&resize=cover';
    return `src="${escAttr(t)}" data-full="${escAttr(url)}"`;
  }
  document.addEventListener('error', e => {
    const el = e.target;
    if (!el || el.tagName !== 'IMG') return;
    const full = el.getAttribute('data-full');
    if (!full || el.getAttribute('src') === full) return;
    el.removeAttribute('data-full');
    el.src = full;
    e.stopPropagation();
  }, true);

// ── helpers — VERBATIM mirrors of wrotate_test.js (tests/model-page-shared.test.js) ──
function sparklinePath(series, w = 120, h = 32, pad = 2) {
  const pts = (series || []).map(p => Number(p.median)).filter(v => Number.isFinite(v));
  if (pts.length < 2) return '';
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (pts.length - 1);
  return pts.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function valueTrendSummary(series) {
  const s = (series || []).filter(p => Number.isFinite(Number(p.median)));
  if (s.length < 2) return null;
  const first = Number(s[0].median), last = Number(s[s.length - 1].median);
  if (!first) return null;
  const pct = Math.round(((last - first) / first) * 100);
  const [y, m] = String(s[0].ym || '').split('-');
  const mon = m ? new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' }) : '';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '▶';
  return { pct, arrow, text: `${arrow} ${Math.abs(pct)}% since ${mon}`.trim(), direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

function wearIndexPhrase(index, pctRank) {
  const x = Number(index);
  if (!Number.isFinite(x)) return '';
  let line;
  if (x >= 2)        line = `Owners reach for it more than ${x >= 3 ? 'three' : 'twice'}${x >= 3 ? ' times' : ''} its share of their rotation`;
  else if (x >= 1.3) line = 'Owners wear it well above its share of their rotation';
  else if (x >= 0.8) line = 'Owners wear it about as much as the rest of their collection';
  else if (x >= 0.5) line = 'Owners wear it less than its share of their rotation';
  else               line = 'Mostly a safe queen — rarely leaves the box';
  const rank = (pctRank != null && Number.isFinite(Number(pctRank))) ? ` · worn more than ${Math.round(Number(pctRank))}% of models on WRotate` : '';
  return line + rank;
}

function fmtRate(r) {
  const x = Number(r);
  if (!Number.isFinite(x)) return '—';
  // Sign derived AFTER rounding (audit F7): -0.04 used to render as "-0.0 s/d"
  const mag = Math.abs(x).toFixed(1);
  return `${mag === '0.0' ? '' : x > 0 ? '+' : '-'}${mag} s/d`;
}

function barPcts(counts) {
  const arr = (counts || []).map(n => Math.max(0, Number(n) || 0));
  const max = Math.max(0, ...arr);
  return arr.map(n => (max > 0 && n > 0) ? Math.max(12, Math.round((n / max) * 100)) : 4);
}

function histTone(pct) {
  const p = Number(pct) || 0;
  return p >= 75 ? 'gold' : p >= 35 ? 'dim' : 'flat';
}

function featuredFactIndex(count, now = new Date()) {
  const n = Number(count) || 0;
  if (n <= 0) return -1;
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now - start) / 86400000);
  return day % n;
}


function mpBars(counts, h, gap, radius, tone) {
  const pcts = barPcts(counts);
  return `<div class="u-d-flex u-items-flex-end" style="gap:${gap}px;height:${h}px;">${pcts.map((p, i) =>
    `<div class="mp-tone-${(Number(counts[i]) || 0) === 0 ? 'flat' : (tone ? tone(p, i) : (histTone(p) === 'flat' ? 'dim' : histTone(p)))}" style="flex:1;height:${p}%;border-radius:${radius};" title="${Number(counts[i]) || 0}"></div>`).join('')}</div>`;
}

function renderModelPage(el, ctx, h) {
  const { m, o, st, facts } = ctx;
  if (el._mpHistoryOpenFor && el._mpHistoryOpenFor !== (m.id || m.slug)) el._mpHistoryOpenFor = null;
  let tab = ctx.tab;
  const loggedIn = !!ctx.loggedIn, publicMode = !!ctx.publicMode;
  const sp = m.specs || {};
  const nz = v => v == null ? '' : String(v);
  const minus = v => String(v).replace('-', '−');
  const owners = (st.owners ?? o.total_owners) || 0;
  const mine = st.mine || [];
  const isOwner = mine.length > 0;
  const tabs = [];
  const hasData = !!(st.wear_share || st.accuracy || (st.wear_weeks || []).some(n => n > 0));
  if (hasData) tabs.push(['data', 'Data']);
  tabs.push(['specs', 'Specs']);
  tabs.push(['owners', 'Owners']);
  if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];

  // ── Hero ──
  const heroImg = m.hero_image || (st.photos || [])[0] || '';
  const refs = Array.isArray(m.refs_by_era) ? m.refs_by_era : [];
  const ref = (refs.length ? refs[refs.length - 1].reference : '') || st.top_ref || '';
  const captionBits = [sp.type ? sp.type.replace(/ watch$/i, '') : '', sp.size, sp.water_resistance,
    (st.specs_agg || {}).movement_type ? st.specs_agg.movement_type.v : '',
    (o.era_min && o.era_max && o.era_min !== o.era_max) ? `${o.era_min}–${o.era_max}` : ''].filter(Boolean);
  const hero = `<div class="u-h-45 u-bg-surface2" style="position:relative;overflow:hidden;">
    ${heroImg ? `<img ${heroSrcAttrs(heroImg)} alt="" fetchpriority="high" class="u-w-100pct u-h-100pct u-of-cover" style="position:absolute;inset:0;">` : ''}
    <div class="u-bg-linear-gradient-to-right-color-mix-in-srgb-black-90pct-transparent-0pct-color-mix-in-srgb-black-35pct-transparent-55pct-color-mix-in-srgb-black-10pct-transparent-100pct" style="position:absolute;inset:0;pointer-events:none;"></div>
    <div class="u-justify-space-between u-fs-sm u-c-mix-white-85 u-d-flex" style="position:absolute;top:var(--size-3-5);left:var(--size-4);right:var(--size-4);">
      <span role="button" tabindex="0" class="u-cur-pointer" data-mp="back">‹ Back</span>
      <span role="button" tabindex="0" class="u-cur-pointer" data-mp="share">Share</span>
    </div>
    <div style="position:absolute;left:var(--size-4);bottom:var(--size-3-5);right:var(--size-4);pointer-events:none;">
      <div class="u-fs-2xs u-fw-semibold u-ls-wide u-tt-uppercase u-c-gold-lt">${escHtml(m.brand)}${ref ? ` · ref. ${escHtml(ref)}` : ''}</div>
      <div class="u-fs-3xl u-fw-semibold u-ls-display u-c-white u-mt-1 u-mr-0 u-mb-1-5 u-ml-0 u-lh-tight">${escHtml(m.name)}</div>
      <div class="u-fs-xs u-c-mix-white-70">${escHtml(captionBits.join(' · '))}</div>
    </div>
  </div>${m.hero_image && m.hero_credit ? `<div class="u-fs-3xs u-c-muted u-ta-right u-pt-1 u-pr-2-5 u-pb-0 u-pl-2-5 u-bg-bg">${escHtml(m.hero_credit)}</div>` : ''}`;

  // ── Stat grid (2×2) ──
  const cells = [];
  if (st.accuracy) {
    const a = st.accuracy;
    cells.push(`<div class="mp-cell"><div class="l">Median rate</div>
      <div class="v">${escHtml(minus(nz(a.med_rate)))}<span class="text-caption u-fw-normal"> s/d</span></div>
      <div class="u-mt-1-5">${mpBars(a.hist || [], 16, 2, '0')}</div>
      <div class="f">${a.n_sessions} measurements · ${a.n_measurers} members</div></div>`);
  } else {
    cells.push(`<div class="mp-cell"><div class="l">Owners</div><div class="v">${owners}</div><div class="f">${st.wishlisted ? `${st.wishlisted} more want it` : 'on WRotate'}</div></div>`);
  }
  if (st.value) {
    const v = st.value, trend = valueTrendSummary(v.series), path = sparklinePath(v.series, 120, 16, 1);
    cells.push(`<div class="mp-cell"><div class="l">Median value</div>
      <div class="v">$${Number(v.median_now).toLocaleString()}</div>
      <div class="u-h-4 u-mt-1-5" style="position:relative;overflow:hidden;">${path ? `<svg data-tile-spark width="100%" height="16" viewBox="0 0 120 16" preserveAspectRatio="none" class="u-d-block"><title>${escHtml((v.series || []).map(p => `${p.ym}: $${Number(p.median).toLocaleString()} (${p.n})`).join(' · '))}</title><path d="${path} L118,16 L2,16 Z" fill="var(--gold-dim)" stroke="none"/><path d="${path}" fill="none" stroke="var(--gold)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>` : `<div class="u-bg-linear-gradient-to-top-gold-dim-transparent" style="position:absolute;inset:0;"></div>`}</div>
      <div class="f" style="color:${trend && trend.direction === 'down' ? 'var(--danger)' : trend ? 'var(--success)' : 'var(--muted)'};">${trend ? escHtml(trend.text) + ' · ' : ''}${v.n_contributors} valuations</div></div>`);
  } else {
    cells.push(`<div class="mp-cell"><div class="l">Wishlisted</div><div class="v">${st.wishlisted || 0}</div><div class="f">members want one</div></div>`);
  }
  const wr = st.wears || {};
  const strip = st.wear_strip || [];
  cells.push(`<div class="mp-cell"><div class="l">Wears / 90 days</div><div class="v">${wr.w90 || 0}</div>
    <div class="u-cols-repeat-15-1fr u-gap-0-5 u-mt-1-5 u-d-grid">${(strip.length ? strip : Array(15).fill(0)).map(n => `<div class="mp-tone-${n >= 2 ? 'gold' : n === 1 ? 'dim' : 'flat'}" style="aspect-ratio:1;" title="${n} wear${n === 1 ? '' : 's'}"></div>`).join('')}</div>
    <div class="f">by ${wr.wearers90 || 0} of ${owners} owners</div></div>`);
  if (st.cost_per_wear) {
    const c = st.cost_per_wear;
    const cpwTxt = Number(c.median) < 1 ? '<$1' : Number(c.median) < 10 ? `$${Number(c.median).toFixed(1)}` : `$${Math.round(Number(c.median)).toLocaleString()}`;
    cells.push(`<div class="mp-cell"><div class="l">Cost per wear</div><div class="v u-c-gold-text">${cpwTxt}</div>
      <div class="row-tight u-h-4 u-mt-1-5"><div class="u-flex-1 u-h-1 u-r-hair u-bg-surface2" style="position:relative;overflow:hidden;"><div class="u-bg-gold" style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100, Math.round(100 * c.wears / Math.max(c.wears, 500)))}%;"></div></div><span class="u-fs-3xs u-c-muted">${Number(c.wears).toLocaleString()} wears</span></div>
      <div class="f">per logged wear · ${c.n_owners} owner${c.n_owners === 1 ? '' : 's'} with price + wears</div></div>`);
  } else {
    cells.push(`<div class="mp-cell"><div class="l">${st.accuracy ? 'Owners' : 'Wears all-time'}</div><div class="v">${st.accuracy ? owners : (wr.all_time || 0)}</div><div class="f">${st.accuracy ? (st.wishlisted ? `${st.wishlisted} more want it` : 'on WRotate') : 'logged by members'}</div></div>`);
  }
  const grid = `<div class="u-cols-1fr-1fr u-gap-px u-bg-border u-d-grid">${cells.join('')}</div>`;

  // ── Story block (lore above the fold): history + fact pull-quote ──
  const key = m.id || m.slug;
  if (el._mpFactFor !== key) { el._mpFactFor = key; el._mpFactIdx = featuredFactIndex(facts.length); }
  const fi = facts.length ? ((el._mpFactIdx || 0) % facts.length) : -1;
  const storyText = (m.history || m.description || '').trim();
  const histOpen = el._mpHistoryOpenFor === key;
  let band = '';
  if (storyText || fi >= 0) {
    band = `<div id="mp-story" class="u-pt-4 u-pr-4 u-pb-3-5 u-pl-4 u-bdb-1px-solid-border u-bg-bg">
      ${storyText ? `<div class="mp-hrow stack-2"><div class="mp-h u-c-gold-text">The watch</div>${m.history ? '<span class="mp-badge">Exclusive</span>' : ''}</div>
        <div id="mp-history" style="font-size:var(--fs-md);line-height:var(--lh-body);color:var(--text);text-wrap:pretty;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;-webkit-line-clamp:${histOpen ? 'unset' : '3'};">${escHtml(storyText)}</div>
        <div id="mp-history-toggle" role="button" tabindex="0" data-mp="history" class="u-mt-0-5 u-pt-1-5 u-pr-0 u-pb-1-5 u-pl-0 u-fs-sm u-fw-semibold u-c-gold-text u-cur-pointer" style="display:none;">${histOpen ? 'Less' : 'Read the full history'}</div>` : ''}
      ${fi >= 0 ? `<div class="mp-quote" style="margin-top:${storyText ? '14px' : '0'};display:flex;align-items:stretch;gap:var(--space-1);">
        ${facts.length > 1 ? `<button type="button" data-mp="fact-prev" aria-label="Previous fact" class="mp-fact-nav">‹</button>` : ''}
        <div class="u-flex-1 u-minw-0 u-pt-1 u-pr-0 u-pb-1 u-pl-3 u-bdl-2px-solid-gold">
          <div id="mp-fact-kicker" class="u-fs-2xs u-fw-semibold u-ls-eyebrow u-tt-uppercase u-c-gold-text u-mb-1">Fun fact · ${fi + 1} of ${facts.length}</div>
          <div id="mp-fact-body" class="u-fs-sm u-lh-snug u-c-text u-tw-pretty u-boxor-vertical u-clamp-4 u-d-webkit-box" style="overflow:hidden;">${escHtml(facts[fi])}${publicMode ? ' …' : ''}</div>
        </div>
        ${facts.length > 1 ? `<button type="button" data-mp="fact-next" aria-label="Next fact" class="mp-fact-nav">›</button>` : ''}
      </div>` : ''}
    </div>`;
  }

  // ── Tabs ──
  const tabBar = `<div id="mp-tabs" role="tablist" class="u-bdb-1px-solid-border u-bg-bg u-d-flex">${tabs.map(([k, label]) =>
    `<button class="mp-tab" role="tab" id="mp-tab-${k}" aria-selected="${tab === k}" aria-controls="mp-panel" data-mp="tab" data-tab="${k}">${label}</button>`).join('')}</div>`;

  // ── Panels ──
  const H = (t, right = '') => `<div class="mp-hrow stack-2-5"><div class="mp-h">${t}</div>${right ? `<div class="row-tight">${right}</div>` : ''}</div>`;
  const sect = (inner, first) => `<div style="${first ? '' : 'border-top:1px solid var(--border);padding-top:var(--space-4);'}">${inner}</div>`;
  let panel = '';
  if (tab === 'data') {
    const parts = [];
    if (st.wear_share) {
      const w = st.wear_share, b = w.bench || {};
      const rows = [['This model', w.share, true], [`All ${m.brand}`, b.brand, false], [b.type_label ? b.type_label.replace(/ watch$/i, ' watches') : '', b.type, false], ['Every model', b.all, false]].filter(r => r[0] && r[1] != null);
      const max = Math.max(...rows.map(r => Number(r[1]) || 0), 1);
      const ret = w.retention || [];
      const retMax = Math.max(...ret.map(r => Number(r.share) || 0), 1);
      parts.push(`<div class="panel u-bdt-2px-solid-gold u-pt-4 u-pr-4 u-pb-4 u-pl-4">
        <div class="mp-hrow stack-3"><div class="mp-h u-c-gold-text">Wear share</div><span class="mp-badge">WRotate exclusive</span></div>
        <div class="mp-big"><span class="u-fs-4xl u-fw-semibold u-lh-none">${Number(w.index).toFixed(1)}×</span><span class="text-meta u-lh-snug">its fair share of<br>owners' wrist time</span></div>
        <div class="text-meta u-lh-body u-mt-2-5">Owners give it <span class="u-c-text u-fw-medium">${w.share}%</span> of their logged wears, against <span class="u-c-text u-fw-medium">${w.fair}%</span> if they rotated their collections evenly.</div>
        <div class="u-fd-column u-gap-2 u-mt-3-5 u-mr-0 u-mb-1 u-ml-0 u-d-flex">${rows.map(([label, val, me]) => `<div class="row">
          <span style="width:var(--size-20);flex:none;font-size:var(--fs-2xs);color:${me ? 'var(--text)' : 'var(--muted)'};">${escHtml(label)}</span>
          <div class="u-flex-1 u-h-2 u-bg-surface2 u-r-pill" style="overflow:hidden;"><div style="width:${Math.round(100 * Number(val) / max)}%;height:100%;background:${me ? 'var(--gold)' : label === 'Every model' ? 'var(--border)' : 'var(--gold-dim)'};border-radius:var(--radius-pill);"></div></div>
          <span style="width:var(--size-7);flex:none;text-align:right;font-size:var(--fs-2xs);${me ? 'font-weight:var(--fw-semibold);color:var(--gold-text);' : 'color:var(--muted);'}">${val}%</span></div>`).join('')}</div>
        ${ret.length ? `<div class="u-bdt-1px-solid-border u-mt-3-5 u-pt-3-5">
          <div class="mp-hrow stack-2-5"><div class="mp-h u-fs-2xs u-ls-tight">Does it last</div><div style="font-size:var(--fs-2xs);color:${Number(ret[ret.length - 1].share) >= Number(ret[0].share) * .8 ? 'var(--success)' : 'var(--muted)'};">${Number(ret[ret.length - 1].share) >= Number(ret[0].share) * .8 ? 'holds up' : 'fades'}</div></div>
          <div class="u-items-flex-end u-gap-1-5 u-h-10 u-d-flex">${ret.map((r, i) => `<div style="flex:1;height:${Math.round(100 * Number(r.share) / retMax)}%;background:${i === ret.length - 1 ? 'var(--gold-dim)' : 'var(--gold)'};border-radius:var(--radius-hair) var(--radius-hair) 0 0;"></div>`).join('')}</div>
          <div class="u-gap-1-5 u-mt-1-5 u-fs-3xs u-c-muted u-d-flex">${ret.map(r => `<span class="u-flex-1 u-ta-center">${escHtml(r.bucket)} · ${r.share}%</span>`).join('')}</div></div>` : ''}
        <div class="row u-mt-3-5 u-pt-3 u-bdt-1px-solid-border">
          ${w.pct_rank != null ? `<span class="u-fs-2xs u-fw-semibold u-c-black u-bg-gold u-r-pill u-pt-1 u-pr-2-5 u-pb-1 u-pl-2-5">Top ${Math.max(1, 100 - Math.round(w.pct_rank))}%</span>` : ''}
          <span class="text-caption">of ${Number(w.n_models).toLocaleString()} models · ${Number(w.wears).toLocaleString()} wears from ${w.n_owners} collections</span></div>
      </div>`);
    }
    if (st.accuracy) {
      const a = st.accuracy;
      parts.push(sect(H('Rate distribution', `<span class="mp-meta">s/day · ${a.n_sessions} readings</span><span class="mp-badge">Exclusive</span>`) +
        `<div class="u-pb-1-5 u-bdb-1px-solid-border">${mpBars(a.hist || [], 70, 2, '0')}</div>
        <div class="text-caption-xs u-justify-space-between u-mt-1-5 u-d-flex"><span>${minus(String(a.hist_min))}</span><span class="text-gold">${escHtml(minus(nz(a.med_rate)))} median</span><span>+${a.hist_max}</span></div>
        <div class="u-gap-2-5 u-mt-3 u-d-flex">
          ${a.med_amp ? `<div class="mp-card grow"><div class="l">Amplitude</div><div class="v">${a.med_amp}°</div></div>` : ''}
          <div class="mp-card grow"><div class="l">Drift</div><div class="v">±${a.med_abs_rate} s/d</div></div>
          <div class="mp-card grow"><div class="l">Members</div><div class="v">${a.n_measurers}</div></div>
        </div>`, !parts.length));
    }
    const wk = st.wear_weeks || [];
    if (wk.some(n => n > 0)) {
      const total = wk.reduce((x, y) => x + (Number(y) || 0), 0);
      const peak = wk.indexOf(Math.max(...wk));
      parts.push(sect(H('Wear pattern', `<span class="mp-meta">12 weeks</span><span class="mp-badge">Exclusive</span>`) +
        mpBars(wk, 44, 3, '2px') + `<div class="text-caption-xs u-mt-1-5">${total} wears over 12 weeks · busiest ${peak >= 10 ? 'in the last fortnight' : `${11 - peak} week${11 - peak === 1 ? '' : 's'} ago`}.</div>`, !parts.length));
    }
    panel = `<div class="mp-stack">${parts.join('')}</div>`;
  } else if (tab === 'specs') {
    const agg = st.specs_agg || {};
    const labels = [['caliber', 'Caliber'], ['case_diameter', 'Case ⌀'], ['case_material', 'Material'], ['movement_type', 'Movement'], ['year_range', 'Produced'], ['water_resistance', 'Water res.']];
    const mv = labels.filter(([k]) => agg[k]);
    const refRows = [['Type', sp.type], ['Size', sp.size], ['Water resistance', sp.water_resistance], ['Movement', sp.movement], ['Materials', sp.materials]].filter(r => r[1]);
    const cals = Array.isArray(m.calibers_by_era) ? m.calibers_by_era : [];
    const parts = [];
    if (refRows.length) parts.push(`<div><div class="mp-h stack-2-5">Reference spec</div>
        <div class="u-cols-auto-1fr u-gap-0-3 u-fs-sm u-d-grid">${refRows.map(([l, v], i) => { const bt = i ? 'border-top:1px solid var(--border);' : ''; return `<span class="u-c-muted u-pt-2 u-pr-0 u-pb-2 u-pl-0" style="${bt};">${l}</span><span class="u-c-text u-pt-2 u-pr-0 u-pb-2 u-pl-0 u-ta-right" style="${bt};">${escHtml(v)}</span>`; }).join('')}</div></div>`);
    if (refs.length) parts.push(sect(`<div class="mp-h stack-1-5">References by era</div>${refs.map(r => `<div class="u-gap-2-5 u-fs-sm u-pt-1-5 u-pr-0 u-pb-1-5 u-pl-0 u-bdt-1px-solid-border u-d-flex"><span class="u-minw-18 u-c-text">${escHtml(r.reference || '')}</span><span class="u-minw-20 u-c-muted">${escHtml(r.years || '')}</span><span class="text-muted">${escHtml(r.note || '')}</span></div>`).join('')}`, !parts.length));
    if (cals.length) parts.push(sect(`<div class="mp-h stack-1-5">Calibers by era</div><div class="u-fw--wrap u-gap-1-5 u-d-flex">${cals.map(c => `<span class="u-fs-xs u-bd-1px-solid-border u-r-pill u-pt-1 u-pr-2-5 u-pb-1 u-pl-2-5">${escHtml(c.caliber || '')}${c.years ? ` <span class="text-muted">${escHtml(c.years)}</span>` : ''}</span>`).join('')}</div>`, !parts.length));
    if (mv.length) parts.push(sect(`<div class="row-between u-mb-2-5"><span class="mp-h u-c-gold-text">From members' watches${st.specs_gen ? ` · ${escHtml(st.specs_gen)}` : ''}</span><span class="mp-badge">Exclusive</span></div>
        <div class="u-cols-auto-1fr-auto u-gap-0-3 u-fs-sm u-items-center u-d-grid">${mv.map(([k, label], i) => { const bt = i ? 'border-top:1px solid var(--border);' : ''; return `<span class="u-c-muted u-pt-2 u-pr-0 u-pb-2 u-pl-0" style="${bt};">${label}</span><span class="u-c-text u-pt-2 u-pr-0 u-pb-2 u-pl-0" style="${bt};">${escHtml(agg[k].v)}</span><span class="text-caption-xs u-pt-2 u-pr-0 u-pb-2 u-pl-0" style="${bt};">${agg[k].n} watch${agg[k].n === 1 ? '' : 'es'}</span>`; }).join('')}</div>`, !parts.length));
    panel = parts.length ? `<div class="u-fd-column u-gap-4 u-d-flex">${parts.join('')}</div>` : `<div class="caption">No specs on file yet.</div>`;
  } else {
    const era = st.era || [0, 0, 0, 0, 0, 0];
    const cards = [];
    if (st.tenure) cards.push(['Median tenure', `${st.tenure.years} yrs`]);
    if (st.wishlisted) cards.push(['Wishlisted', `${st.wishlisted} member${st.wishlisted === 1 ? '' : 's'}`]);
    if (wr.all_time) cards.push(['Wears logged', Number(wr.all_time).toLocaleString()]);
    panel = `<div class="mp-stack">
      <div class="mp-big"><span class="u-fs-display u-fw-semibold u-lh-none">${owners}</span><span class="caption">owner${owners === 1 ? '' : 's'}${o.era_min && o.era_max && o.era_min !== o.era_max ? ` · examples from ${escHtml(o.era_min)} to ${escHtml(o.era_max)}` : ''}</span></div>
      ${era.some(n => n > 0) ? sect(H('Ownership by era', `<span class="mp-meta">year of example</span><span class="mp-badge">Exclusive</span>`) +
        mpBars(era, 56, 4, '2px 2px 0 0') + `<div class="text-caption-xs u-gap-1 u-mt-1-5 u-d-flex">${['60s', '70s', '80s', '90s', '00s', '10s+'].map(l => `<span class="u-flex-1 u-ta-center">${l}</span>`).join('')}</div>`) : ''}
      <div class="u-bdt-1px-solid-border u-pt-4 u-cols-1fr-1fr u-gap-2-5 u-d-grid">${cards.map(([l, v]) => `<div class="mp-card u-pt-3 u-pr-3 u-pb-3 u-pl-3"><div class="l">${l}</div><div class="v u-fs-xl">${escHtml(v)}</div></div>`).join('')}</div>
    </div>`;
  }

  // ── More from brand ──
  const rel = (st.related || []).slice(0, 4);
  const more = `<div class="u-bdt-1px-solid-border u-pt-4 u-pb-5"><div class="mp-h stack-2-5">More from ${escHtml(m.brand)}</div>
    <div class="u-fd-column u-d-flex">${rel.map(r => `<div class="mp-row" data-mp="model" data-id="${escAttr(r.id)}" data-slug="${escAttr(r.slug || '')}"><span class="u-c-text">${escHtml(r.name)}</span><span class="caption-xs">${r.owners} owner${Number(r.owners) === 1 ? '' : 's'}</span></div>`).join('')}
      ${publicMode ? '' : `<div class="mp-row" data-mp="brand" data-brand="${escAttr(m.brand)}"><span class="text-gold">All ${st.brand_models || rel.length + 1} ${escHtml(m.brand)} models</span><span class="caption-xs">›</span></div>`}</div></div>`;

  // ── Request an edit + action bar ──
  const reqEdit = publicMode ? '' : `<div class="u-bdt-1px-solid-border u-pt-3-5 u-pr-0 u-pb-5 u-pl-0 u-justify-center u-d-flex"><button class="mp-pill" data-mp="edit" data-kind="page edit"><span class="u-fs-xs">✎</span><span>Request an edit</span></button></div>`;
  const wl = st.wishlisted_by_me;
  const actions = publicMode ? `<div class="mp-actions">
    <button class="mp-act mp-act-primary" data-mp="app">Track yours on WRotate</button></div>` : loggedIn ? `<div class="mp-actions">
    ${isOwner ? `<button class="mp-act mp-act-primary" data-mp="watch" data-id="${escAttr(mine[0].id)}">Open your ${escHtml(m.name)}${mine.length > 1 ? ` (${mine.length})` : ''}</button>`
              : `<button class="mp-act mp-act-primary" data-mp="collect">Add to collection</button>`}
    ${wl ? `<button class="mp-act mp-act-ghost" disabled>♥ On your wishlist</button>`
         : `<button class="mp-act mp-act-ghost" data-mp="wish">♡ Add to wishlist</button>`}
  </div>` : '';

  el.innerHTML = hero + band + grid + tabBar +
    `<div id="mp-panel" role="tabpanel" class="u-pt-4 u-pr-4 u-pb-2 u-pl-4 u-fd-column u-gap-5 u-minh-105 u-d-flex">${panel}${more}${reqEdit}</div>` + actions;
  if (!el._mpBound) {
    el._mpBound = true;
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-mp]');
      if (!t || !el.contains(t) || !el._mpHandlers) return;
      const H = el._mpHandlers, d = t.dataset;
      switch (d.mp) {
        case 'back': H.back && H.back(); break;
        case 'share': H.share && H.share(); break;
        case 'tab': H.setTab && H.setTab(d.tab, d.scroll === '1'); break;
        case 'fact-prev':
        case 'fact-next': {
          if (!facts.length) break;
          const step = d.mp === 'fact-prev' ? -1 : 1;
          el._mpFactIdx = (((el._mpFactIdx || 0) + step) % facts.length + facts.length) % facts.length;
          const k = el.querySelector('#mp-fact-kicker'), bd = el.querySelector('#mp-fact-body');
          if (k) k.textContent = `Fun fact · ${el._mpFactIdx + 1} of ${facts.length}`;
          if (bd) bd.textContent = facts[el._mpFactIdx] + (publicMode ? ' …' : '');
          if (H.track) H.track('model_fact_next', { model: m.slug, index: el._mpFactIdx, dir: step });
          break;
        }
        case 'history': {
          const hist = el.querySelector('#mp-history');
          if (!hist) break;
          const open = el._mpHistoryOpenFor === (m.id || m.slug);
          el._mpHistoryOpenFor = open ? null : (m.id || m.slug);
          hist.style.webkitLineClamp = open ? '3' : 'unset';
          t.textContent = open ? 'Read the full history' : 'Less';
          if (!open && H.track) H.track('model_history_expand', { model: m.slug, overflowed: true });
          break;
        }
        case 'model': H.openModel && H.openModel(d.id, d.slug); break;
        case 'brand': H.brandExplore && H.brandExplore(d.brand); break;
        case 'edit': H.requestEdit && H.requestEdit(d.kind); break;
        case 'watch': H.openWatch && H.openWatch(d.id); break;
        case 'collect': H.addToCollection && H.addToCollection(m.brand, m.name); break;
        case 'wish': H.addToWishlist && H.addToWishlist(m.brand, m.name); break;
        case 'app': H.openApp && H.openApp(); break;
      }
    });
  }
  el._mpHandlers = h || {};
  // Show the expand toggle only when the clamped paragraph actually overflows.
  requestAnimationFrame(() => {
    const hist = el.querySelector('#mp-history'), tg = el.querySelector('#mp-history-toggle');
    if (hist && tg) tg.style.display = (histOpen || hist.scrollHeight > hist.clientHeight + 1) ? '' : 'none';
  });
  return tab;
}


  const CSS = `
    /* Reference (model) page — 2a design, 390px */
    #page-model { max-width: var(--size-120); margin: 0 auto; padding: 0; }
    .mp-tone-gold { background: var(--gold); } .mp-tone-dim { background: var(--gold-dim); } .mp-tone-flat { background: var(--surface2); }
    .mp-tab { flex:1; text-align:center; padding:var(--space-3) 0; font-size:var(--fs-sm); cursor:pointer; color:var(--muted); font-weight:var(--fw-normal); border-bottom:2px solid transparent; background:none; border-top:0; border-left:0; border-right:0; font-family:inherit; }
    .mp-tab:hover { background: var(--surface2); }
    .mp-tab[aria-selected="true"] { color:var(--gold-text); font-weight:var(--fw-semibold); border-bottom-color:var(--gold); }
    .mp-badge { font-size:var(--fs-3xs); font-weight:var(--fw-semibold); letter-spacing:var(--ls-tight); text-transform:uppercase; color:var(--gold-text); background:var(--gold-dim); border-radius:var(--radius-pill); padding:var(--space-1) var(--space-2); white-space:nowrap; }
    .mp-h { font-size:var(--fs-2xs); font-weight:var(--fw-semibold); letter-spacing:var(--ls-eyebrow); text-transform:uppercase; color:var(--muted); }
    .mp-cell { background:var(--surface); padding:var(--space-3-5) var(--space-3-5); }
    .mp-cell .l { font-size:var(--fs-2xs); letter-spacing:var(--ls-eyebrow); text-transform:uppercase; color:var(--muted); }
    .mp-cell .v { font-size:var(--fs-3xl); font-weight:var(--fw-semibold); color:var(--text); margin:var(--space-1) 0 var(--space-0-5); }
    .mp-cell .f { font-size:var(--fs-2xs); color:var(--muted); margin-top:var(--space-1-5); }
    .mp-quote button:hover { background: var(--surface2); border-radius: var(--radius-sm); }
    .mp-row { display:flex; justify-content:space-between; align-items:center; padding:var(--space-2-5) 0; border-bottom:1px solid var(--border); font-size:var(--fs-sm); cursor:pointer; }
    .mp-row:hover { background: var(--surface2); }
    .mp-row:last-child { border-bottom:0; }
    .mp-pill { display:inline-flex; align-items:center; gap:var(--space-1-5); font-size:var(--fs-xs); font-weight:var(--fw-medium); color:var(--muted); border:1px solid var(--border); border-radius:var(--radius-pill); padding:var(--space-1-5) var(--space-3); cursor:pointer; background:none; font-family:inherit; }
    .mp-pill:hover { color:var(--gold-text); border-color:var(--gold); }
    .mp-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm); padding:var(--space-2-5) var(--space-3); }
    .mp-card .l { font-size:var(--fs-2xs); letter-spacing:var(--ls-tight); text-transform:uppercase; color:var(--muted); }
    .mp-card .v { font-size:var(--fs-lg); font-weight:var(--fw-semibold); color:var(--text); margin-top:var(--space-1); }
    .mp-act { flex:1; text-align:center; font-size:var(--fs-base); border-radius:var(--radius-btn); padding:var(--space-3); cursor:pointer; font-family:inherit; }
    /* page components — each decision once, values are tokens (2026-09-22) */
    .mp-actions { position:sticky; bottom:0; display:flex; gap:var(--space-2); padding:var(--space-3) var(--space-4) var(--space-5); border-top:1px solid var(--border); background:var(--bg); }
    .mp-act-primary { font-weight:var(--fw-semibold); color:var(--black); background:var(--gold); border:0; }
    .mp-act-ghost { color:var(--text); background:transparent; border:1px solid var(--border); }
    .mp-act-ghost:disabled { color:var(--muted); }
    .mp-fact-nav { flex:none; width:var(--size-9); min-height:var(--size-11); display:flex; align-items:center; justify-content:center; background:none; border:0; color:var(--gold-text); font-size:var(--fs-xl); cursor:pointer; font-family:inherit; }
    .mp-hrow { display:flex; justify-content:space-between; align-items:baseline; }
    .mp-big { display:flex; align-items:baseline; gap:var(--space-2); }
    .mp-stack { display:flex; flex-direction:column; gap:var(--space-5); }
    .mp-meta { font-size:var(--fs-2xs); color:var(--muted); }
  `;
  function injectStyles() {
    if (document.getElementById('wr-model-page-css')) return;
    const st = document.createElement('style'); st.id = 'wr-model-page-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  window.WRModelPage = {
    render(el, ctx, h) { injectStyles(); return renderModelPage(el, ctx, h); },
    sparklinePath, valueTrendSummary, wearIndexPhrase, fmtRate, barPcts, histTone, featuredFactIndex,
  };
})();
