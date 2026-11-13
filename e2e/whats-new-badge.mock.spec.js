import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// Experiment `wn_badge` (usability P5, 2026-11-08): a quiet unread dot on the
// header ? help button when the What's New content changed since the user last
// opened it. Version = hash of the modal's own text (wnVersion()), seen marker
// in localStorage `wristlog_wn_seen`. Control and unknown-key users see no dot.

async function boot(page, variant) {
  await mockSupabase(page);
  // Registered after mockSupabase so it wins over the catch-all /rest/v1/** net.
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(variant ? [{ key: 'wn_badge', variant }] : []),
  }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
}

test.describe("What's New unread dot (wn_badge, mocked)", () => {
  test('treatment: dot shows, opening What\'s New clears it, and it stays cleared', async ({ page }) => {
    await boot(page, 'treatment');
    await expect(page.locator('#wn-dot')).toBeVisible();

    // Open What's New the way a user does: Help page button.
    await page.evaluate(() => showHelpPage());
    // The header dot lands on Help; a second dot marks the What's New button there.
    await expect(page.locator('#wn-dot-help')).toBeVisible();
    await page.click('#page-help button:has-text("What\'s New")');
    await expect(page.locator('#whats-new-modal')).toBeVisible();
    await expect(page.locator('#wn-dot')).toBeHidden();
    await expect(page.locator('#wn-dot-help')).toBeHidden();

    // Seen marker persists: a reload with unchanged content shows no dot.
    await page.goto('/');
    await waitForAppBoot(page);
    await expect(page.locator('#help-btn')).toBeVisible();
    await expect(page.locator('#wn-dot')).toBeHidden();

    // New content (different hash) lights it again.
    await page.evaluate(() => {
      document.querySelector('#whats-new-modal .item-title').textContent = 'A brand new entry';
      updateWnBadge();
    });
    await expect(page.locator('#wn-dot')).toBeVisible();
  });

  test('control: no dot even with unseen content', async ({ page }) => {
    await boot(page, 'control');
    await expect(page.locator('#help-btn')).toBeVisible();
    await expect(page.locator('#wn-dot')).toBeHidden();
    await page.evaluate(() => showHelpPage());
    await expect(page.locator('#wn-dot-help')).toBeHidden();
  });

  test('unknown key (experiment deleted): no dot, no errors', async ({ page }) => {
    await boot(page, null);
    await expect(page.locator('#help-btn')).toBeVisible();
    await expect(page.locator('#wn-dot')).toBeHidden();
  });
});
