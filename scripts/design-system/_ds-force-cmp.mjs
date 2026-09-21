// Before/after for pages that cannot be reached in the mock harness (native-only
// states): force the page active, then ALSO reveal every hidden descendant, and
// diff every element's box. usage: <oldDir> <outDir> <pageId,pageId,...>
import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';
const [OLD, OUT, PAGES] = process.argv.slice(2);
const b = await chromium.launch(); const res = {};
for (const side of ['old', 'new']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, baseURL: 'http://localhost:3000' });
  const page = await ctx.newPage();
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
  if (side === 'old') {
    await page.route(/localhost:3000\/(\?.*)?$/, r => r.fulfill({ body: readFileSync(OLD + '/index.html'), contentType: 'text/html' }));
    await page.route('**/design-system.css*', r => r.fulfill({ body: readFileSync(OLD + '/design-system.css'), contentType: 'text/css' }));
  }
  await injectSession(page); await page.goto('/'); await waitForAppBoot(page); await page.waitForTimeout(1500);
  res[side] = {};
  for (const pid of PAGES.split(',')) {
    for (const reveal of [false, true]) {
      const data = await page.evaluate(([pid, reveal]) => {
        document.querySelectorAll('.toast, .badge-toast').forEach(t => t.remove());
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const pg = document.getElementById(pid); pg.classList.add('active'); window.scrollTo(0, 0);
        if (reveal) pg.querySelectorAll('*').forEach(e => { if (getComputedStyle(e).display === 'none' && !['SCRIPT', 'STYLE', 'OPTION', 'TEMPLATE'].includes(e.tagName)) { e.classList.remove('hidden'); e.style.display = (e.tagName === 'SPAN' || e.tagName === 'A' || e.tagName === 'BUTTON') ? 'inline-block' : 'block'; } });
        return [...pg.querySelectorAll('*')].map(e => { const r = e.getBoundingClientRect(); return { t: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : ''), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1) }; }).concat([{ t: 'PAGE', w: pg.scrollWidth, h: pg.scrollHeight, right: 0 }]);
      }, [pid, reveal]);
      res[side][pid + (reveal ? ':revealed' : ':natural')] = data;
      await page.screenshot({ path: `${OUT}/force-${pid}-${reveal ? 'revealed' : 'natural'}-${side}.png`, fullPage: true });
    }
  }
  await ctx.close();
}
for (const k of Object.keys(res.old)) { const o = res.old[k], n = res.new[k]; if (o.length !== n.length) { console.log(k, 'ELEMENT COUNT DIFFERS', o.length, n.length); continue; }
  const pg = [o.at(-1), n.at(-1)]; let moved = 0, big = []; const vw = 390;
  o.forEach((a, i) => { const c = n[i]; const d = Math.max(Math.abs(a.h - c.h), Math.abs(a.w - c.w)); if (d > 0.05) moved++; if (d > 4 && a.t !== 'PAGE') big.push(`${a.t} ${a.w}x${a.h} -> ${c.w}x${c.h}`); });
  const spillO = o.filter(a => a.right > vw + 1).length, spillN = n.filter(a => a.right > vw + 1).length;
  console.log(`${k}: ${o.length} elements, ${moved} changed size, ${big.length} by >4px; page h ${pg[0].h} -> ${pg[1].h}; elements past the right screen edge ${spillO} -> ${spillN}`);
  big.slice(0, 12).forEach(x => console.log('     ' + x));
  if (k.endsWith(':revealed')) o.forEach((a, i) => { const c = n[i]; if (/msr-(live|rate|be|amp|bph|q2|scatter|listen|result|status|start|stop|save|trace|conf)/.test(a.t) && (a.h !== c.h || a.w !== c.w)) console.log(`     live: ${a.t.padEnd(34)} ${a.w}x${a.h} -> ${c.w}x${c.h}`); }); }
await b.close();
