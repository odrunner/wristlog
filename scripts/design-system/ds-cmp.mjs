// Computed-style diff: every element of the static markup, old vs new, both themes.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const C = process.argv[2];
const PROPS = ['font-size','font-weight','font-family','line-height','letter-spacing','border-top-left-radius','border-top-right-radius','border-bottom-left-radius','border-bottom-right-radius','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','row-gap','column-gap','box-shadow','transition-duration','transition-property','z-index','color','background-color','background-image','border-top-color','border-left-color','fill','stroke','text-shadow','outline-color'];
const norm = s => s.replace(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g, (_, r, g, b2, a) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b2 * 255)}, ${a ?? 1})`);
const b = await chromium.launch();
async function dump(side, page, theme) {
  const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.route('http://ds.test/**', r => {
    const u = new URL(r.request().url()); let f = u.pathname; if (f.endsWith('/')) f += 'index.html';
    try { r.fulfill({ body: readFileSync(C + '/' + side + f), contentType: f.endsWith('.css') ? 'text/css' : 'text/html' }); } catch { r.fulfill({ status: 404, body: '' }); }
  });
  await p.goto('http://ds.test/' + page);
  const out = await p.evaluate(([props, theme]) => {
    document.documentElement.setAttribute('data-theme', theme);
    const res = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      const tag = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && el.className.baseVal === undefined ? '.' + String(el.className).trim().split(/\s+/).join('.') : '');
      res.push(tag + '§' + props.map(k => cs.getPropertyValue(k)).join('|'));
    }
    return res;
  }, [PROPS, theme]);
  await ctx.close(); return out.map(norm);
}
let total = 0, diffs = 0; const by = {}; let landingRows = 0, landingDiffs = 0; // LANDING-CHECK
for (const page of ['', 'p/', 'profile/']) for (const theme of ['light', 'dark']) {
  const [o, n] = [await dump('old', page, theme), await dump('new', page, theme)];
  if (o.length !== n.length) { console.log('ELEMENT COUNT DIFFERS', page, theme); diffs++; continue; }
  o.forEach((v, i) => { if (page === '' && v.includes('landing') ) { landingRows++; if (v !== n[i]) landingDiffs++; } });
  let d = 0; o.forEach((v, i) => { if (v !== n[i]) { d++; const [tag, a] = v.split('§'), c = n[i].split('§')[1].split('|'); a.split('|').forEach((x, k) => { if (x !== c[k] && theme === 'light') { const key = PROPS[k] + ': ' + x + ' => ' + c[k]; (by[key] ||= []).push(tag); } }); } });
  total += o.length; diffs += d; console.log((page || 'index') + ' ' + theme + ': ' + o.length + ' rows, ' + d + ' differ');
}
console.log('LANDING elements (class contains "landing"):', landingRows, 'rows, differing:', landingDiffs);
console.log('TOTAL', total, 'rows x', PROPS.length, 'props; differing:', diffs);
for (const [k, tags] of Object.entries(by).sort((a, b2) => b2[1].length - a[1].length).slice(0, 40)) console.log(String(tags.length).padStart(4), k, ' e.g.', [...new Set(tags)].slice(0, 3).join(', '));
await b.close();
