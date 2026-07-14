// One-off capture for onboarding email 4 — Ranking Game + strap picker, using
// the Alex Rivera demo account (real watch photos; demo mode persists nothing).
// Never taps a match-up card and never saves a ranking.
// Usage: node e2e/_screenshots-email4.mjs   (local dev server must be on :3000)
import { chromium } from 'playwright';
import fs from 'fs';

fs.mkdirSync('email-assets', { recursive: true });
const browser = await chromium.launch({ args: ['--disable-web-security'] }); // demo-login CORS (same as the integration project)
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:3000/');
await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });
await page.evaluate(() => bootDemoMode());
await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 20_000 });
await page.waitForSelector('nav', { state: 'visible', timeout: 20_000 });
await page.waitForTimeout(2500); // collection sync + images
await page.evaluate(() => document.getElementById('new-features-modal')?.remove()); // What's New popup blocks clicks

// 1. Ranking Game match-up
await page.click('nav button[data-page="collection"]');
await page.waitForSelector('#page-collection', { state: 'visible', timeout: 5_000 });
await page.click('button[title="Ranking Game"]');
const intro = page.locator('#game-intro-screen');
if (await intro.isVisible().catch(() => false)) {
  await page.click('#game-intro-screen button.btn-primary'); // "Let's go"
}
await page.waitForSelector('#game-play-screen', { state: 'visible', timeout: 5_000 });
// Opaque backdrop for the shot — the live overlay is translucent and the
// blurred collection behind it reads as ghost text in a static image.
await page.evaluate(() => {
  const o = document.getElementById('game-overlay');
  o.style.background = getComputedStyle(document.body).backgroundColor || '#f4f4f6';
  o.style.backdropFilter = 'none';
});
await page.waitForTimeout(700); // watch photos render; must beat the 3s round timer
await page.locator('#game-play-screen').screenshot({ path: 'email-assets/ranking-game.png' }); // just the match-up block, not the full-height overlay
await page.evaluate(() => closeGame());

// 2. Strap picker in the Track log modal (GMT-Master II has 2 straps)
await page.evaluate(() => {
  const w = watches.find((x) => (x.name || '').includes('GMT-Master'));
  openTrackModal(w.id);
});
await page.waitForSelector('#strap-selector-card', { state: 'visible', timeout: 5_000 });
await page.waitForTimeout(400);
// White backdrop: the overlay behind the modal is translucent dark and shows
// through outside the rounded corners as dark slivers in the cropped image.
await page.evaluate(() => {
  const ov = document.getElementById('track-log-modal');
  ov.style.background = '#fff';
  ov.style.backdropFilter = 'none';
});
// Crop: modal top down to just below the strap chips — the fields after the
// strap (occasion, photo, caption, visibility) aren't the point of the shot.
const clip = await page.evaluate(() => {
  const modal = document.querySelector('#track-log-modal .tl-modal').getBoundingClientRect();
  const strap = document.getElementById('strap-selector-card').getBoundingClientRect();
  return { x: modal.x, y: modal.y, width: modal.width, height: strap.bottom - modal.y + 12 };
});
await page.screenshot({ path: 'email-assets/strap-picker.png', clip });

await browser.close();
console.log('done — email-assets/ranking-game.png, email-assets/strap-picker.png');
