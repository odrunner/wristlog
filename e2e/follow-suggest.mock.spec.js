import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES } from './helpers.js';

// A/B `follow_suggest`: treatment shows a "People to follow" card at the top of the Feed,
// tiles with a reason line and Follow / Request per the target's privacy. Control: nothing.

const SUGG = [
  { id: 'u-omega', username: 'omegafan', display_name: 'Omega Fan', avatar_url: null, profile_privacy: 'public',
    reason: 'same_model', model_brand: 'Omega', model_name: 'Speedmaster', likes: 0, followers: 0 },
  { id: 'u-pat', username: 'pat', display_name: 'Private Pat', avatar_url: null, profile_privacy: 'followers',
    reason: 'liked', model_brand: null, model_name: null, likes: 3, followers: 0 },
];

async function boot(page, variant) {
  await mockSupabase(page);
  // Registered after mockSupabase so they win over the catch-all /rest/v1/** net.
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'follow_suggest', variant }]),
  }));
  await page.route('**/rest/v1/rpc/follow_suggestions*', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SUGG),
  }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await expect.poll(() => page.evaluate(() => EXPERIMENTS.follow_suggest)).toBe(variant);
  await page.evaluate(() => renderFeed());
}

test('treatment: card with one tile per suggestion, reason copy, Follow vs Request', async ({ page }) => {
  await boot(page, 'treatment');
  const card = page.locator('#follow-sugg-feed');
  await expect(card).toBeVisible();
  await expect(card.locator('.eyebrow')).toHaveText('People to follow');
  const tiles = card.locator('.follow-sugg-tile');
  await expect(tiles).toHaveCount(2);
  await expect(tiles.nth(0).locator('.follow-sugg-reason')).toHaveText('Also owns the Omega Speedmaster');
  await expect(tiles.nth(0).locator('.follow-btn')).toHaveText('Follow');
  await expect(tiles.nth(1).locator('.follow-sugg-reason')).toHaveText('3 likes this month');
  await expect(tiles.nth(1).locator('.follow-btn')).toHaveText('Request');
});

test('treatment: dismiss hides the card and remembers it', async ({ page }) => {
  await boot(page, 'treatment');
  await expect(page.locator('#follow-sugg-feed')).toBeVisible();
  await page.locator('#follow-sugg-feed .follow-sugg-close').click();
  await expect(page.locator('#follow-sugg-feed')).toHaveCount(0);
  await page.evaluate(() => renderFeed());
  await page.waitForTimeout(300);
  await expect(page.locator('#follow-sugg-feed')).toHaveCount(0);
  expect(await page.evaluate(() => Number(localStorage.getItem('wr_follow_sugg_dismissed')) > 0)).toBe(true);
});

test('control: no card, no RPC call', async ({ page }) => {
  let calls = 0;
  await mockSupabase(page);
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'follow_suggest', variant: 'control' }]),
  }));
  await page.route('**/rest/v1/rpc/follow_suggestions*', r => { calls++; r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await expect.poll(() => page.evaluate(() => EXPERIMENTS.follow_suggest)).toBe('control');
  await page.evaluate(() => renderFeed());
  await page.waitForTimeout(400);
  await expect(page.locator('#follow-sugg-feed')).toHaveCount(0);
  expect(calls).toBe(0);
});

test('treatment: after adding a watch, a popup lists the owners of that model', async ({ page }) => {
  const W = SAMPLE_WATCHES[0];
  const owners = [{ ...SUGG[0], via_watch_id: W.id, model_brand: W.brand, model_name: W.name }, { ...SUGG[1], reason: 'same_model', via_watch_id: W.id, model_brand: W.brand, model_name: W.name }];
  await mockSupabase(page, { watches: [W] });
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'follow_suggest', variant: 'treatment' }]) }));
  await page.route('**/rest/v1/rpc/follow_suggestions*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(owners) }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await expect.poll(() => page.evaluate(() => EXPERIMENTS.follow_suggest)).toBe('treatment');
  await navigateTo(page, 'collection');
  page.evaluate((id) => showFollowSuggestAfterAdd(id), W.id);
  const modal = page.locator('#follow-sugg-modal');
  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#follow-sugg-modal-title')).toHaveText(`2 members also own the ${W.brand} ${W.name}`);
  await expect(modal.locator('.follow-sugg-tile')).toHaveCount(2);
  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(modal).toBeHidden();
});
