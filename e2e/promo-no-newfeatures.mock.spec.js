import { test, expect } from '@playwright/test';

test('the new-features modal is gone — slots replace it', async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(() => ({
    el: !!document.getElementById('new-features-modal'),
    opener: typeof window.maybeShowNewFeatures,
    closer: typeof window.closeNewFeatures,
  }));
  expect(state.el).toBe(false);
  expect(state.opener).toBe('undefined');
  expect(state.closer).toBe('undefined');
});

test('the user-initiated What\'s New modal still works', async ({ page }) => {
  await page.goto('/');
  const shown = await page.evaluate(() => {
    window.openWhatsNew();
    return !document.getElementById('whats-new-modal').classList.contains('hidden');
  });
  expect(shown).toBe(true);
});
