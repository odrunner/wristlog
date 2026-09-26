// WRotate — shared model (reference) page renderer. Used by the app
// (index.html, #page-model) and the public page (w/index.html). One
// renderer, one look; the host supplies data (ctx) and handlers (h).
//   WRModelPage.render(el, ctx, h)
//   ctx: { m, o, st, facts, loggedIn, publicMode, canMeasure }
//   h:   { back, share, openModel(id, slug), brandExplore(brand), requestEdit(kind),
//          openWatch(id), measure(id), addToCollection(b, n), addToWishlist(b, n),
//          openPost(id), openProfile(uid, username), follow(uid, btn), isFollowing(uid),
//          openApp, track(event, props) }
// One scroll, no tabs (2026-09-26 cut-down): your watch vs members → story →
// wrist shots → owners → references / calibres / spec → more from the brand.
(function () {
  const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escAttr = escHtml;

  // Stored images are 1500 px originals (~170-245 KB). Supabase Storage render
  // transforms downscale on the fly — /storage/v1/render/image/public/media/…?
  // width=…&height=…&resize=cover returns the box at 2x DPR (never upscaled).
  // data-full carries the original: on any transform error the capture
  // listener below swaps it back in — the same fallback pattern as
  // index.html's initThumbFallback (both listeners are idempotent, so the pair
  // coexists inside the app).
  const MEDIA_MARKER = '/storage/v1/object/public/media/';
  function imgSrcAttrs(url, w, h) {
    if ((url || '').indexOf(MEDIA_MARKER) < 0) return `src="${escAttr(url)}"`;
    const t = url.replace(MEDIA_MARKER, '/storage/v1/render/image/public/media/')
      + (url.indexOf('?') >= 0 ? '&' : '?') + `width=${w}&height=${h}&resize=cover`;
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
function fmtRate(r) {
  const x = Number(r);
  if (!Number.isFinite(x)) return '—';
  // Sign derived AFTER rounding (audit F7): -0.04 used to render as "-0.0 s/d"
  const mag = Math.abs(x).toFixed(1);
  return `${mag === '0.0' ? '' : x > 0 ? '+' : '-'}${mag} s/d`;
}

function featuredFactIndex(count, now = new Date()) {
  const n = Number(count) || 0;
  if (n <= 0) return -1;
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now - start) / 86400000);
  return day % n;
}

function rateStrip(members, you, med) {
  const vals = (members || []).map(Number).filter(Number.isFinite);
  const y = (you == null || you === '') ? NaN : Number(you);
  const all = Number.isFinite(y) ? vals.concat(y) : vals;
  if (!all.length) return null;
  const lo0 = Math.max(-30, Math.min(-5, ...all)), hi0 = Math.min(30, Math.max(5, ...all));
  const step = hi0 - lo0 <= 25 ? 5 : 10;
  const lo = Math.floor(lo0 / step) * step, hi = Math.ceil(hi0 / step) * step;
  const pct = v => Math.round(((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 1000) / 10;
  const ticks = [];
  for (let t = lo; t <= hi; t += step) ticks.push({ v: t, pct: pct(t) });
  const rows = [];
  const dots = vals.slice().sort((a, b) => a - b).map(v => {
    const p = pct(v);
    let r = 0;
    while (r < 3 && rows[r] != null && p - rows[r] < 3) r++;
    rows[r] = p;
    return { v, pct: p, row: r, clamped: v < lo || v > hi };
  });
  const m = (med == null || med === '') ? NaN : Number(med);
  return { lo, hi, step, ticks, dots, you: Number.isFinite(y) ? pct(y) : null, med: Number.isFinite(m) ? pct(m) : null };
}

function agoText(iso, now = new Date()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = Math.floor((now - t) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 730) return `${Math.round(d / 30)} months ago`;
  return `${Math.round(d / 365)} years ago`;
}


const minus = v => String(v).replace('-', '−');
const rateNum = r => minus(fmtRate(r).replace(' s/d', ''));
const plural = (n, one, many) => `${n} ${Number(n) === 1 ? one : (many || one + 's')}`;

// The members' strip: one dot per member (their typical reading), a dashed
// median line, and the viewer's own last reading as a gold marker.
function stripHtml(s) {
  const tick = (t, i) => `<span class="mp-tick${i === 0 ? ' first' : i === s.ticks.length - 1 ? ' last' : ''}" style="left:${t.pct}%;">${t.v > 0 ? '+' + t.v : minus(t.v)}</span>`;
  return `<div class="mp-strip" aria-hidden="true">
      <div class="mp-axis"></div>
      ${s.med != null ? `<div class="mp-med" style="left:${s.med}%;"></div>` : ''}
      ${s.dots.map(d => `<div class="mp-dot r${d.row}" style="left:${d.pct}%;"></div>`).join('')}
      ${s.you != null ? `<div class="mp-you" style="left:${s.you}%;"></div>` : ''}
    </div>
    <div class="mp-ticks">${s.ticks.map(tick).join('')}</div>`;
}

function renderModelPage(el, ctx, h) {
  const { m, o, st, facts } = ctx;
  const key = m.id || m.slug;
  if (el._mpHistoryOpenFor && el._mpHistoryOpenFor !== key) el._mpHistoryOpenFor = null;
  const loggedIn = !!ctx.loggedIn, publicMode = !!ctx.publicMode;
  const sp = m.specs || {};
  const owners = (st.owners ?? o.total_owners) || 0;
  const mine = st.mine || [];
  const isOwner = mine.length > 0;
  const refs = Array.isArray(m.refs_by_era) ? m.refs_by_era : [];
  const cals = Array.isArray(m.calibers_by_era) ? m.calibers_by_era : [];

  // ── Hero ──
  const heroImg = m.hero_image || (st.photos || [])[0] || '';
  const ref = (refs.length ? refs[refs.length - 1].reference : '') || st.top_ref || '';
  const agg = st.specs_agg || {};
  const captionBits = [sp.type ? sp.type.replace(/ watch$/i, '') : '', sp.size || (agg.case_diameter ? agg.case_diameter.v : ''),
    sp.water_resistance || (agg.water_resistance ? agg.water_resistance.v : ''),
    agg.movement_type ? agg.movement_type.v : '',
    (o.era_min && o.era_max && o.era_min !== o.era_max) ? `${o.era_min}–${o.era_max}` : ''].filter(Boolean);
  const hero = `<div class="u-h-45 u-bg-surface2" style="position:relative;overflow:hidden;">
    ${heroImg ? `<img ${imgSrcAttrs(heroImg, 960, 360)} alt="" fetchpriority="high" class="u-w-100pct u-h-100pct u-of-cover" style="position:absolute;inset:0;">` : ''}
    <div class="u-bg-linear-gradient-to-right-color-mix-in-srgb-black-90pct-transparent-0pct-color-mix-in-srgb-black-35pct-transparent-55pct-color-mix-in-srgb-black-10pct-transparent-100pct" style="position:absolute;inset:0;pointer-events:none;"></div>
    <div class="u-justify-space-between u-fs-sm u-c-mix-white-85 u-d-flex" style="position:absolute;top:var(--size-3-5);left:var(--size-4);right:var(--size-4);">
      <span role="button" tabindex="0" class="u-cur-pointer" data-mp="back">‹ Back</span>
      <span role="button" tabindex="0" class="u-cur-pointer" data-mp="share">Share</span>
    </div>
    <div style="position:absolute;left:var(--size-4);bottom:var(--size-3-5);right:var(--size-4);pointer-events:none;">
      <div class="u-fs-2xs u-fw-semibold u-ls-wide u-tt-uppercase u-c-gold-lt">${escHtml(m.brand)}${ref ? ` · ref. ${escHtml(ref)}` : ''}</div>
      <h1 class="mp-title">${escHtml(m.name)}</h1>
      <div class="u-fs-xs u-c-mix-white-70">${escHtml(captionBits.join(' · '))}</div>
    </div>
  </div>${m.hero_image && m.hero_credit ? `<div class="u-fs-3xs u-c-muted u-ta-right u-pt-1 u-pr-2-5 u-pb-0 u-pl-2-5 u-bg-bg">${escHtml(m.hero_credit)}</div>` : ''}`;

  const desc = m.description && m.history ? `<p class="mp-desc">${escHtml(m.description)}</p>` : '';
  const solo = isOwner && owners <= 1 ? `<div class="mp-solo">You're the only member with one</div>` : '';

  // ── Your watch / how they run ──
  // Model-level readings when >= 3 members measured one; else the same
  // calibre across every model (model_stats decides, floors included).
  const acc = st.accuracy, cal = st.caliber;
  const pool = acc || cal;
  const calLabel = cal ? String(cal.key || '').toUpperCase() : '';
  const me = isOwner ? mine[0] : null;
  const myRate = me && me.last_rate != null ? Number(me.last_rate) : null;
  let yours = '';
  if (me || pool) {
    const s = pool ? rateStrip(pool.members, myRate, pool.med) : null;
    const within = pool ? (pool.members || []).filter(v => Math.abs(Number(v)) <= 5).length : 0;
    let head, big, sub;
    if (me) {
      const refBits = [me.ref, me.caliber ? `cal. ${me.caliber}` : ''].filter(Boolean).join(' · ');
      head = `<div class="mp-yours-top"><div class="mp-eyebrow">Your ${escHtml(m.name)}</div>${refBits ? `<div class="mp-yours-ref">${escHtml(refBits)}</div>` : ''}</div>`;
      if (myRate != null) {
        big = `<div class="mp-rate"><span class="mp-rate-v">${rateNum(myRate)}</span><span class="mp-rate-u">s/day</span></div>`;
        const when = agoText(me.last_at);
        sub = [when ? `Measured ${when}` : '', me.last_amp ? `${me.last_amp}° amplitude` : ''].filter(Boolean).join(' · ');
      } else {
        big = `<div class="mp-rate-none">Not measured yet</div>`;
        sub = pool ? 'Measure it to see where it sits among members’ watches.' : '';
      }
    } else {
      head = `<div class="mp-eyebrow">${acc ? 'How they run' : `How calibre ${escHtml(calLabel)} runs`}</div>`;
      big = `<div class="mp-rate"><span class="mp-rate-v">${rateNum(pool.med)}</span><span class="mp-rate-u">s/day median</span></div>`;
      sub = `${plural(pool.n_members, 'member')} measured ${acc ? 'theirs' : 'one'} · ${within} of ${pool.n_members} within ±5 s/d`;
    }
    const legend = pool ? `<div class="mp-legend">
        <div class="mp-legend-row"><span class="mp-key-dot"></span><span>${acc
          ? `${plural(pool.n_members, 'member')}’ ${escHtml(m.name)} · median <b>${rateNum(pool.med)}</b> s/d`
          : `${plural(pool.n_members, 'member')}’ calibre ${escHtml(calLabel)} watches · median <b>${rateNum(pool.med)}</b> s/d`}</span></div>
        ${myRate != null ? `<div class="mp-legend-row"><span class="mp-key-you"></span><span>Your watch</span></div>` : ''}
      </div>
      <div class="mp-note">Each dot is one member’s typical reading.${acc ? '' : ` Not enough members have measured a ${escHtml(m.name)} yet, so this compares the movement inside — ${plural(cal.n_models, 'model')} on WRotate.`}</div>`
      : `<div class="mp-note">Once 3 members have measured one, you’ll see how yours compares.</div>`;
    yours = `<section class="mp-yours" id="mp-yours">${head}${big}${sub ? `<div class="mp-note">${escHtml(sub)}</div>` : ''}${s ? stripHtml(s) : ''}${legend}</section>`;
  }

  // ── Story: history + fact pull-quote ──
  if (el._mpFactFor !== key) { el._mpFactFor = key; el._mpFactIdx = featuredFactIndex(facts.length); }
  const fi = facts.length ? ((el._mpFactIdx || 0) % facts.length) : -1;
  const storyText = (m.history || m.description || '').trim();
  const histOpen = el._mpHistoryOpenFor === key;
  let story = '';
  if (storyText || fi >= 0) {
    story = `<section id="mp-story" class="mp-sec">
      ${storyText ? `<h2 class="mp-sec-h mp-sec-gap">The story</h2>
        <div id="mp-history" class="mp-history${histOpen ? ' open' : ''}">${escHtml(storyText)}</div>
        <button type="button" id="mp-history-toggle" data-mp="history" class="mp-link hidden">${histOpen ? 'Less' : 'Read the full history'}</button>` : ''}
      ${fi >= 0 ? `<div class="mp-quote mp-fact${storyText ? ' mp-fact-gap' : ''}">
        ${facts.length > 1 ? `<button type="button" data-mp="fact-prev" aria-label="Previous fact" class="mp-fact-nav">‹</button>` : ''}
        <div class="u-flex-1 u-minw-0">
          <div id="mp-fact-kicker" class="mp-eyebrow">Fun fact · ${fi + 1} of ${facts.length}</div>
          <div id="mp-fact-body" class="mp-fact-body">${escHtml(facts[fi])}${publicMode ? ' …' : ''}</div>
        </div>
        ${facts.length > 1 ? `<button type="button" data-mp="fact-next" aria-label="Next fact" class="mp-fact-nav">›</button>` : ''}
      </div>` : ''}
    </section>`;
  }

  // ── Wrist shots (public posts) ──
  const shots = (st.shots || []).slice(0, 6);
  const shotsHtml = shots.length ? `<section class="mp-sec" id="mp-shots">
      <div class="mp-sec-hrow"><h2 class="mp-sec-h">On members’ wrists</h2><span class="mp-sub">${plural(st.shots_total || shots.length, 'photo')}</span></div>
      <div class="mp-shots">${shots.map(p => `<button type="button" class="mp-shot" data-mp="post" data-id="${escAttr(p.id)}" aria-label="Open post"><img ${imgSrcAttrs(p.url, 240, 240)} alt="" loading="lazy"></button>`).join('')}</div>
    </section>` : '';

  // ── Owners you can follow (model_owners: names only where privacy allows) ──
  const vis = (o.visible || []).slice(0, 5);
  let ownersHtml = '';
  if (vis.length || owners > 1) {
    const row = v => {
      const name = v.display_name || v.username || 'Member';
      const init = escHtml(String(name).trim().charAt(0).toUpperCase() || '?');
      const followBtn = !publicMode && loggedIn && h && h.isFollowing
        ? (h.isFollowing(v.user_id) ? `<span class="mp-following">Following</span>`
          : `<button type="button" class="follow-btn follow" data-mp="follow" data-uid="${escAttr(v.user_id)}">Follow</button>`) : '';
      return `<div class="mp-owner" role="button" tabindex="0" data-mp="owner" data-uid="${escAttr(v.user_id)}" data-username="${escAttr(v.username || '')}">
        <span class="mp-owner-av">${v.avatar_url ? `<img src="${escAttr(v.avatar_url)}" alt="">` : init}</span>
        <span class="mp-owner-txt"><span class="mp-owner-name">${escHtml(name)}</span>${v.username ? `<span class="mp-owner-meta">@${escHtml(v.username)}</span>` : ''}</span>
        ${followBtn}
      </div>`;
    };
    ownersHtml = `<section class="mp-sec" id="mp-owners">
      <h2 class="mp-sec-h">${plural(owners, 'member')} ${owners === 1 ? 'owns' : 'own'} one</h2>
      <div class="mp-sub mp-sec-gap">${vis.length ? (publicMode ? 'Public collections' : 'Owners whose collections you can see') : (publicMode ? 'No public collections yet.' : 'Their collections aren’t visible to you.')}</div>
      ${vis.length ? `<div class="mp-list">${vis.map(row).join('')}</div>` : ''}
    </section>`;
  }

  // ── References, calibres, spec ──
  const myRefs = new Set(mine.map(w => String(w.ref || '').trim().toUpperCase()).filter(Boolean));
  const refsHtml = refs.length ? `<section class="mp-sec" id="mp-refs">
      <h2 class="mp-sec-h mp-sec-gap">References by era</h2>
      <div class="mp-list">${refs.map(r => {
        const yoursRef = myRefs.has(String(r.reference || '').trim().toUpperCase());
        return `<div class="mp-ref${yoursRef ? ' mine' : ''}"><div class="mp-ref-top"><b>${escHtml(r.reference || '')}</b><span class="mp-sub">${escHtml(r.years || '')}</span></div>
          ${yoursRef || r.note ? `<div class="mp-ref-note">${yoursRef ? '<span class="mp-ref-yours">Yours</span> ' : ''}${escHtml(r.note || '')}</div>` : ''}</div>`;
      }).join('')}</div>
      ${cals.length ? `<div class="mp-cals">${cals.map(c => `<span class="mp-cal"><b>${escHtml(c.caliber || '')}</b>${c.years ? `<span class="mp-sub">${escHtml(c.years)}</span>` : ''}</span>`).join('')}</div>` : ''}
    </section>` : '';
  const refRows = [['Size', sp.size], ['Water resistance', sp.water_resistance], ['Movement', sp.movement], ['Materials', sp.materials]].filter(r => r[1]);
  const aggRows = [['caliber', 'Calibre'], ['case_diameter', 'Case'], ['water_resistance', 'Water resistance'], ['movement_type', 'Movement'], ['case_material', 'Material'], ['year_range', 'Produced']]
    .filter(([k]) => agg[k]).map(([k, l]) => [l, agg[k].v]);
  const specRows = refRows.length ? refRows : aggRows;
  const specHtml = specRows.length ? `<section class="mp-sec" id="mp-spec">
      <h2 class="mp-sec-h mp-sec-gap">${refRows.length ? 'Reference spec' : 'From members’ watches'}</h2>
      <div class="mp-specs">${specRows.map(([l, v]) => `<div class="mp-spec"><div class="l">${l}</div><div class="v">${escHtml(v)}</div></div>`).join('')}</div>
    </section>` : '';

  // ── More from brand ──
  const rel = (st.related || []).slice(0, 4);
  const more = rel.length ? `<section class="mp-sec" id="mp-more">
      <div class="mp-sec-hrow"><h2 class="mp-sec-h">More from ${escHtml(m.brand)}</h2>${publicMode ? '' : `<button type="button" class="mp-link" data-mp="brand" data-brand="${escAttr(m.brand)}">All ${st.brand_models || rel.length + 1} models</button>`}</div>
      <div class="mp-rel">${rel.map(r => `<button type="button" class="mp-rel-card" data-mp="model" data-id="${escAttr(r.id)}" data-slug="${escAttr(r.slug || '')}"><span class="mp-rel-name">${escHtml(r.name)}</span><span class="mp-sub">${plural(r.owners, 'member')}</span></button>`).join('')}</div>
    </section>` : '';

  // ── Request an edit + action bar ──
  const reqEdit = publicMode ? '' : `<div class="mp-edit"><button class="mp-pill" data-mp="edit" data-kind="page edit"><span class="u-fs-xs">✎</span><span>Request an edit</span></button></div>`;
  const wl = st.wishlisted_by_me;
  let actions = '';
  if (publicMode) {
    actions = `<div class="mp-actions"><button class="mp-act mp-act-primary" data-mp="app">Track yours on WRotate</button></div>`;
  } else if (loggedIn && isOwner) {
    const n = mine.length > 1 ? ` (${mine.length})` : '';
    actions = `<div class="mp-actions">${ctx.canMeasure
      ? `<button class="mp-act mp-act-primary" data-mp="measure" data-id="${escAttr(me.id)}">${myRate != null ? 'Measure again' : 'Measure it'}</button>
         <button class="mp-act mp-act-ghost" data-mp="watch" data-id="${escAttr(me.id)}">Open your watch${n}</button>`
      : `<button class="mp-act mp-act-primary" data-mp="watch" data-id="${escAttr(me.id)}">Open your ${escHtml(m.name)}${n}</button>`}</div>`;
  } else if (loggedIn) {
    actions = `<div class="mp-actions">
      <button class="mp-act mp-act-primary" data-mp="collect">I own one</button>
      ${wl ? `<button class="mp-act mp-act-ghost" disabled>♥ On your wishlist</button>`
           : `<button class="mp-act mp-act-ghost" data-mp="wish">♡ Want one</button>`}</div>`;
  }

  el.innerHTML = hero + desc + solo + yours + story + shotsHtml + ownersHtml + refsHtml + specHtml + more + reqEdit + actions;
  if (!el._mpBound) {
    el._mpBound = true;
    const act = (e, t) => {
      const H = el._mpHandlers, d = t.dataset, c = el._mpCtx;
      const fs = c.facts, mm = c.m, pub = !!c.publicMode;
      switch (d.mp) {
        case 'back': H.back && H.back(); break;
        case 'share': H.share && H.share(); break;
        case 'fact-prev':
        case 'fact-next': {
          if (!fs.length) break;
          const step = d.mp === 'fact-prev' ? -1 : 1;
          el._mpFactIdx = (((el._mpFactIdx || 0) + step) % fs.length + fs.length) % fs.length;
          const k = el.querySelector('#mp-fact-kicker'), bd = el.querySelector('#mp-fact-body');
          if (k) k.textContent = `Fun fact · ${el._mpFactIdx + 1} of ${fs.length}`;
          if (bd) bd.textContent = fs[el._mpFactIdx] + (pub ? ' …' : '');
          if (H.track) H.track('model_fact_next', { model: mm.slug, index: el._mpFactIdx, dir: step });
          break;
        }
        case 'history': {
          const hist = el.querySelector('#mp-history');
          if (!hist) break;
          const k = mm.id || mm.slug;
          const open = el._mpHistoryOpenFor === k;
          el._mpHistoryOpenFor = open ? null : k;
          hist.classList.toggle('open', !open);
          t.textContent = open ? 'Read the full history' : 'Less';
          if (!open && H.track) H.track('model_history_expand', { model: mm.slug, overflowed: true });
          break;
        }
        case 'model': H.openModel && H.openModel(d.id, d.slug); break;
        case 'brand': H.brandExplore && H.brandExplore(d.brand); break;
        case 'edit': H.requestEdit && H.requestEdit(d.kind); break;
        case 'watch': H.openWatch && H.openWatch(d.id); break;
        case 'measure': H.measure && H.measure(d.id); break;
        case 'post': H.openPost && H.openPost(d.id); if (H.track) H.track('model_shot_open', { model: mm.slug }); break;
        case 'owner': H.openProfile && H.openProfile(d.uid, d.username); break;
        case 'follow': e.stopPropagation(); H.follow && H.follow(d.uid, t); if (H.track) H.track('model_owner_follow', { model: mm.slug }); break;
        case 'collect': H.addToCollection && H.addToCollection(mm.brand, mm.name); break;
        case 'wish': H.addToWishlist && H.addToWishlist(mm.brand, mm.name); break;
        case 'app': H.openApp && H.openApp(); break;
      }
    };
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-mp]');
      if (!t || !el.contains(t) || !el._mpHandlers) return;
      act(e, t);
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('button, a')) return;   // native controls already click
      const t = e.target.closest('[role="button"][data-mp]');
      if (!t || !el.contains(t) || !el._mpHandlers) return;
      e.preventDefault();
      act(e, t);
    });
  }
  el._mpHandlers = h || {};
  el._mpCtx = ctx;
  // Show the expand toggle only when the clamped paragraph actually overflows.
  requestAnimationFrame(() => {
    const hist = el.querySelector('#mp-history'), tg = el.querySelector('#mp-history-toggle');
    if (hist && tg) tg.classList.toggle('hidden', !(histOpen || hist.scrollHeight > hist.clientHeight + 1));
  });
}


  const CSS = `
    /* Reference (model) page — one scroll, 390px column (cut-down 2026-09-26) */
    #page-model { max-width: var(--size-120); margin: 0 auto; padding: 0 0 var(--space-2); }
    .mp-title { font-size: var(--fs-3xl); font-weight: var(--fw-semibold); letter-spacing: var(--ls-display); line-height: var(--lh-tight); color: var(--white); margin: var(--space-1) 0 var(--space-1-5); }
    .mp-desc { margin: 0; padding: var(--space-3-5) var(--space-4) 0; font-size: var(--fs-base); line-height: var(--lh-snug); color: var(--muted); }
    .mp-solo { display: inline-block; margin: var(--space-3) var(--space-4) 0; padding: var(--space-1-5) var(--space-3); border-radius: var(--radius-pill); background: var(--gold-dim); color: var(--gold-text); font-size: var(--fs-base); font-weight: var(--fw-semibold); }
    .mp-sec { padding: var(--space-6) var(--space-4) 0; }
    .mp-sec-h { margin: 0; font-size: var(--fs-xl); font-weight: var(--fw-bold); color: var(--text); }
    .mp-sec-gap { margin-bottom: var(--space-2-5); }
    .mp-sec-hrow { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-2-5); }
    .mp-sub { font-size: var(--fs-sm); color: var(--muted); }
    .mp-eyebrow { font-size: var(--fs-2xs); font-weight: var(--fw-bold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--gold-text); }
    .mp-link { background: none; border: 0; padding: var(--space-1) 0; font-family: inherit; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--gold-text); cursor: pointer; }
    /* your watch / how they run */
    .mp-yours { margin: var(--space-4) var(--space-4) 0; padding: var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
    .mp-yours-top { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); }
    .mp-yours-ref { font-size: var(--fs-sm); color: var(--muted); text-align: right; }
    .mp-rate { display: flex; align-items: baseline; gap: var(--space-1-5); margin-top: var(--space-1-5); }
    .mp-rate-v { font-size: var(--fs-4xl); font-weight: var(--fw-bold); line-height: var(--lh-tight); letter-spacing: var(--ls-display); color: var(--text); }
    .mp-rate-u { font-size: var(--fs-body); color: var(--muted); }
    .mp-rate-none { margin-top: var(--space-1-5); font-size: var(--fs-xl); font-weight: var(--fw-semibold); color: var(--text); }
    .mp-note { margin-top: var(--space-1); font-size: var(--fs-sm); line-height: var(--lh-snug); color: var(--muted); }
    .mp-strip { position: relative; height: var(--size-14); margin-top: var(--space-4); }
    .mp-axis { position: absolute; left: 0; right: 0; bottom: var(--size-2); height: var(--size-px); background: var(--border); }
    .mp-med { position: absolute; top: 0; bottom: var(--size-2); border-left: 1px dashed var(--muted); }
    .mp-dot { position: absolute; width: var(--size-2); height: var(--size-2); margin-left: calc(-1 * var(--size-1)); border-radius: var(--radius-round); background: var(--muted); }
    .mp-dot.r0 { bottom: var(--size-3); } .mp-dot.r1 { bottom: var(--size-5); } .mp-dot.r2 { bottom: var(--size-7); } .mp-dot.r3 { bottom: var(--size-9); }
    .mp-you { position: absolute; bottom: 0; box-sizing: border-box; width: var(--size-4); height: var(--size-4); margin-left: calc(-1 * var(--size-2)); border-radius: var(--radius-round); border: 2px solid var(--surface); background: var(--gold); box-shadow: var(--shadow-1); }
    .mp-ticks { position: relative; height: var(--size-4); margin-top: var(--space-1); font-size: var(--fs-2xs); color: var(--muted); }
    .mp-tick { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
    .mp-tick.first { transform: none; } .mp-tick.last { transform: translateX(-100%); }
    .mp-legend { display: flex; flex-direction: column; gap: var(--space-1-5); margin-top: var(--space-3); font-size: var(--fs-base); color: var(--text); }
    .mp-legend-row { display: flex; align-items: flex-start; gap: var(--space-2); }
    .mp-key-dot { flex: none; width: var(--size-2); height: var(--size-2); margin: var(--space-1-5) var(--space-0-5) 0; border-radius: var(--radius-round); background: var(--muted); }
    .mp-key-you { flex: none; width: var(--size-3); height: var(--size-3); margin-top: var(--space-1); border-radius: var(--radius-round); background: var(--gold); }
    /* story */
    .mp-history { font-size: var(--fs-md); line-height: var(--lh-body); color: var(--text); text-wrap: pretty; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
    .mp-history.open { -webkit-line-clamp: unset; }
    .mp-fact { display: flex; align-items: flex-start; gap: var(--space-1); padding: var(--space-3) var(--space-1); border-radius: var(--radius); background: var(--gold-dim); }
    .mp-fact-gap { margin-top: var(--space-3-5); }
    .mp-fact > .u-flex-1 { padding: var(--space-1) var(--space-1); }
    .mp-fact-body { margin-top: var(--space-1); font-size: var(--fs-md); line-height: var(--lh-snug); color: var(--text); text-wrap: pretty; }
    .mp-fact-nav { flex: none; width: var(--size-9); min-height: var(--size-11); display: flex; align-items: center; justify-content: center; background: none; border: 0; color: var(--gold-text); font-size: var(--fs-xl); cursor: pointer; font-family: inherit; border-radius: var(--radius-sm); }
    .mp-fact-nav:hover { background: var(--gold-dim); }
    /* wrist shots */
    .mp-shots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-1); }
    .mp-shot { display: block; aspect-ratio: 1; padding: 0; border: 0; border-radius: var(--radius-sm); overflow: hidden; background: var(--surface2); cursor: pointer; }
    .mp-shot img { display: block; width: 100%; height: 100%; object-fit: cover; }
    /* owners */
    .mp-list { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .mp-owner { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2-5) var(--space-3); border-bottom: 1px solid var(--border); cursor: pointer; }
    .mp-owner:last-child { border-bottom: 0; }
    .mp-owner:hover { background: var(--surface2); }
    .mp-owner-av { flex: none; width: var(--size-10); height: var(--size-10); border-radius: var(--radius-round); overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--surface2); color: var(--muted); font-weight: var(--fw-bold); }
    .mp-owner-av img { width: 100%; height: 100%; object-fit: cover; }
    .mp-owner-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .mp-owner-name { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mp-owner-meta { font-size: var(--fs-sm); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mp-following { font-size: var(--fs-sm); color: var(--muted); }
    /* references, calibres, spec */
    .mp-ref { padding: var(--space-2-5) var(--space-3-5); border-bottom: 1px solid var(--border); font-size: var(--fs-md); }
    .mp-ref:last-child { border-bottom: 0; }
    .mp-ref.mine { background: var(--gold-dim); }
    .mp-ref-top { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); }
    .mp-ref-note { font-size: var(--fs-sm); color: var(--muted); }
    .mp-ref-yours { font-weight: var(--fw-semibold); color: var(--gold-text); }
    .mp-cals { display: flex; flex-wrap: wrap; gap: var(--space-1-5); margin-top: var(--space-2-5); }
    .mp-cal { display: inline-flex; flex-direction: column; align-items: center; padding: var(--space-1-5) var(--space-3); border-radius: var(--radius-sm); background: var(--surface2); font-size: var(--fs-base); }
    .mp-specs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
    .mp-spec { padding: var(--space-2-5) var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
    .mp-spec .l { font-size: var(--fs-sm); color: var(--muted); }
    .mp-spec .v { font-size: var(--fs-md); font-weight: var(--fw-semibold); color: var(--text); }
    /* more from brand */
    .mp-rel { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
    .mp-rel-card { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-0-5); padding: var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); font-family: inherit; text-align: left; cursor: pointer; }
    .mp-rel-card:hover { border-color: var(--gold); }
    .mp-rel-name { font-size: var(--fs-md); font-weight: var(--fw-semibold); color: var(--text); }
    .mp-edit { display: flex; justify-content: center; padding: var(--space-5) 0; }
    .mp-pill { display:inline-flex; align-items:center; gap:var(--space-1-5); font-size:var(--fs-xs); font-weight:var(--fw-medium); color:var(--muted); border:1px solid var(--border); border-radius:var(--radius-pill); padding:var(--space-1-5) var(--space-3); cursor:pointer; background:none; font-family:inherit; }
    .mp-pill:hover { color:var(--gold-text); border-color:var(--gold); }
    /* action bar */
    .mp-actions { position:sticky; bottom:0; display:flex; gap:var(--space-2); padding:var(--space-3) var(--space-4) var(--space-5); border-top:1px solid var(--border); background:var(--bg); }
    .mp-act { flex:1; min-height: var(--size-11); text-align:center; font-size:var(--fs-base); border-radius:var(--radius-btn); padding:var(--space-3); cursor:pointer; font-family:inherit; }
    .mp-act-primary { font-weight:var(--fw-semibold); color:var(--black); background:var(--gold); border:0; }
    .mp-act-ghost { color:var(--text); background:transparent; border:1px solid var(--border); }
    .mp-act-ghost:disabled { color:var(--muted); }
  `;
  function injectStyles() {
    if (document.getElementById('wr-model-page-css')) return;
    const st = document.createElement('style'); st.id = 'wr-model-page-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  window.WRModelPage = {
    render(el, ctx, h) { injectStyles(); return renderModelPage(el, ctx, h); },
    fmtRate, featuredFactIndex, rateStrip, agoText,
  };
})();
