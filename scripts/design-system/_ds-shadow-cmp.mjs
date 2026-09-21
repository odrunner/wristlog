import { chromium } from '@playwright/test'; import { readFileSync } from 'fs';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES, FAKE_USER } from './helpers.js';
const [OLD, OUT] = process.argv.slice(2);
const log = (id, day, notes) => ({ id, user_id: FAKE_USER.id, watch_id: 'watch-001', date: `2026-08-0${day}`, created_at: `2026-08-0${day}T10:00:00Z`, use_case: 'work', notes, strap_id: null, photo_url: null, visibility: 'public', club_id: null });
const b = await chromium.launch();
for (const side of ['old', 'new']) for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, baseURL: 'http://localhost:3000' }); const page = await ctx.newPage();
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [log('a', 9, 'First post.'), log('b', 8, 'Second post.')] });
  if (side === 'old') { await page.route(/localhost:3000\/(\?.*)?$/, r => r.fulfill({ body: readFileSync(OLD + '/index.html'), contentType: 'text/html' })); await page.route('**/design-system.css*', r => r.fulfill({ body: readFileSync(OLD + '/design-system.css'), contentType: 'text/css' })); }
  await injectSession(page); await page.goto('/'); await waitForAppBoot(page); await navigateTo(page, 'feed'); await page.waitForSelector('.feed-card'); await page.waitForTimeout(800);
  await page.evaluate(t => { document.documentElement.setAttribute('data-theme', t); document.querySelectorAll('.toast, .badge-toast').forEach(x => x.classList.remove('show')); }, theme);
  // 1: feed at rest + the Post FAB forced visible + a post menu open
  await page.evaluate(() => { const f = document.getElementById('feed-post-fab'); if (f) { f.classList.add('show'); f.style.display = 'flex'; } const m = document.querySelector('.feed-menu'); if (m) m.classList.remove('hidden'); });
  await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/shadow-feed-${side}-${theme}.png` });
  // 2: notification panel + a toast
  await page.evaluate(() => { document.querySelectorAll('.feed-menu').forEach(m => m.classList.add('hidden')); const n = document.getElementById('notif-panel'); if (n) n.classList.remove('hidden'); if (typeof toast === 'function') toast('Saved to your collection'); });
  await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/shadow-overlay-${side}-${theme}.png` });
  await ctx.close(); }
await b.close(); console.log('done');
