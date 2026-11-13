// One-off capture for the Android + What's New broadcast (v2) — two shots on
// the MOCKED Supabase setup (nothing reaches production):
//   1. The app's top menu with the Messages envelope showing an unread count.
//   2. The unified search sheet with "Speedmaster" typed and real public
//      model-database rows (brand/name/image/owners) served from a fixture.
// Usage: node e2e/_screenshots-android-email.mjs   (local dev server on :3000)
import { chromium } from 'playwright';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';
import fs from 'fs';

fs.mkdirSync('email-assets', { recursive: true });

// Real rows from public.browse_watch_models('speedmaster', …) — public model-DB
// content (no user data), frozen here so the shot is reproducible offline.
const SPEEDMASTER_MODELS = [
  { id: 'c044b1c5-2c2c-4084-ab2e-970ab9a6a26b', brand: 'Omega', name: 'Speedmaster Professional', owners: 14,
    image: 'https://api.wrotate.com/storage/v1/object/public/media/watches/d70b1a85-4f31-4431-b3b7-db76543daaf5/model-c044b1c5-2c2c-4084-ab2e-970ab9a6a26b.jpg?v=1788105617899' },
  { id: '821211ce-2b4b-4d8d-99f1-e2198131de94', brand: 'Omega', name: 'Speedmaster', owners: 5,
    image: 'https://api.wrotate.com/storage/v1/object/public/media/watches/d70b1a85-4f31-4431-b3b7-db76543daaf5/model-821211ce-2b4b-4d8d-99f1-e2198131de94.jpg?v=1788237259238' },
  { id: '824f74b0-31af-4a9b-90ad-bed1c0ff8378', brand: 'Omega', name: 'Speedmaster Reduced', owners: 4,
    image: 'https://api.wrotate.com/storage/v1/object/public/media/watches/d70b1a85-4f31-4431-b3b7-db76543daaf5/model-824f74b0-31af-4a9b-90ad-bed1c0ff8378.jpg?v=1790466019853' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
// Registered after mockSupabase, so it wins over the rest/v1 safety net.
await page.route('**/rest/v1/rpc/browse_watch_models*', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SPEEDMASTER_MODELS) }));
// Model images live on the real public bucket — let those requests through.
await page.route('**/storage/v1/object/public/**', route => route.continue());
await injectSession(page);
await page.goto('http://localhost:3000/');
await waitForAppBoot(page);
await page.evaluate(() => document.getElementById('new-features-modal')?.remove());
await page.evaluate(() => document.getElementById('whats-new-modal')?.classList.add('hidden'));
await page.waitForTimeout(1200);

// 1. Top menu with the Messages envelope. The envelope only renders for
// signed-in users; give it the unread dot a message request produces.
await page.evaluate(() => {
  const dm = document.getElementById('dm-btn');
  dm.classList.remove('hidden');
  const badge = document.getElementById('dm-badge');
  badge.textContent = '1';
  badge.classList.remove('hidden');
});
await page.waitForTimeout(300);
const header = await page.evaluate(() => {
  const r = document.querySelector('.header-inner').getBoundingClientRect();
  return { x: 0, y: Math.max(0, r.y), width: 412, height: r.height };
});
await page.screenshot({ path: 'email-assets/messages-top-menu.png', clip: header });

// 2. Search sheet with Speedmaster results.
await page.click('.feed-search-pill');
await page.waitForSelector('#discover-modal', { state: 'visible', timeout: 5_000 });
await page.fill('#discover-search', 'Speedmaster');
await page.waitForSelector('#discover-watch-results .user-card', { timeout: 5_000 });
await page.waitForTimeout(900); // model thumbnails
await page.evaluate(() => {
  // The mocked people search is empty — drop its "No users found" line; the
  // shot is about the Watches group.
  document.getElementById('discover-results').innerHTML = '';
  // Opaque backdrop: the live overlay is translucent and the feed ghosts through.
  const o = document.getElementById('discover-modal');
  o.style.background = getComputedStyle(document.body).backgroundColor || '#f4f4f6';
  o.style.backdropFilter = 'none';
});
const clip = await page.evaluate(() => {
  const modal = document.querySelector('#discover-modal .modal').getBoundingClientRect();
  const watches = document.getElementById('discover-watch-results').getBoundingClientRect();
  return { x: modal.x, y: modal.y, width: modal.width, height: watches.bottom - modal.y + 12 };
});
await page.screenshot({ path: 'email-assets/search-watches.png', clip });

await browser.close();
console.log('done — email-assets/messages-top-menu.png, email-assets/search-watches.png');
