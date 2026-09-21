// Finds inline style declarations in the STATIC markup of index.html that provably change nothing.
//   node scripts/design-system/ds-redundant.mjs [out.json]      (run from the repo root; no server needed)
//
// A declaration is reported only if ALL of these hold:
//   1. it is a pure design property (never display / size / position — JS reads and toggles those);
//   2. removing it changes no computed property of the element at 3 widths x 2 themes;
//   3. no stylesheet rule that COULD apply to the element — ignoring pseudo-classes, extra state
//      classes and media queries — sets that property to a different value. Today the inline style
//      silently beats such rules (hover, .active, .selected …); removing it would let them through;
//   4. for inherited properties, the same holds for every ancestor.
// The landing screen is skipped entirely.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const DESIGN = ['color', 'background', 'background-color', 'font-size', 'font-weight', 'font-family', 'font-style', 'line-height',
  'letter-spacing', 'text-transform', 'text-align', 'text-decoration', 'border', 'border-top', 'border-right', 'border-bottom',
  'border-left', 'border-color', 'border-width', 'border-style', 'border-radius', 'padding', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'gap', 'align-items',
  'justify-content', 'white-space', 'cursor', 'box-shadow', 'flex-wrap', 'flex-direction', 'vertical-align', 'list-style'];
const INHERITED = ['color', 'font-size', 'font-weight', 'font-family', 'font-style', 'line-height', 'letter-spacing', 'text-transform',
  'text-align', 'white-space', 'cursor', 'list-style'];

const b = await chromium.launch();
const results = [];
for (const width of [390, 820, 1280]) for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 } });
  const p = await ctx.newPage();
  await p.route('http://ds.test/**', r => { const u = new URL(r.request().url()); let f = u.pathname; if (f === '/') f = '/index.html';
    try { r.fulfill({ body: readFileSync('.' + f), contentType: f.endsWith('.css') ? 'text/css' : 'text/html' }); } catch { r.fulfill({ status: 404, body: '' }); } });
  await p.goto('http://ds.test/');
  results.push(await p.evaluate(([theme, DESIGN, INHERITED]) => {
    document.documentElement.setAttribute('data-theme', theme);
    // index every style rule (inside media queries too) by the longhand properties it declares
    const rules = [];
    const walk = list => { for (const r of list) { if (r.cssRules && r.type !== 1) walk(r.cssRules); if (r.type === 1) rules.push(r); } };
    for (const ss of document.styleSheets) { try { walk(ss.cssRules); } catch {} }
    const byProp = new Map();
    for (const r of rules) for (const k of r.style) { if (!byProp.has(k)) byProp.set(k, []); byProp.get(k).push(r); }
    // "could this selector's subject be this element, in some state?"
    const subject = sel => { const parts = sel.trim().split(/\s*[>+~]\s*|\s+/); return parts[parts.length - 1]; };
    const couldMatch = (el, selText) => selText.split(',').some(s => {
      let sub = subject(s).replace(/::?[\w-]+(\([^)]*\))?/g, '');       // drop pseudo-classes / elements
      if (!sub || sub === '*') return true;
      const tag = (sub.match(/^[a-zA-Z][\w-]*/) || [''])[0]; const id = (sub.match(/#([\w-]+)/) || [])[1];
      const attrs = sub.match(/\[[^\]]+\]/g) || [];
      if (tag && tag.toLowerCase() !== el.tagName.toLowerCase()) return false;
      if (id && id !== el.id) return false;
      if (attrs.some(a => { try { return !el.matches(a); } catch { return false; } }) && !tag && !id && !/\./.test(sub)) return false;
      const classes = [...sub.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
      if (!tag && !id && !classes.length) return attrs.length ? attrs.every(a => { try { return el.matches(a); } catch { return true; } }) : true;
      // a class the element lacks may be a state class (.active, .selected) — but at least ONE must already be on it,
      // otherwise any rule with any class would "possibly match" everything.
      if (classes.length && !id && !classes.some(c => el.classList.contains(c))) return false;
      return true;
    });
    const snap = el => { const cs = getComputedStyle(el); let o = ''; for (const k of cs) o += k + ':' + cs.getPropertyValue(k) + ';'; return o; };
    const longhands = decl => { const d = document.createElement('div'); d.setAttribute('style', decl); return [...d.style]; };
    const out = {}; const els = [...document.querySelectorAll('[style]')];
    els.forEach((el, idx) => {
      if (el.closest('#auth-screen')) return;
      const raw = el.getAttribute('style'); const decls = raw.split(';').map(d => d.trim()).filter(Boolean); const base = snap(el); const ok = [];
      decls.forEach((d, i) => {
        const prop = d.split(':')[0].trim().toLowerCase(); if (!DESIGN.includes(prop) || /!important/.test(d)) return;
        el.setAttribute('style', decls.filter((_, j) => j !== i).join(';')); const same = snap(el) === base; el.setAttribute('style', raw);
        if (!same) return;
        const lh = longhands(d); const want = Object.fromEntries(lh.map(k => [k, getComputedStyle(el).getPropertyValue(k)]));
        const chain = INHERITED.includes(prop) ? (() => { const a = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) a.push(n); return a; })() : [el];
        for (const node of chain) for (const k of lh) for (const r of (byProp.get(k) || [])) {
          if (!couldMatch(node, r.selectorText)) continue;
          // does this rule, applied, give the same value the element has now?
          const probe = document.createElement(node.tagName); probe.style.setProperty(k, r.style.getPropertyValue(k)); node.parentElement?.appendChild(probe);
          const v = getComputedStyle(probe).getPropertyValue(k); probe.remove();
          if (v !== want[k]) return;
        }
        ok.push(i);
      });
      if (ok.length) out[idx] = { raw, ok };
    });
    return { n: els.length, out };
  }, [theme, DESIGN, INHERITED]));
  await ctx.close();
}
await b.close();
// keep only what was safe in ALL six runs
const first = results[0]; const final = [];
for (const [idx, { raw, ok }] of Object.entries(first.out)) {
  const keep = ok.filter(i => results.every(r => r.out[idx] && r.out[idx].raw === raw && r.out[idx].ok.includes(i)));
  if (keep.length) final.push({ idx: +idx, raw, remove: keep });
}
const total = final.reduce((a, x) => a + x.remove.length, 0);
console.log(`static [style] elements: ${first.n}; declarations safe to remove in all 6 runs: ${total} on ${final.length} elements`);
const by = {}; for (const x of final) { const d = x.raw.split(';').map(s => s.trim()).filter(Boolean); for (const i of x.remove) { const k = d[i].replace(/\s+/g, ''); by[k] = (by[k] || 0) + 1; } }
console.log(Object.entries(by).sort((a, c) => c[1] - a[1]).slice(0, 20).map(([k, v]) => `  ${String(v).padStart(4)}  ${k}`).join('\n'));
if (process.argv[2]) { writeFileSync(process.argv[2], JSON.stringify(final)); console.log('written', process.argv[2]); }
