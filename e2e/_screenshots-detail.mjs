// Dark-mode detail captures: watch-detail "story" card + badge wall (the screens
// with the biggest dark-mode fixes). Seeds description + earned badges the mock
// otherwise lacks. Usage: SHOT_PHASE=baseline|current node e2e/_screenshots-detail.mjs
import { chromium } from 'playwright';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_LOGS } from './helpers.js';
import fs from 'fs';

const phase = process.env.SHOT_PHASE || 'current';
const outDir = `ux-screenshots/${phase}`;
fs.mkdirSync(outDir, { recursive: true });

const WATCH = {
  id: 'w-desc-1', user_id: 'test-user-id-000', brand: 'Kurono Tokyo',
  name: "Special Projects Malachite 'Kujaku-ishi'", color: '#2e7d6b',
  ref: 'SP-MAL', purchase_date: '2026-05-27', price: 2110, market_price: 2110,
  description: "This watch features a striking green malachite stone dial, known as 'Kujaku-ishi' (Peacock Stone) in Japan, with unique banding patterns. The center malachite is combined with a brass outer section with a hand-mixed rokusho (verdigris) green pigment to create a convex dial, and the hour markers are represented by the twelve signs of the Kanji Zodiac.",
  background: "The Kurono Bunkyo Tokyo Special Projects Malachite is the brand's 2026 anniversary timepiece, designed by independent watchmaker Hajime Asaoka. It represents Asaoka's exploration of using natural stone within the Kurono Tokyo design language.",
  functions: ['hours', 'minutes', 'seconds', 'Kanji Zodiac Indices'],
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await mockSupabase(page, { watches: [WATCH], logs: SAMPLE_LOGS });
await injectSession(page);
await page.goto('http://localhost:3000/');
await waitForAppBoot(page);
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await navigateTo(page, 'collection');
await page.waitForTimeout(1000);

// Watch-detail "story" card
try {
  await page.evaluate(() => openEditWatch('w-desc-1'));
  await page.waitForTimeout(900);
  await page.locator('#watch-modal').screenshot({ path: `${outDir}/dark-watch-detail.png` });
  console.log('  shot dark-watch-detail');
  await page.evaluate(() => { const m = document.getElementById('watch-modal'); if (m) m.classList.add('hidden'); });
} catch (e) { console.log('  skip watch-detail:', e.message); }

// Badge wall (seed a few earned so glyphs render in earned state)
try {
  await page.evaluate(() => {
    try {
      _earnedBadges = [
        { badge_ref: 1, earned_at: '2026-05-13T00:00:00Z' },
        { badge_ref: 80, earned_at: '2026-05-20T00:00:00Z' },
        { badge_ref: 84, earned_at: '2026-05-25T00:00:00Z' },
        { badge_ref: 83, earned_at: '2026-05-18T00:00:00Z' },
      ];
    } catch (e) {}
    openBadgeWall();
  });
  await page.waitForTimeout(800);
  await page.locator('#badge-wall-modal').screenshot({ path: `${outDir}/dark-badge-wall.png` });
  console.log('  shot dark-badge-wall');
} catch (e) { console.log('  skip badge-wall:', e.message); }

await browser.close();
console.log('detail shots done', phase);
