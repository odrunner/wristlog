import { chromium } from 'playwright'; import { readFileSync } from 'fs';
const b = await chromium.launch(); const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
await p.route('http://ds.test/**', r => { const u = new URL(r.request().url()); let f = u.pathname; if (f === '/') f = '/index.html'; try { r.fulfill({ body: readFileSync('.' + f), contentType: f.endsWith('.css') ? 'text/css' : 'text/html' }); } catch { r.fulfill({ status: 404, body: '' }); } });
await p.goto('http://ds.test/');
const out = await p.evaluate(() => {
  const res = { els: 0, decls: 0, redundant: 0, fullyRedundant: 0, byDecl: {}, inLanding: 0 };
  const snap = el => { const cs = getComputedStyle(el); let o = ''; for (const k of cs) o += k + ':' + cs.getPropertyValue(k) + ';'; return o; };
  for (const el of document.querySelectorAll('[style]')) {
    if (el.closest('#auth-screen')) { res.inLanding++; continue; }
    const raw = el.getAttribute('style'); const decls = raw.split(';').map(d => d.trim()).filter(Boolean);
    res.els++; const base = snap(el); let red = 0;
    for (let i = 0; i < decls.length; i++) {
      el.setAttribute('style', decls.filter((_, j) => j !== i).join(';'));
      if (snap(el) === base) { red++; const k = decls[i].replace(/\s+/g, ''); res.byDecl[k] = (res.byDecl[k] || 0) + 1; }
    }
    el.setAttribute('style', ''); const none = snap(el) === base; el.setAttribute('style', raw);
    res.decls += decls.length; res.redundant += red; if (none) res.fullyRedundant++;
  }
  return res;
});
console.log('static elements with inline style (landing excluded):', out.els);
console.log('authored declarations:', out.decls, '| redundant (removing it changes no computed property of the element):', out.redundant, '| whole attribute removable:', out.fullyRedundant);
console.log(Object.entries(out.byDecl).sort((a, c) => c[1] - a[1]).slice(0, 18).map(([k, v]) => `  ${String(v).padStart(4)}  ${k}`).join('\n'));
await b.close();
