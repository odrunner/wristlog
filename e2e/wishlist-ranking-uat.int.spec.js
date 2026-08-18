// UAT: Wishlist ranking game (testuser, real Supabase). Plays a full game on
// the wishlist, saves, and checks the order + elo persist through a reload.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const r = await page.goto('/dev-config.js');
  if (!r || r.status() !== 200) test.skip(true, 'no dev-config.js');
});

async function devLogin(page) {
  await page.goto('/');
  await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });
  await page.click('#dev-login-wrap button:first-child');
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 15_000 });
  await page.waitForSelector('nav', { state: 'visible', timeout: 5_000 });
}

test('wishlist ranking game: play, save, reorder persists', async ({ page }) => {
  test.setTimeout(120_000);
  await devLogin(page);
  await page.click('nav button[data-page="wishlist"]');
  await page.waitForFunction(() => typeof wishlist !== "undefined" && wishlist.length >= 2, null, { timeout: 15_000 });
  const before = await page.evaluate(() => wishlist.map(w => ({ id: w.id, name: w.name, elo: w.elo })));
  console.log('before', JSON.stringify(before));

  await expect(page.locator('#wl-rank-btn')).toBeVisible();
  await page.click('#wl-rank-btn');
  await expect(page.locator('#game-overlay')).toBeVisible();
  const introVisible = await page.locator('#game-intro-screen').isVisible();
  if (introVisible) {
    await expect(page.locator('#game-intro-copy')).toContainText('wishlist');
    await page.click('#game-intro-screen button.btn-primary');
  }
  await expect(page.locator('#game-play-screen')).toBeVisible();
  // Always pick card B → last-in-B item should end up top-ranked-ish; just play all rounds
  for (let i = 0; i < 60; i++) {
    const done = await page.locator('#game-result-screen').isVisible();
    if (done) break;
    await page.click('#game-card-b');
    await page.waitForTimeout(550);
  }
  await expect(page.locator('#game-result-screen')).toBeVisible();
  const resultOrder = await page.locator('.game-result-watch').allTextContents();
  console.log('result order', resultOrder);
  await page.click('#game-result-screen button.btn-primary'); // Save Ranking
  await expect(page.locator('#game-overlay')).toBeHidden();
  const after = await page.evaluate(() => wishlist.map(w => ({ id: w.id, name: w.name, elo: w.elo, _rank: w._rank })));
  console.log('after', JSON.stringify(after));
  expect(after.map(w => w.name)).toEqual(resultOrder);
  expect(after.every(w => typeof w.elo === 'number')).toBe(true);
  // Elo strictly non-increasing down the list
  for (let i = 1; i < after.length; i++) expect(after[i - 1].elo).toBeGreaterThanOrEqual(after[i].elo);

  // collection elo untouched by wishlist game
  const collElo = await page.evaluate(() => Object.keys(eloRatings).length);
  console.log('collection elo entries', collElo);

  // wait for cloud sync then reload
  await page.waitForFunction(() => !_dirty.wishlist.size, null, { timeout: 20_000 });
  await page.reload();
  await page.waitForSelector('nav', { state: 'visible', timeout: 15_000 });
  await page.waitForFunction(() => typeof wishlist !== "undefined" && wishlist.length >= 2, null, { timeout: 15_000 });
  await page.waitForTimeout(2500);
  const reloaded = await page.evaluate(() => wishlist.map(w => ({ id: w.id, name: w.name, elo: w.elo })));
  console.log('reloaded', JSON.stringify(reloaded));
  expect(reloaded.map(w => w.id)).toEqual(after.map(w => w.id));
  expect(reloaded.map(w => w.elo)).toEqual(after.map(w => w.elo));
});
