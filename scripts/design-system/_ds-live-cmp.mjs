// Live computed-style diff: every element of every tab + the modals, rendered with JS on and mocked
// data, old (git ref) vs working tree, at phone and desktop width. usage: <oldDir>
import { chromium } from '@playwright/test'; import { readFileSync } from 'fs';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';
const OLD = process.argv[2];
const PROPS = ['display','font-size','font-weight','font-family','line-height','letter-spacing','text-transform','text-align','color','background-color','border-top-left-radius','border-bottom-right-radius','border-top-width','border-top-color','border-top-style','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','row-gap','column-gap','box-shadow','min-height','max-width','align-items','justify-content','cursor','transition-duration','outline-style','opacity','overflow-x','white-space','flex-grow','flex-shrink'];
const WL = [{ id: 'wl1', brand: 'Rolex', name: 'Cosmograph Daytona', ref: '126519LN', price: 42700, added_date: '2026-03-18', wish_privacy: 'public', sort_order: 0 }];
const b = await chromium.launch(); const dump = {};
for (const side of ['old', 'new']) for (const width of [390, 1280]) {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, baseURL: 'http://localhost:3000' }); const page = await ctx.newPage();
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS, wishlist: WL });
  if (side === 'old') { await page.route(/localhost:3000\/(\?.*)?$/, r => r.fulfill({ body: readFileSync(OLD + '/index.html'), contentType: 'text/html' })); await page.route('**/design-system.css*', r => r.fulfill({ body: readFileSync(OLD + '/design-system.css'), contentType: 'text/css' })); }
  await injectSession(page); await page.goto('/'); await waitForAppBoot(page); await page.waitForTimeout(1200);
  const grab = (label) => page.evaluate(([props, label]) => { document.querySelectorAll('.toast,.badge-toast').forEach(t => t.remove());
    return [...document.querySelectorAll('body *')].filter(e => !['SCRIPT', 'STYLE', 'OPTION'].includes(e.tagName)).map(e => { const cs = getComputedStyle(e);
      return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '') + '§' + props.map(k => cs.getPropertyValue(k)).join('|'); }); }, [PROPS, label]);
  for (const pg of ['feed', 'track', 'collection', 'wishlist', 'stats']) { await navigateTo(page, pg); await page.waitForTimeout(700); dump[`${side}:${width}:${pg}`] = await grab(pg); }
  await page.evaluate(() => { if (typeof viewMyProfile === 'function') viewMyProfile(); }); await page.waitForTimeout(1200); dump[`${side}:${width}:profile`] = await grab('profile');
  await ctx.close(); }
await b.close();
let total = 0, diff = 0; const by = {};
for (const k of Object.keys(dump).filter(k => k.startsWith('old:'))) { const o = dump[k], n = dump[k.replace('old:', 'new:')]; const name = k.slice(4);
  if (o.length !== n.length) { console.log(name, 'ELEMENT COUNT DIFFERS', o.length, n.length); diff++; continue; }
  let d = 0; o.forEach((v, i) => { if (v.slice(v.indexOf('§')) !== n[i].slice(n[i].indexOf('§'))) { d++;   /* values only: a new class name is not a change */ const [t, a] = v.split('§'), c = n[i].split('§')[1].split('|'); a.split('|').forEach((x, j) => { if (x !== c[j]) { const key = `${PROPS[j]}: ${x} => ${c[j]}`; (by[key] ||= new Set()).add(t); } }); } });
  total += o.length; diff += d; console.log(`${name.padEnd(18)} ${String(o.length).padStart(5)} elements, ${d} differ`); }
console.log(`TOTAL ${total} elements x ${PROPS.length} props; differing elements: ${diff}`);
for (const [k, s] of Object.entries(by).sort((a, c) => c[1].size - a[1].size).slice(0, 25)) console.log(String(s.size).padStart(5), k, ' e.g.', [...s].slice(0, 3).join(', '));
