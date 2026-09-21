// Before/after of modals: force each overlay visible, measure its dialog box, screenshot.
// usage: node e2e/_ds-modal-cmp.mjs <oldDir> <outDir> <id,id,...|ALL-EXCEPT:id,id>
import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';
const [OLD, OUT, SPEC] = process.argv.slice(2);
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
  let ids = await page.evaluate(() => [...document.querySelectorAll('div.overlay[id]')].map(e => e.id));
  if (SPEC.startsWith('ALL-EXCEPT:')) { const ex = SPEC.slice(11).split(','); ids = ids.filter(i => !ex.includes(i)); } else ids = SPEC.split(',');
  res[side] = {};
  for (const id of ids) {
    const m = await page.evaluate(id => {
      document.querySelectorAll('div.overlay').forEach(o => { o.classList.add('hidden'); o.style.display = ''; });
      document.querySelectorAll('.toast, .badge-toast').forEach(t => t.remove());
      const o = document.getElementById(id); if (!o) return null;
      o.classList.remove('hidden'); if (getComputedStyle(o).display === 'none') o.style.display = 'flex';
      const box = o.querySelector('.modal') || o.firstElementChild; if (!box) return null;
      const r = box.getBoundingClientRect();
      const wide = [...box.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > r.right + 1 && getComputedStyle(e).position !== 'absolute').length;
      return { h: +r.height.toFixed(2), sh: box.scrollHeight, w: +r.width.toFixed(2), spill: wide };
    }, id);
    res[side][id] = m;
    if (m) await page.screenshot({ path: `${OUT}/modal-${id}-${side}.png` });
  }
  await ctx.close();
}
for (const id of Object.keys(res.old)) { const o = res.old[id], n = res.new[id]; if (!o || !n) { console.log(id, 'not measurable'); continue; }
  console.log(`${id.padEnd(26)} box h ${o.h} -> ${n.h} (${(n.h - o.h).toFixed(2)})  content h ${o.sh} -> ${n.sh} (${n.sh - o.sh})  children spilling right: ${o.spill} -> ${n.spill}`); }
await b.close();
