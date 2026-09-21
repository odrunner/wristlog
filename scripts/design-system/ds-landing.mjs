import { chromium } from 'playwright'; import { readFileSync } from 'fs';
const C = process.argv[2]; const PROPS = ['font-size','font-weight','line-height','letter-spacing','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','row-gap','column-gap','border-top-left-radius','width','height'];
const b = await chromium.launch(); const out = {};
for (const side of ['old','new']) { const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  await p.route('http://ds.test/**', r => { const u = new URL(r.request().url()); let f = u.pathname; if (f.endsWith('/')) f += 'index.html'; try { r.fulfill({ body: readFileSync(C+'/'+side+f), contentType: f.endsWith('.css') ? 'text/css' : 'text/html' }); } catch { r.fulfill({ status: 404, body: '' }); } });
  await p.goto('http://ds.test/');
  out[side] = await p.evaluate(props => [...document.querySelectorAll('#auth-screen, #auth-screen *')].map(e => { const cs = getComputedStyle(e); return { t: e.tagName.toLowerCase() + (e.id ? '#'+e.id : '') + (typeof e.className === 'string' && e.className ? '.'+e.className.trim().split(/\s+/).join('.') : ''), v: props.map(k => cs.getPropertyValue(k)) }; }), PROPS); await ctx.close(); }
const agg = {}; let n = 0;
out.old.forEach((a, i) => { const c = out.new[i]; a.v.forEach((x, k) => { if (x !== c.v[k]) { n++; const key = `${PROPS[k]}: ${x} -> ${c.v[k]}`; (agg[key] ||= new Set()).add(a.t.slice(0, 50)); } }); });
console.log('landing elements:', out.old.length, ' property differences:', n);
for (const [k, s] of Object.entries(agg)) console.log('  ', k, ' on ', [...s].slice(0, 4).join(' | '));
await b.close();
