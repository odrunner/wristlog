import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES } from './helpers.js';

// Experiment `msr_results_help` (usability, proposed four weekly runs, built
// 2026-11-15): a finished measurement showed rate, BE, AMP and CONVERGED with
// no explanation. Treatment adds a "What do these numbers mean?" link under the
// result that opens a short plain-language panel. Control sees no link.

async function boot(page, variant, lang) {
  await mockSupabase(page, { watches: [SAMPLE_WATCHES[0]] });
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(variant ? [{ key: 'msr_results_help', variant }] : []),
  }));
  await injectSession(page);
  await page.addInitScript(() => {
    window.webkit = { messageHandlers: { timegrapher: { postMessage: () => {} }, appAction: { postMessage: () => {} } } };
  });
  await page.goto(lang ? '/?lang=' + lang : '/');
  await waitForAppBoot(page);
  await navigateTo(page, 'measure');
  await page.evaluate(() => document.getElementById('msr-help-modal')?.classList.add('hidden'));
  await page.evaluate((wid) => showMsrShareCta(wid, 4.2), SAMPLE_WATCHES[0].id);
}
const link = (page) => page.locator('#msr-share-cta .msr-explain-link button');

test.describe('Measurement explainer (msr_results_help, mocked)', () => {
  test('treatment: the link opens the panel, logs the open, and Got it closes it', async ({ page }) => {
    await boot(page, 'treatment');
    await expect(link(page)).toHaveText('What do these numbers mean?');
    const logged = page.waitForRequest(r => r.url().includes('/rest/v1/feature_events') && r.method() === 'POST'
      && r.postData()?.includes('msr_explain_opened'));
    await link(page).click();
    await logged;
    const modal = page.locator('#msr-explain-modal');
    await expect(modal).toBeVisible();
    for (const t of ['Rate (s/day)', 'Beat error (BE)', 'Amplitude (AMP)', 'CONVERGED']) await expect(modal).toContainText(t);
    await modal.locator('button', { hasText: 'Got it' }).click();
    await expect(modal).toBeHidden();
    // Escape closes it too.
    await link(page).click();
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });

  test('control: no link', async ({ page }) => {
    await boot(page, 'control');
    await expect(link(page)).toBeHidden();
  });

  test('unknown key (experiment not created yet): no link', async ({ page }) => {
    await boot(page, null);
    await expect(link(page)).toBeHidden();
  });

  test('treatment in Turkish: link and panel are translated', async ({ page }) => {
    await boot(page, 'treatment', 'tr');
    await expect(link(page)).toHaveText('Bu sayılar ne anlama geliyor?');
    await link(page).click();
    await expect(page.locator('#msr-explain-modal')).toContainText('Vuruş hatası (BE)');
    await expect(page.locator('#msr-explain-modal')).toContainText('SABİTLENDİ');
    if (process.env.SHOT) await page.locator('#msr-explain-modal .modal').screenshot({ path: process.env.SHOT });
  });
});
