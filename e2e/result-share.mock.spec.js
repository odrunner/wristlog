import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES } from './helpers.js';

// Experiment `result_share` (growth #9, 2026-11-08): the post-measurement CTA
// gains an EXTERNAL "Share image" button (system share sheet, card image +
// wrotate.com link) next to the feed post. In treatment the feed button is
// renamed "Post to feed" so the two shares can't be confused; control is the
// unchanged two-button row.

async function boot(page, variant) {
  await mockSupabase(page, { watches: [SAMPLE_WATCHES[0]] });
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(variant ? [{ key: 'result_share', variant }] : []),
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

test.describe('Result external share (result_share, mocked)', () => {
  test('treatment: Share image appears and the feed button is renamed', async ({ page }) => {
    await boot(page, 'treatment');
    await expect(page.locator('#msr-share-ext-btn')).toBeVisible();
    await expect(page.locator('#msr-share-btn')).toHaveText('Post to feed');
  });

  test('treatment: tapping Share image logs the result_share feature event', async ({ page }) => {
    await boot(page, 'treatment');
    const logged = page.waitForRequest(r => r.url().includes('/rest/v1/feature_events') && r.method() === 'POST'
      && r.postData()?.includes('result_share'));
    // No scatter data in this mocked flow → the text-share path runs; stub the
    // share sheet so the tap resolves as a completed share.
    await page.evaluate(() => { navigator.share = () => Promise.resolve(); });
    await page.click('#msr-share-ext-btn');
    await logged;
  });

  test('control: no external button, feed button keeps its name', async ({ page }) => {
    await boot(page, 'control');
    await expect(page.locator('#msr-share-ext-btn')).toBeHidden();
    await expect(page.locator('#msr-share-btn')).toHaveText('Share result');
  });

  test('unknown key (experiment deleted): CTA is the classic two-button row', async ({ page }) => {
    await boot(page, null);
    await expect(page.locator('#msr-share-ext-btn')).toBeHidden();
    await expect(page.locator('#msr-share-btn')).toHaveText('Share result');
  });
});
