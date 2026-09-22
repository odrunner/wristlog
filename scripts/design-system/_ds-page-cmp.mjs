// Small public pages, old vs new, on mocked data: p/ (share), profile/, w/ (model), privacy, terms.
//   compare.sh pages [ref]     -> computed-style + box diff per page/theme, and before/after PNGs in $OUT
import { chromium } from 'playwright'; import { readFileSync, existsSync, mkdirSync } from 'fs';
const C = process.argv[2], OUT = process.argv[3]; mkdirSync(OUT, { recursive: true });
const PROPS = ['display','font-size','font-weight','font-family','line-height','letter-spacing','text-transform','color','background-color','border-top-color','border-top-left-radius','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-bottom','row-gap','column-gap','box-shadow','opacity'];
const norm = s => s.replace(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g, (_, r, g, b2, a) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b2 * 255)}, ${a ?? 1})`);
const PAGES = { 'p/?id=log-1': 'share', 'profile/?u=testuser': 'profile', 'w/?m=rolex-submariner-date': 'model', 'privacy.html': 'privacy', 'terms.html': 'terms' };
const PROFILE = { id: 'u1', username: 'testuser', display_name: 'Test User', bio: 'Collector of tool watches. Wears what he measures.', avatar_url: null, profile_privacy: 'public', collection_visibility: 'public', is_official: false };
const WATCHES = [{ id: 'w1', brand: 'Rolex', name: 'Submariner Date', image: null, watch_privacy: 'public' }, { id: 'w2', brand: 'Omega', name: 'Speedmaster Professional', image: null, watch_privacy: 'public' }, { id: 'w3', brand: 'Seiko', name: 'SKX007', image: null, watch_privacy: null }];
const LOG = { id: 'log-1', user_id: 'u1', watch_id: 'w1', photo_url: null, notes: 'First swim of the season with the Sub. Bezel action still perfect after the service.', use_case: 'Swimming', date: '2026-09-20', created_at: '2026-09-20T10:00:00Z', visibility: 'public' };
const LOGS = [{ watch_id: 'w1', date: '2026-09-20' }, { watch_id: 'w1', date: '2026-09-19' }, { watch_id: 'w2', date: '2026-09-18' }];
const b = await chromium.launch();
async function render(side, path, theme) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const p = await ctx.newPage();
  await p.route('http://ds.test/**', r => { const u = new URL(r.request().url()); let f = u.pathname; if (f.endsWith('/')) f += 'index.html';
    const file = C + '/' + side + f; if (!existsSync(file)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: readFileSync(file), contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html' }); });
  const json = (r, data) => { const one = /pgrst\.object/.test(r.request().headers()['accept'] || ''); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(one ? (Array.isArray(data) ? data[0] ?? null : data) : (Array.isArray(data) ? data : [data])) }); };
  await p.route('**/rest/v1/**', r => json(r, []));                  // registered FIRST: Playwright tries routes newest-first
  await p.route('**/rest/v1/page_visits*', r => r.fulfill({ status: 201, contentType: 'application/json', body: '[]' }));
  await p.route('**/rest/v1/logs*', r => json(r, r.request().url().includes('select=watch_id') ? LOGS : [LOG]));
  await p.route('**/rest/v1/profiles*', r => json(r, [PROFILE]));
  await p.route('**/rest/v1/watches*', r => json(r, r.request().url().includes('id=eq.w1') ? [WATCHES[0]] : WATCHES));
  await p.route('**/rest/v1/rpc/model_page*', r => json(r, { id: 'm1', slug: 'rolex-submariner-date', brand: 'Rolex', name: 'Submariner Date', ref: '126610LN', image: null, owners: 12 }));
  await p.route('**/rest/v1/rpc/model_stats*', r => json(r, { owners: 12, wears: 340, avg_rate: 1.2 }));
  await p.goto('http://ds.test/' + path, { waitUntil: 'load' }); await p.waitForTimeout(1200);
  await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme); await p.waitForTimeout(150);
  const rows = (await p.evaluate(props => [...document.querySelectorAll('body *')].filter(e => !['SCRIPT', 'STYLE'].includes(e.tagName)).map(e => { const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    return (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + '§' + props.map(k => cs.getPropertyValue(k)).join('|') + '§' + Math.round(r.width) + 'x' + Math.round(r.height); }), PROPS)).map(norm);
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  await p.screenshot({ path: `${OUT}/${PAGES[path]}-${theme}-${side === 'old' ? 'before' : 'after'}.png`, fullPage: true });
  await ctx.close(); return { rows, h };
}
let total = 0, diffs = 0;
for (const path of Object.keys(PAGES)) for (const theme of ['light', 'dark']) {
  const [o, n] = [await render('old', path, theme), await render('new', path, theme)];
  if (o.rows.length !== n.rows.length) { console.log(`${PAGES[path]} ${theme}: ELEMENT COUNT DIFFERS ${o.rows.length} -> ${n.rows.length}`); diffs++; continue; }
  const by = {}; let d = 0;
  o.rows.forEach((v, i) => { const a = v.split('§'), c = n.rows[i].split('§'); if (a[1] !== c[1] || a[2] !== c[2]) { d++; a[1].split('|').forEach((x, k) => { if (x !== c[1].split('|')[k]) (by[`${PROPS[k]}: ${x} => ${c[1].split('|')[k]}`] ||= new Set()).add(a[0]); }); if (a[2] !== c[2]) (by[`box ${a[2]} => ${c[2]}`] ||= new Set()).add(a[0]); } });
  total += o.rows.length; diffs += d;
  console.log(`${PAGES[path].padEnd(8)} ${theme.padEnd(5)} ${String(o.rows.length).padStart(4)} elements, ${d} differ; page h ${o.h} -> ${n.h}`);
  for (const [k, s] of Object.entries(by).sort((x, y) => y[1].size - x[1].size).slice(0, 40)) console.log(`    ${String(s.size).padStart(3)} ${k}  e.g. ${[...s].slice(0, 2).join(', ')}`);
}
console.log(`TOTAL ${total} elements; differing: ${diffs}`); await b.close();
