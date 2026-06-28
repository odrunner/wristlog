// Reusable UX screenshot harness — captures key screens in light + dark using the
// mocked Supabase setup. Usage: SHOT_PHASE=before node e2e/_screenshots.mjs
import { chromium } from 'playwright';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';
import fs from 'fs';

const phase = process.env.SHOT_PHASE || 'before';
const outDir = `ux-screenshots/${phase}`;
fs.mkdirSync(outDir, { recursive: true });

const PAGES = ['feed', 'collection', 'stats', 'wishlist', 'track'];
const THEMES = ['light', 'dark'];

const browser = await chromium.launch();
for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
  await injectSession(page);
  await page.goto('http://localhost:3000/');
  await waitForAppBoot(page);
  await page.evaluate((t) => {
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }, theme);
  for (const pg of PAGES) {
    try {
      await navigateTo(page, pg);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${outDir}/${theme}-${pg}.png`, fullPage: true });
      console.log(`  shot ${theme}-${pg}`);
    } catch (e) { console.log(`  skip ${theme}-${pg}: ${e.message}`); }
  }
  await ctx.close();
}
await browser.close();
console.log('done', phase);
