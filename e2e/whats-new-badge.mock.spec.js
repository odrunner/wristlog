import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// A quiet unread dot on the header ? help button when the What's New content
// changed since the user last opened it. Version = hash of the modal's own text
// (wnVersion()), seen marker in localStorage `wristlog_wn_seen`. Shipped to
// everyone via experiment `wn_badge` (won 2026-11-14); no flag any more.

async function boot(page) {
  await mockSupabase(page);
  // Registered after mockSupabase so it wins over the catch-all /rest/v1/** net.
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: '[]',
  }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
}

test.describe("What's New unread dot (mocked)", () => {
  test('with no experiment assigned the dot shows, opening What\'s New clears it, and it stays cleared', async ({ page }) => {
    await boot(page);
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
});
