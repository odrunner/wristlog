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
  return `${x > 0 ? '+' : ''}${x.toFixed(1)} s/d`;
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
  return `<div style="display:flex;align-items:flex-end;gap:${gap}px;height:${h}px;">${pcts.map((p, i) =>
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
  if (facts.length) tabs.push(['lore', 'Lore']);
  tabs.push(['owners', 'Owners']);
  if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];

  // ── Hero ──
  const heroImg = m.hero_image || (st.photos || [])[0] || '';
  const refs = Array.isArray(m.refs_by_era) ? m.refs_by_era : [];
  const ref = (refs.length ? refs[refs.length - 1].reference : '') || st.top_ref || '';
  const captionBits = [sp.type ? sp.type.replace(/ watch$/i, '') : '', sp.size, sp.water_resistance,
    (st.specs_agg || {}).movement_type ? st.specs_agg.movement_type.v : '',
    (o.era_min && o.era_max && o.era_min !== o.era_max) ? `${o.era_min}–${o.era_max}` : ''].filter(Boolean);
  const hero = `<div style="position:relative;height:180px;background:var(--surface2);overflow:hidden;">
    ${heroImg ? `<img src="${escAttr(heroImg)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">` : ''}
    <div style="position:absolute;inset:0;background:linear-gradient(to right, rgba(8,8,12,.9) 0%, rgba(8,8,12,.35) 55%, rgba(8,8,12,.1) 100%);pointer-events:none;"></div>
    <div style="position:absolute;top:14px;left:16px;right:16px;display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,.85);">
      <span role="button" tabindex="0" style="cursor:pointer;" data-mp="back">‹ Back</span>
      <span role="button" tabindex="0" style="cursor:pointer;" data-mp="share">Share</span>
    </div>
    <div style="position:absolute;left:18px;bottom:14px;right:16px;pointer-events:none;">
      <div style="font-size:10px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--gold-lt);">${escHtml(m.brand)}${ref ? ` · ref. ${escHtml(ref)}` : ''}</div>
      <div style="font-size:25px;font-weight:600;letter-spacing:-.01em;color:#fff;margin:3px 0 5px;line-height:1.1;">${escHtml(m.name)}</div>
      <div style="font-size:11px;color:rgba(255,255,255,.7);">${escHtml(captionBits.join(' · '))}</div>
    </div>
  </div>${m.hero_image && m.hero_credit ? `<div style="font-size:8.5px;color:var(--muted);text-align:right;padding:3px 10px 0;background:var(--bg);">${escHtml(m.hero_credit)}</div>` : ''}`;

  // ── Stat grid (2×2) ──
  const cells = [];
  if (st.accuracy) {
    const a = st.accuracy;
    cells.push(`<div class="mp-cell"><div class="l">Median rate</div>
      <div class="v">${escHtml(minus(nz(a.med_rate)))}<span style="font-size:11px;color:var(--muted);font-weight:400;"> s/d</span></div>
      <div style="margin-top:6px;">${mpBars(a.hist || [], 16, 2, '0')}</div>
      <div class="f">${a.n_sessions} measurements · ${a.n_measurers} members</div></div>`);
  } else {
    cells.push(`<div class="mp-cell"><div class="l">Owners</div><div class="v">${owners}</div><div class="f">${st.wishlisted ? `${st.wishlisted} more want it` : 'on WRotate'}</div></div>`);
  }
  if (st.value) {
    const v = st.value, trend = valueTrendSummary(v.series), path = sparklinePath(v.series, 120, 16, 1);
    cells.push(`<div class="mp-cell"><div class="l">Median value</div>
      <div class="v">$${Number(v.median_now).toLocaleString()}</div>
      <div style="height:16px;margin-top:6px;position:relative;overflow:hidden;">${path ? `<svg data-tile-spark width="100%" height="16" viewBox="0 0 120 16" preserveAspectRatio="none" style="display:block;"><title>${escHtml((v.series || []).map(p => `${p.ym}: $${Number(p.median).toLocaleString()} (${p.n})`).join(' · '))}</title><path d="${path} L118,16 L2,16 Z" fill="var(--gold-dim)" stroke="none"/><path d="${path}" fill="none" stroke="var(--gold)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>` : `<div style="position:absolute;inset:0;background:linear-gradient(to top, var(--gold-dim), transparent);"></div>`}</div>
      <div class="f" style="color:${trend && trend.direction === 'down' ? 'var(--danger)' : trend ? 'var(--success)' : 'var(--muted)'};">${trend ? escHtml(trend.text) + ' · ' : ''}${v.n_contributors} valuations</div></div>`);
  } else {
    cells.push(`<div class="mp-cell"><div class="l">Wishlisted</div><div class="v">${st.wishlisted || 0}</div><div class="f">members want one</div></div>`);
  }
  const wr = st.wears || {};
  const strip = st.wear_strip || [];
  cells.push(`<div class="mp-cell"><div class="l">Wears / 90 days</div><div class="v">${wr.w90 || 0}</div>
    <div style="display:grid;grid-template-columns:repeat(15,1fr);gap:1.5px;margin-top:6px;">${(strip.length ? strip : Array(15).fill(0)).map(n => `<div class="mp-tone-${n >= 2 ? 'gold' : n === 1 ? 'dim' : 'flat'}" style="aspect-ratio:1;" title="${n} wear${n === 1 ? '' : 's'}"></div>`).join('')}</div>
    <div class="f">by ${wr.wearers90 || 0} of ${owners} owners</div></div>`);
  if (st.cost_per_wear) {
    const c = st.cost_per_wear;
    const cpwTxt = Number(c.median) < 1 ? '<$1' : Number(c.median) < 10 ? `$${Number(c.median).toFixed(1)}` : `$${Math.round(Number(c.median)).toLocaleString()}`;
    cells.push(`<div class="mp-cell"><div class="l">Cost per wear</div><div class="v" style="color:var(--gold);">${cpwTxt}</div>
      <div style="display:flex;align-items:center;gap:5px;height:16px;margin-top:6px;"><div style="flex:1;height:4px;border-radius:2px;background:var(--surface2);position:relative;overflow:hidden;"><div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100, Math.round(100 * c.wears / Math.max(c.wears, 500)))}%;background:var(--gold);"></div></div><span style="font-size:9px;color:var(--muted);">${Number(c.wears).toLocaleString()} wears</span></div>
      <div class="f">${c.n_owners} owner${c.n_owners === 1 ? '' : 's'} tracking</div></div>`);
  } else {
    cells.push(`<div class="mp-cell"><div class="l">${st.accuracy ? 'Owners' : 'Wears all-time'}</div><div class="v">${st.accuracy ? owners : (wr.all_time || 0)}</div><div class="f">${st.accuracy ? (st.wishlisted ? `${st.wishlisted} more want it` : 'on WRotate') : 'logged by members'}</div></div>`);
  }
  const grid = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);">${cells.join('')}</div>`;

  // ── Story block (lore above the fold): history + fact pull-quote ──
  const fi = featuredFactIndex(facts.length);
  const storyText = (m.history || m.description || '').trim();
  const histOpen = el._mpHistoryOpenFor === (m.id || m.slug);
  let band = '';
  if (storyText || fi >= 0) {
    band = `<div id="mp-story" style="padding:16px 16px 14px;border-bottom:1px solid var(--border);background:var(--bg);">
      ${storyText ? `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;"><div class="mp-h" style="color:var(--gold);">The watch</div>${m.history ? '<span class="mp-badge">Exclusive</span>' : ''}</div>
        <div id="mp-history" style="font-family:Newsreader, Georgia, serif;font-size:14px;line-height:1.5;color:var(--text);text-wrap:pretty;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;-webkit-line-clamp:${histOpen ? 'unset' : '3'};">${escHtml(storyText)}</div>
        <div id="mp-history-toggle" role="button" tabindex="0" data-mp="history" style="display:none;margin-top:2px;padding:6px 0;font-size:11.5px;font-weight:600;color:var(--gold-lt);cursor:pointer;">${histOpen ? 'Less' : 'Read the full history'}</div>` : ''}
      ${fi >= 0 ? `<div class="mp-quote" role="button" tabindex="0" data-mp="tab" data-tab="lore" data-scroll="1" data-fact="1" style="margin-top:${storyText ? '14px' : '0'};padding:4px 0 4px 12px;border-left:2px solid var(--gold);cursor:pointer;min-height:36px;">
        <div style="font-size:9.5px;font-weight:600;letter-spacing:var(--ls-eyebrow);text-transform:uppercase;color:var(--gold);margin-bottom:4px;">Fun fact · ${fi + 1} of ${facts.length}</div>
        <div style="font-size:12px;line-height:1.45;color:var(--text);text-wrap:pretty;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;-webkit-line-clamp:4;">${escHtml(facts[fi])}${publicMode ? ' …' : ''}</div></div>` : ''}
    </div>`;
  }

  // ── Tabs ──
  const tabBar = `<div id="mp-tabs" role="tablist" style="display:flex;border-bottom:1px solid var(--border);background:var(--bg);">${tabs.map(([k, label]) =>
    `<button class="mp-tab" role="tab" id="mp-tab-${k}" aria-selected="${tab === k}" aria-controls="mp-panel" data-mp="tab" data-tab="${k}">${label}</button>`).join('')}</div>`;

  // ── Panels ──
  const H = (t, right = '') => `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;"><div class="mp-h">${t}</div>${right ? `<div style="display:flex;align-items:center;gap:6px;">${right}</div>` : ''}</div>`;
  const sect = (inner, first) => `<div style="${first ? '' : 'border-top:1px solid var(--border);padding-top:16px;'}">${inner}</div>`;
  let panel = '';
  if (tab === 'data') {
    const parts = [];
    if (st.wear_share) {
      const w = st.wear_share, b = w.bench || {};
      const rows = [['This model', w.share, true], [`All ${m.brand}`, b.brand, false], [b.type_label ? b.type_label.replace(/ watch$/i, ' watches') : '', b.type, false], ['Every model', b.all, false]].filter(r => r[0] && r[1] != null);
      const max = Math.max(...rows.map(r => Number(r[1]) || 0), 1);
      const ret = w.retention || [];
      const retMax = Math.max(...ret.map(r => Number(r.share) || 0), 1);
      parts.push(`<div style="background:var(--surface);border:1px solid var(--border);border-top:2px solid var(--gold);border-radius:var(--radius);padding:15px 15px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;"><div class="mp-h" style="color:var(--gold);">Wear share</div><span class="mp-badge">WRotate exclusive</span></div>
        <div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:38px;font-weight:600;line-height:.95;">${Number(w.index).toFixed(1)}×</span><span style="font-size:12px;line-height:1.35;color:var(--muted);">its fair share of<br>owners' wrist time</span></div>
        <div style="font-size:11.5px;line-height:var(--lh-body);color:var(--muted);margin-top:10px;">Owners give it <span style="color:var(--text);font-weight:500;">${w.share}%</span> of their logged wears, against <span style="color:var(--text);font-weight:500;">${w.fair}%</span> if they rotated their collections evenly.</div>
        <div style="display:flex;flex-direction:column;gap:7px;margin:14px 0 4px;">${rows.map(([label, val, me]) => `<div style="display:flex;align-items:center;gap:8px;">
          <span style="width:78px;flex:none;font-size:10px;color:${me ? 'var(--text)' : 'var(--muted)'};">${escHtml(label)}</span>
          <div style="flex:1;height:9px;background:var(--surface2);border-radius:var(--radius-pill);overflow:hidden;"><div style="width:${Math.round(100 * Number(val) / max)}%;height:100%;background:${me ? 'var(--gold)' : label === 'Every model' ? 'var(--border)' : 'var(--gold-dim)'};border-radius:var(--radius-pill);"></div></div>
          <span style="width:26px;flex:none;text-align:right;font-size:10px;${me ? 'font-weight:600;color:var(--gold);' : 'color:var(--muted);'}">${val}%</span></div>`).join('')}</div>
        ${ret.length ? `<div style="border-top:1px solid var(--border);margin-top:14px;padding-top:13px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px;"><div class="mp-h" style="font-size:9.5px;letter-spacing:.06em;">Does it last</div><div style="font-size:9.5px;color:${Number(ret[ret.length - 1].share) >= Number(ret[0].share) * .8 ? 'var(--success)' : 'var(--muted)'};">${Number(ret[ret.length - 1].share) >= Number(ret[0].share) * .8 ? 'holds up' : 'fades'}</div></div>
          <div style="display:flex;align-items:flex-end;gap:6px;height:40px;">${ret.map((r, i) => `<div style="flex:1;height:${Math.round(100 * Number(r.share) / retMax)}%;background:${i === ret.length - 1 ? 'var(--gold-dim)' : 'var(--gold)'};border-radius:2px 2px 0 0;"></div>`).join('')}</div>
          <div style="display:flex;gap:6px;margin-top:5px;font-size:9px;color:var(--muted);">${ret.map(r => `<span style="flex:1;text-align:center;">${escHtml(r.bucket)} · ${r.share}%</span>`).join('')}</div></div>` : ''}
        <div style="display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
          ${w.pct_rank != null ? `<span style="font-size:10px;font-weight:600;color:#08080c;background:var(--gold);border-radius:var(--radius-pill);padding:4px 9px;">Top ${Math.max(1, 100 - Math.round(w.pct_rank))}%</span>` : ''}
          <span style="font-size:10.5px;color:var(--muted);">of ${Number(w.n_models).toLocaleString()} models · ${Number(w.wears).toLocaleString()} wears from ${w.n_owners} collections</span></div>
      </div>`);
    }
    if (st.accuracy) {
      const a = st.accuracy;
      parts.push(sect(H('Rate distribution', `<span style="font-size:10px;color:var(--muted);">s/day · ${a.n_sessions} readings</span><span class="mp-badge">Exclusive</span>`) +
        `<div style="padding-bottom:6px;border-bottom:1px solid var(--border);">${mpBars(a.hist || [], 70, 2, '0')}</div>
        <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:9.5px;color:var(--muted);"><span>${minus(String(a.hist_min))}</span><span style="color:var(--gold);">${escHtml(minus(nz(a.med_rate)))} median</span><span>+${a.hist_max}</span></div>
        <div style="display:flex;gap:10px;margin-top:12px;">
          ${a.med_amp ? `<div class="mp-card" style="flex:1;"><div class="l">Amplitude</div><div class="v">${a.med_amp}°</div></div>` : ''}
          <div class="mp-card" style="flex:1;"><div class="l">Drift</div><div class="v">±${a.med_abs_rate} s/d</div></div>
          <div class="mp-card" style="flex:1;"><div class="l">Members</div><div class="v">${a.n_measurers}</div></div>
        </div>`, !parts.length));
    }
    const wk = st.wear_weeks || [];
    if (wk.some(n => n > 0)) {
      const total = wk.reduce((x, y) => x + (Number(y) || 0), 0);
      const peak = wk.indexOf(Math.max(...wk));
      parts.push(sect(H('Wear pattern', `<span style="font-size:10px;color:var(--muted);">12 weeks</span><span class="mp-badge">Exclusive</span>`) +
        mpBars(wk, 44, 3, '2px') + `<div style="font-size:10px;color:var(--muted);margin-top:6px;">${total} wears over 12 weeks · busiest ${peak >= 10 ? 'in the last fortnight' : `${11 - peak} week${11 - peak === 1 ? '' : 's'} ago`}.</div>`, !parts.length));
    }
    panel = `<div style="display:flex;flex-direction:column;gap:18px;">${parts.join('')}</div>`;
  } else if (tab === 'specs') {
    const agg = st.specs_agg || {};
    const labels = [['caliber', 'Caliber'], ['case_diameter', 'Case ⌀'], ['case_material', 'Material'], ['movement_type', 'Movement'], ['year_range', 'Produced'], ['water_resistance', 'Water res.']];
    const mv = labels.filter(([k]) => agg[k]);
    const refRows = [['Type', sp.type], ['Size', sp.size], ['Water resistance', sp.water_resistance], ['Movement', sp.movement], ['Materials', sp.materials]].filter(r => r[1]);
    const cals = Array.isArray(m.calibers_by_era) ? m.calibers_by_era : [];
    panel = `<div style="display:flex;flex-direction:column;gap:16px;">
      ${mv.length ? `<div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span class="mp-h" style="color:var(--gold);">Member-verified</span><span class="mp-badge">Exclusive</span></div>
        <div style="display:grid;grid-template-columns:auto 1fr auto;gap:0 12px;font-size:12px;align-items:center;">${mv.map(([k, label], i) => { const bt = i ? 'border-top:1px solid var(--border);' : ''; return `<span style="color:var(--muted);padding:7px 0;${bt}">${label}</span><span style="color:var(--text);padding:7px 0;${bt}">${escHtml(agg[k].v)}</span><span style="color:var(--muted);font-size:9.5px;padding:7px 0;${bt}">${agg[k].n} watches</span>`; }).join('')}</div></div>` : ''}
      ${refRows.length || refs.length || cals.length ? sect(`<div class="mp-h" style="margin-bottom:10px;">Reference spec</div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:0 12px;font-size:12px;">${refRows.map(([l, v], i) => { const bt = i ? 'border-top:1px solid var(--border);' : ''; return `<span style="color:var(--muted);padding:7px 0;${bt}">${l}</span><span style="color:var(--text);padding:7px 0;text-align:right;${bt}">${escHtml(v)}</span>`; }).join('')}</div>
        ${refs.length ? `<div class="mp-h" style="margin:14px 0 6px;">References by era</div>${refs.map(r => `<div style="display:flex;gap:10px;font-size:12px;padding:6px 0;border-top:1px solid var(--border);"><span style="min-width:70px;color:var(--text);">${escHtml(r.reference || '')}</span><span style="min-width:84px;color:var(--muted);">${escHtml(r.years || '')}</span><span style="color:var(--muted);">${escHtml(r.note || '')}</span></div>`).join('')}` : ''}
        ${cals.length ? `<div class="mp-h" style="margin:14px 0 6px;">Calibers by era</div><div style="display:flex;flex-wrap:wrap;gap:6px;">${cals.map(c => `<span style="font-size:11px;border:1px solid var(--border);border-radius:var(--radius-pill);padding:4px 9px;">${escHtml(c.caliber || '')}${c.years ? ` <span style="color:var(--muted);">${escHtml(c.years)}</span>` : ''}</span>`).join('')}</div>` : ''}
`, !mv.length) : ''}
      ${!mv.length && !refRows.length ? `<div style="font-size:12px;color:var(--muted);">No specs on file yet.</div>` : ''}
    </div>`;
  } else if (tab === 'lore') {
    panel = `<div style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;"><span class="mp-h" style="color:var(--gold);">${facts.length} fact${facts.length === 1 ? '' : 's'}</span><span class="mp-badge">Exclusive</span></div>
      ${m.history ? `<div style="font-size:12px;line-height:1.55;color:var(--text);margin-bottom:4px;">${escHtml(m.history)}</div>` : ''}
      ${facts.map(f => `<div style="background:var(--surface);border:1px solid var(--border);border-left:1px solid var(--gold);border-radius:var(--radius-sm);padding:12px 13px;font-size:12px;line-height:1.5;color:var(--text);">${escHtml(f)}${publicMode ? ' …' : ''}</div>`).join('')}
      ${publicMode ? `<div style="font-size:11.5px;color:var(--muted);margin-top:4px;">Full facts are in the app.</div>` : ''}
    </div>`;
  } else {
    const era = st.era || [0, 0, 0, 0, 0, 0];
    const cards = [];
    if (st.tenure) cards.push(['Median tenure', `${st.tenure.years} yrs`]);
    if (st.wishlisted) cards.push(['Wishlisted', `${st.wishlisted} member${st.wishlisted === 1 ? '' : 's'}`]);
    if (wr.all_time) cards.push(['Wears logged', Number(wr.all_time).toLocaleString()]);
    panel = `<div style="display:flex;flex-direction:column;gap:18px;">
      <div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:34px;font-weight:600;line-height:1;">${owners}</span><span style="font-size:12px;color:var(--muted);">owner${owners === 1 ? '' : 's'}${o.era_min && o.era_max && o.era_min !== o.era_max ? ` · examples from ${escHtml(o.era_min)} to ${escHtml(o.era_max)}` : ''}</span></div>
      ${era.some(n => n > 0) ? sect(H('Ownership by era', `<span style="font-size:10px;color:var(--muted);">year of example</span><span class="mp-badge">Exclusive</span>`) +
        mpBars(era, 56, 4, '2px 2px 0 0') + `<div style="display:flex;gap:4px;margin-top:5px;font-size:9.5px;color:var(--muted);">${['60s', '70s', '80s', '90s', '00s', '10s+'].map(l => `<span style="flex:1;text-align:center;">${l}</span>`).join('')}</div>`) : ''}
      <div style="border-top:1px solid var(--border);padding-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">${cards.map(([l, v]) => `<div class="mp-card" style="padding:11px 12px;"><div class="l">${l}</div><div class="v" style="font-size:17px;">${escHtml(v)}</div></div>`).join('')}</div>
    </div>`;
  }

  // ── More from brand ──
  const rel = (st.related || []).slice(0, 4);
  const more = `<div style="border-top:1px solid var(--border);padding-top:16px;padding-bottom:20px;"><div class="mp-h" style="margin-bottom:10px;">More from ${escHtml(m.brand)}</div>
    <div style="display:flex;flex-direction:column;">${rel.map(r => `<div class="mp-row" data-mp="model" data-id="${escAttr(r.id)}" data-slug="${escAttr(r.slug || '')}"><span style="color:var(--text);">${escHtml(r.name)}</span><span style="color:var(--muted);font-size:11px;">${r.owners} owner${Number(r.owners) === 1 ? '' : 's'}</span></div>`).join('')}
      ${publicMode ? '' : `<div class="mp-row" data-mp="brand" data-brand="${escAttr(m.brand)}"><span style="color:var(--gold-lt);">All ${st.brand_models || rel.length + 1} ${escHtml(m.brand)} models</span><span style="color:var(--muted);font-size:11px;">›</span></div>`}</div></div>`;

  // ── Request an edit + action bar ──
  const reqEdit = publicMode ? '' : `<div style="border-top:1px solid var(--border);padding:14px 0 20px;display:flex;justify-content:center;"><button class="mp-pill" data-mp="edit" data-kind="page edit"><span style="font-size:11px;">✎</span><span>Request an edit</span></button></div>`;
  const wl = st.wishlisted_by_me;
  const actions = publicMode ? `<div style="position:sticky;bottom:0;display:flex;gap:8px;padding:12px 16px 18px;border-top:1px solid var(--border);background:var(--bg);">
    <button class="mp-act" style="font-weight:600;color:#08080c;background:var(--gold);border:0;" data-mp="app">Track yours on WRotate</button></div>` : loggedIn ? `<div style="position:sticky;bottom:0;display:flex;gap:8px;padding:12px 16px 18px;border-top:1px solid var(--border);background:var(--bg);">
    ${isOwner ? `<button class="mp-act" style="font-weight:600;color:#08080c;background:var(--gold);border:0;" data-mp="watch" data-id="${escAttr(mine[0].id)}">Open your ${escHtml(m.name)}${mine.length > 1 ? ` (${mine.length})` : ''}</button>`
              : `<button class="mp-act" style="font-weight:600;color:#08080c;background:var(--gold);border:0;" data-mp="collect">Add to collection</button>`}
    ${wl ? `<button class="mp-act" style="color:var(--muted);background:transparent;border:1px solid var(--border);" disabled>♥ On your wishlist</button>`
         : `<button class="mp-act" style="color:var(--text);background:transparent;border:1px solid var(--border);" data-mp="wish">♡ Add to wishlist</button>`}
  </div>` : '';

  el.innerHTML = hero + grid + band + tabBar +
    `<div id="mp-panel" role="tabpanel" style="padding:16px 16px 8px;display:flex;flex-direction:column;gap:18px;min-height:420px;">${panel}${more}${reqEdit}</div>` + actions;
  if (!el._mpBound) {
    el._mpBound = true;
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-mp]');
      if (!t || !el.contains(t) || !el._mpHandlers) return;
      const H = el._mpHandlers, d = t.dataset;
      switch (d.mp) {
        case 'back': H.back && H.back(); break;
        case 'share': H.share && H.share(); break;
        case 'tab':
          if (d.fact === '1' && H.track) H.track('model_fact_tap', { model: m.slug });
          H.setTab && H.setTab(d.tab, d.scroll === '1'); break;
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
    #page-model { max-width: 480px; margin: 0 auto; padding: 0; }
    .mp-tone-gold { background: var(--gold); } .mp-tone-dim { background: var(--gold-dim); } .mp-tone-flat { background: var(--surface2); }
    .mp-tab { flex:1; text-align:center; padding:12px 0; font-size:12px; cursor:pointer; color:var(--muted); font-weight:400; border-bottom:2px solid transparent; background:none; border-top:0; border-left:0; border-right:0; font-family:inherit; }
    .mp-tab:hover { background: var(--hover); }
    .mp-tab[aria-selected="true"] { color:var(--gold); font-weight:600; border-bottom-color:var(--gold); }
    .mp-badge { font-size:8.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--gold); background:var(--gold-dim); border-radius:var(--radius-pill); padding:3px 7px; white-space:nowrap; }
    .mp-h { font-size:10px; font-weight:600; letter-spacing:var(--ls-eyebrow); text-transform:uppercase; color:var(--muted); }
    .mp-cell { background:var(--surface); padding:13px 14px; }
    .mp-cell .l { font-size:9.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
    .mp-cell .v { font-size:24px; font-weight:600; color:var(--text); margin:4px 0 2px; }
    .mp-cell .f { font-size:9.5px; color:var(--muted); margin-top:5px; }
    .mp-quote:hover { background: var(--hover); }
    .mp-row { display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid var(--border); font-size:12.5px; cursor:pointer; }
    .mp-row:hover { background: var(--hover); }
    .mp-row:last-child { border-bottom:0; }
    .mp-pill { display:inline-flex; align-items:center; gap:6px; font-size:10.5px; font-weight:500; color:var(--muted); border:1px solid var(--border); border-radius:var(--radius-pill); padding:6px 12px; cursor:pointer; background:none; font-family:inherit; }
    .mp-pill:hover { color:var(--gold); border-color:var(--gold); }
    .mp-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm); padding:10px 11px; }
    .mp-card .l { font-size:9.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
    .mp-card .v { font-size:16px; font-weight:600; color:var(--text); margin-top:3px; }
    .mp-act { flex:1; text-align:center; font-size:13px; border-radius:var(--radius-btn); padding:12px; cursor:pointer; font-family:inherit; }
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
