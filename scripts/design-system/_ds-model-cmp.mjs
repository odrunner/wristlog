// The model (reference) page, old (git ref) vs working tree, in BOTH places model-page.js draws it:
// inside the app (#page-model, behind ff_watch_db) and the public link (w/?m=…). Every tab, both themes,
// 390px. Mock data is the same as e2e/model-owners.mock.spec.js so every section renders.
//   compare.sh model [ref]      -> per-view diff + before/after PNGs in $OUT
import { chromium } from '@playwright/test'; import { readFileSync, mkdirSync } from 'fs';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';
const OLD = process.argv[2], OUT = process.argv[3]; mkdirSync(OUT, { recursive: true });
const PROPS = ['display', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'color', 'background-color',
  'border-top-color', 'border-bottom-color', 'border-top-width', 'border-bottom-width', 'border-top-left-radius', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom', 'row-gap', 'column-gap', 'align-items', 'justify-content', 'flex-grow', 'opacity'];
const norm = s => s.replace(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g, (_, r, g, b2, a) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b2 * 255)}, ${a ?? 1})`);

const MODEL_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const WATCH = { id: 'watch-001', user_id: 'test-user-id-000', brand: 'Rolex', name: 'Submariner', ref: '124060', color: '#c9a84c', model_id: MODEL_ID };
const MODEL_ROW = {
  id: MODEL_ID, brand: 'Rolex', name: 'Submariner', slug: 'rolex-submariner',
  specs: { type: 'Dive watch', size: '40–41mm' }, facts_key: 'rolex|submariner', hero_image: null,
  description: 'The archetypal dive watch.',
  history: 'Launched in 1953, it set the template for every diver since.',
  refs_by_era: [{ reference: '5513', years: '1962–1989', note: 'no-date' }, { reference: '124060', years: '2020–present', note: '41mm' }],
  calibers_by_era: [{ caliber: '1520', years: '1962–1989' }, { caliber: '3230', years: '2020–present' }],
};
const OWNERS = { total_owners: 4, era_min: '1968', era_max: '2021', visible: [] };
const FACTS = [{ fact: 'It once dove very deep indeed.', position: 0 }, { fact: 'Second fact about the bezel.', position: 1 }];
const STATS = {
  owners: 4, public_owners: 2, wishlisted: 2, wishlisted_by_me: false, top_ref: '124060',
  wears: { w90: 12, wearers90: 3, all_time: 40 },
  wear_strip: [0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 0, 3, 0, 2], wear_weeks: [0, 1, 2, 1, 3, 0, 2, 1, 0, 2, 0, 3],
  accuracy: { n_sessions: 20, n_measurers: 4, med_rate: -2.9, med_abs_rate: 4.1, med_amp: 260, hist: [0, 1, 2, 3, 5, 4, 3, 1, 1, 0, 0, 0, 0], hist_min: -25, hist_max: 14 },
  value: { median_now: 9000, n_contributors: 5, series: [{ ym: '2026-06', median: 8500, n: 3 }, { ym: '2026-07', median: 8800, n: 4 }, { ym: '2026-08', median: 9000, n: 4 }] },
  cost_per_wear: { median: 96, n_owners: 6, wears: 1204 },
  wear_share: { index: 2.8, share: 34, fair: 12, n_owners: 14, wears: 340, pct_rank: 96, n_models: 1412,
    bench: { brand: 22, type: 19, type_label: 'Dive watch', all: 14 },
    retention: [{ bucket: 'yr 1', share: 41, n: 5 }, { bucket: 'yr 2', share: 36, n: 4 }, { bucket: '5+', share: 31, n: 3 }] },
  era: [0, 1, 0, 0, 1, 2], tenure: { years: 6.5, n: 4 },
  specs_agg: { caliber: { v: '3230', n: 3 } },
  photos: [], brand_models: 14,
  related: [{ id: 'aaaaaaaa-0000-0000-0000-000000000009', brand: 'Rolex', name: 'Submariner Date', slug: 'rolex-submariner-date', owners: 11 }],
  mine: [{ id: 'watch-001', brand: 'Rolex', name: 'Submariner', ref: '124060', last_rate: -1.2 }],
};
const json = (r, d) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });

const b = await chromium.launch();
async function view(side, where, theme) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, baseURL: 'http://localhost:3000' });
  const page = await ctx.newPage();
  if (where === 'app') await mockSupabase(page, { watches: [WATCH] });
  else await page.route('**/rest/v1/**', r => json(r, []));                  // registered first: routes match newest-first
  await page.route('**/rest/v1/watch_models*', r => json(r, MODEL_ROW));
  await page.route('**/rest/v1/rpc/model_owners*', r => json(r, OWNERS));
  await page.route('**/rest/v1/rpc/model_stats*', r => json(r, STATS));
  await page.route('**/rest/v1/watch_facts*', r => json(r, FACTS));
  await page.route('**/rest/v1/rpc/model_page*', r => json(r, { model: MODEL_ROW, owners: OWNERS, teasers: FACTS.map(f => f.fact) }));
  if (side === 'old') {
    const old = f => readFileSync(OLD + '/' + f);
    await page.route(/localhost:3000\/(\?.*)?$/, r => r.fulfill({ body: old('index.html'), contentType: 'text/html' }));
    await page.route(/localhost:3000\/w\/(\?.*)?$/, r => r.fulfill({ body: old('w/index.html'), contentType: 'text/html' }));
    await page.route('**/design-system.css*', r => r.fulfill({ body: old('design-system.css'), contentType: 'text/css' }));
    await page.route('**/model-page.js*', r => r.fulfill({ body: old('model-page.js'), contentType: 'text/javascript' }));
  }
  if (where === 'app') {
    await page.addInitScript(() => { try { localStorage.setItem('ff_watch_db', 'true'); } catch (e) {} });
    await injectSession(page); await page.goto('/'); await waitForAppBoot(page);
    await page.evaluate(id => openModelPage(id), MODEL_ID);
  } else {
    await page.goto('/w/?m=rolex-submariner');
  }
  await page.waitForSelector('#mp-panel', { timeout: 15000 });
  await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important}' });
  const out = {};
  for (const tab of ['data', 'specs', 'owners']) {
    await page.locator(`[data-mp="tab"][data-tab="${tab}"]`).click();
    await page.waitForTimeout(250);
    out[tab] = (await page.evaluate(props => [...document.querySelectorAll('#model-page-content *')].map(e => {
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
        + '§' + props.map(k => cs.getPropertyValue(k)).join('|') + '§' + Math.round(r.width) + 'x' + Math.round(r.height);
    }), PROPS)).map(norm);
    const shot = where === 'app' ? page.locator('#page-model') : page;
    await shot.screenshot({ path: `${OUT}/model-${where}-${tab}-${theme}-${side === 'old' ? 'before' : 'after'}.png`, ...(where === 'app' ? {} : { fullPage: true }) });
  }
  await ctx.close(); return out;
}
let total = 0, diffs = 0;
for (const where of ['app', 'public']) for (const theme of ['light', 'dark']) {
  const [o, n] = [await view('old', where, theme), await view('new', where, theme)];
  for (const tab of ['data', 'specs', 'owners']) {
    const a = o[tab], c = n[tab];
    if (a.length !== c.length) { console.log(`${where} ${tab} ${theme}: ELEMENT COUNT DIFFERS ${a.length} -> ${c.length}`); diffs++; continue; }
    const by = {}; let d = 0;
    a.forEach((v, i) => { const x = v.split('§'), y = c[i].split('§'); if (x[1] !== y[1] || x[2] !== y[2]) { d++;
      const xs = x[1].split('|'), ys = y[1].split('|'); xs.forEach((p, k) => { if (p !== ys[k]) (by[`${PROPS[k]}: ${p} => ${ys[k]}`] ||= new Set()).add(x[0]); });
      if (x[2] !== y[2]) (by[`box ${x[2]} => ${y[2]}`] ||= new Set()).add(x[0]); } });
    total += a.length; diffs += d;
    console.log(`${where.padEnd(6)} ${tab.padEnd(6)} ${theme.padEnd(5)} ${String(a.length).padStart(4)} elements, ${d} differ`);
    for (const [k, s] of Object.entries(by).sort((p, q) => q[1].size - p[1].size).slice(0, +process.env.TOP || 12)) console.log(`    ${String(s.size).padStart(3)} ${k}  e.g. ${[...s].slice(0, 2).join(', ')}`);
  }
}
console.log(`TOTAL ${total} elements; differing: ${diffs}`); await b.close();
