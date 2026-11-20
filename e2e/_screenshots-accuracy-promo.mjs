// One-off capture for the Accuracy Overview feed promo (2026-11) — the overview
// screen on the MOCKED Supabase setup (nothing reaches production), with a
// made-up six-watch collection and readings spread over two months.
// Usage: node e2e/_screenshots-accuracy-promo.mjs   (local dev server on :3000)
// Writes email-assets/accuracy-overview-full.png (whole screen, for review) and
// email-assets/accuracy-overview-169.png (the 16:9 promo hero).
import { chromium } from 'playwright';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES } from './helpers.js';
import fs from 'fs';

fs.mkdirSync('email-assets', { recursive: true });

const W = (id, brand, name) => ({ ...SAMPLE_WATCHES[0], id, brand, name });
// Brands chosen to share nothing with the owner's own collection — the first
// capture (Omega / Rolex / Grand Seiko / Tudor / Hamilton) read as their account.
const WATCHES = [
  W('w1', 'Oris', 'Aquis Date'),
  W('w2', 'Sinn', '556 I'),
  W('w3', 'Longines', 'Spirit'),
  W('w4', 'Zenith', 'Chronomaster Sport'),
  W('w5', 'Tissot', 'PRX Powermatic 80'),
  W('w6', 'Nomos', 'Tangente'),
];
const ago = (days, h = 9) => { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(h, 0, 0, 0); return d.toISOString(); };
// [watch, [[daysAgo, rate], ...]] — newest first per watch.
const SERIES = [
  ['w1', [[1, 3.2], [9, 4.1], [18, 2.6], [30, 5.0], [44, 3.7]]],
  ['w2', [[3, 1.4], [12, 0.8], [25, 2.1], [40, 1.1]]],
  ['w3', [[2, 0.4], [16, -0.6], [33, 0.9]]],
  ['w4', [[5, -2.3], [14, -1.2], [29, -3.1], [50, -1.8]]],
  ['w5', [[4, 11.6], [20, 8.4], [38, 13.9], [55, 9.7]]],
  ['w6', [[8, -6.8], [27, -4.5], [47, -7.9]]],
];
let n = 0;
const READINGS = SERIES.flatMap(([watch_id, pts]) => pts.map(([d, rate]) => ({
  id: 'r' + (++n), watch_id, rate, beat_error: 0.3, amplitude: 270, created_at: ago(d), notes: null, source: 'mic',
})));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, baseURL: 'http://localhost:3000' });
const page = await ctx.newPage();
await mockSupabase(page, { watches: WATCHES });
await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await page.route('**/rest/v1/timegrapher_results*', route => {
  if (route.request().method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  const one = new URL(route.request().url()).searchParams.get('watch_id');
  const rows = one ? READINGS.filter(r => 'eq.' + r.watch_id === one) : READINGS;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
});
await injectSession(page);
await page.addInitScript(() => {
  window.webkit = { messageHandlers: { timegrapher: { postMessage: () => {} }, appAction: { postMessage: () => {} } } };
  try { localStorage.setItem('msr_hist_sort', 'name'); } catch (e) {}
});
await page.goto('/');
await waitForAppBoot(page);
await page.evaluate(() => document.getElementById('new-features-modal')?.remove());
await page.evaluate(() => document.getElementById('whats-new-modal')?.classList.add('hidden'));
await navigateTo(page, 'measure');
await page.evaluate(() => document.getElementById('msr-help-modal')?.classList.add('hidden'));
await page.click('#msr-history-btn');
await page.waitForSelector('.acc-ov-row', { timeout: 5_000 });
await page.waitForTimeout(600);

await page.screenshot({ path: 'email-assets/accuracy-overview-full.png' });

// 16:9 hero: the list card from its top edge (axis + first three rows), full width.
const top = await page.evaluate(() => document.querySelector('.acc-ov-card').getBoundingClientRect().y - 6);
await page.screenshot({ path: 'email-assets/accuracy-overview-169.png', clip: { x: 0, y: top, width: 440, height: 248 } });

await browser.close();
console.log('done — email-assets/accuracy-overview-full.png, email-assets/accuracy-overview-169.png');
