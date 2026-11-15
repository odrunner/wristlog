import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES } from './helpers.js';

// The post-measurement CTA has an EXTERNAL "Share image" button (system share
// sheet, card image + wrotate.com link) next to "Post to feed". Shipped to
// everyone via experiment `result_share` (won 2026-11-14); no flag any more.

async function boot(page) {
  await mockSupabase(page, { watches: [SAMPLE_WATCHES[0]] });
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: '[]',
  }));
  await injectSession(page);
  // Fake native bridge so the Measure tab is visible (web hides it).
  await page.addInitScript(() => {
    window.webkit = { messageHandlers: { timegrapher: { postMessage: () => {} }, appAction: { postMessage: () => {} } } };
  });
  await page.goto('/');
  await waitForAppBoot(page);
  // Surface the post-save CTA directly — the share wiring under test lives in
  // showMsrShareCta, not in the measurement engine. The CTA block is part of
  // the Measure page, so open that page first.
  await navigateTo(page, 'measure');
  // First visit auto-opens the "How to measure" help modal, which would
  // intercept clicks on the CTA buttons.
  await page.evaluate(() => document.getElementById('msr-help-modal')?.classList.add('hidden'));
  await page.evaluate((wid) => showMsrShareCta(wid, 4.2), SAMPLE_WATCHES[0].id);
}

test.describe('Result external share (mocked)', () => {
  test('Share image sits beside Post to feed, with no experiment assigned', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#msr-share-ext-btn')).toBeVisible();
    await expect(page.locator('#msr-share-btn')).toHaveText('Post to feed');
  });

  test('tapping Share image logs the result_share feature event', async ({ page }) => {
    await boot(page);
    const logged = page.waitForRequest(r => r.url().includes('/rest/v1/feature_events') && r.method() === 'POST'
      && r.postData()?.includes('result_share'));
    // No scatter data in this mocked flow → the text-share path runs; stub the
    // share sheet so the tap resolves as a completed share.
    await page.evaluate(() => { navigator.share = () => Promise.resolve(); });
    await page.click('#msr-share-ext-btn');
    await logged;
  });

  for (const lang of ['fr', 'es', 'it', 'pt', 'de', 'tr']) {
    test(`the buttons stay on one line each at 375px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.addInitScript((l) => localStorage.setItem('wr_lang', l), lang);
      await boot(page);
      const heights = await page.locator('#msr-share-cta .btn').evaluateAll(els =>
        els.filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().height)));
      expect(heights.length).toBeGreaterThanOrEqual(3);
      expect(new Set(heights).size).toBe(1); // a wrapped label makes its button taller
    });
  }
});
