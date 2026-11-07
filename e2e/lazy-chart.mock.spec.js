import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';

// CLIENT-6: Chart.js (287 KB raw, two chart sites, one page) must not cost
// every boot. It loads the first time Stats renders and stays loaded after.
test('Chart.js is absent at boot and arrives when Stats opens', async ({ page }) => {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);

  expect(await page.evaluate(() => typeof window.Chart)).toBe('undefined');

  await navigateTo(page, 'stats');
  await page.waitForFunction(() => typeof window.Chart === 'function');
  // The stats content rendered after the lazy load, not before it.
  await expect(page.locator('#page-stats')).toHaveClass(/active/);
});
