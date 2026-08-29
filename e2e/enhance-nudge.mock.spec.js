import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES } from './helpers.js';

// A/B `enhance_nudge`. Treatment adds two collection-grid affordances for a watch
// with none of caseDiameter / caliber / background: a "＋ details" chip on the card
// and a count on the header Enhance button. Control is today's UI, untouched.
//
// SAMPLE_WATCHES[0] carries no specs columns at all, so it "needs enhance".

const BARE_WATCH = [SAMPLE_WATCHES[0]];

async function boot(page, variant) {
  await mockSupabase(page, { watches: BARE_WATCH });
  // Registered after mockSupabase so it wins over the catch-all /rest/v1/** net.
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ key: 'enhance_nudge', variant }]),
  }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await expect.poll(() => page.evaluate(() => EXPERIMENTS.enhance_nudge)).toBe(variant);
  await navigateTo(page, 'collection');
  await page.evaluate(() => renderCollection(true));
}

test('treatment shows the ＋ details chip and counts the watches on the header button', async ({ page }) => {
  await boot(page, 'treatment');
  const chip = page.locator('#watches-grid .enh-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveText('＋ details');
  await expect(page.locator('#coll-enhance-all-btn .wl-actions-text')).toHaveText('Enhance 1');
});

test('control shows no chip and the plain Enhance label', async ({ page }) => {
  await boot(page, 'control');
  await expect(page.locator('#watches-grid .enh-chip')).toHaveCount(0);
  await expect(page.locator('#coll-enhance-all-btn .wl-actions-text')).toHaveText('Enhance');
});

test('treatment renders the nudge card into the active page, and Not now removes it', async ({ page }) => {
  await boot(page, 'treatment');
  await page.evaluate(() => maybeShowEnhanceNudge(watches[0], 'add'));
  const card = page.locator('#page-collection .enhance-nudge-slot #enhance-nudge-card');
  await expect(card).toContainText('Rolex Submariner Date is missing its details');
  await expect(card).toContainText('Movement, case size, production years and the story behind it.');
  await expect(card.getByRole('button', { name: /^Enhance · about 20 s$/ })).toBeVisible();

  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('#enhance-nudge-card')).toHaveCount(0);
  // Dismissal is sticky per watch: the same watch never nudges again.
  await page.evaluate(() => maybeShowEnhanceNudge(watches[0], 'add'));
  await expect(page.locator('#enhance-nudge-card')).toHaveCount(0);
});

test('control never renders the nudge card', async ({ page }) => {
  await boot(page, 'control');
  await page.evaluate(() => maybeShowEnhanceNudge(watches[0], 'add'));
  await expect(page.locator('#enhance-nudge-card')).toHaveCount(0);
});

test('a chip click on a watch that was enhanced meanwhile toasts instead of running', async ({ page }) => {
  await boot(page, 'treatment');
  await expect(page.locator('#watches-grid .enh-chip')).toHaveCount(1);
  // The chip was rendered before the specs arrived (another device, a sync).
  await page.evaluate(() => { watches[0].caseDiameter = '41mm'; enhanceFromGrid(watches[0].id); });
  await expect(page.locator('#toast')).toHaveText('Already enhanced');
  await expect(page.locator('#enhance-all-modal')).toHaveClass(/hidden/);
  // The re-render drops the now-stale chip and the header count.
  await expect(page.locator('#watches-grid .enh-chip')).toHaveCount(0);
  await expect(page.locator('#coll-enhance-all-btn .wl-actions-text')).toHaveText('Enhance');
});

test('the gating keys are namespaced to the signed-in user', async ({ page }) => {
  await boot(page, 'treatment');
  await page.evaluate(() => maybeShowEnhanceNudge(watches[0], 'add'));
  await page.locator('#enhance-nudge-card').getByRole('button', { name: 'Not now' }).click();
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('enhnudge')).sort());
  expect(keys).toEqual(['enhnudge_day_test-user-id-000', 'enhnudge_seen_test-user-id-000']);
  // A different account in the same browser is not suppressed.
  const nudgesOther = await page.evaluate(() => {
    currentUser = { id: 'other-user-id' };
    maybeShowEnhanceNudge(watches[0], 'add');
    return !!document.getElementById('enhance-nudge-card');
  });
  expect(nudgesOther).toBe(true);
});
