import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES } from './helpers.js';

// Accuracy History opens on an overview of every watch (latest rate + a strip on one
// shared scale); a row opens that watch's own history, and back returns to the overview.

const W = (id, brand, name) => ({ ...SAMPLE_WATCHES[0], id, brand, name });
const WATCHES = [W('w-omega', 'Omega', 'Speedmaster'), W('w-seiko', 'Seiko', 'SKX'), W('w-odd', 'A<b>&"c', 'Tank')];
const ago = (days, h = 9) => { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const READINGS = [
  { id: 'r1', watch_id: 'w-omega', rate: 2.1, beat_error: 0.2, amplitude: 280, created_at: ago(3, 10), notes: null, source: 'mic' },
  { id: 'r2', watch_id: 'w-omega', rate: 3.8, beat_error: 0.2, amplitude: 280, created_at: ago(3, 9), notes: null, source: 'mic' },
  { id: 'r3', watch_id: 'w-seiko', rate: 38, beat_error: 0.5, amplitude: 240, created_at: ago(1), notes: null, source: 'mic' },
  { id: 'r4', watch_id: 'w-deleted', rate: 1, beat_error: 0.1, amplitude: 290, created_at: ago(0), notes: null, source: 'mic' },
];

async function boot(page, { failAll = false } = {}) {
  await mockSupabase(page, { watches: WATCHES });
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/rest/v1/timegrapher_results*', route => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    const one = new URL(route.request().url()).searchParams.get('watch_id');
    if (!one && failAll) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
    const rows = one ? READINGS.filter(r => 'eq.' + r.watch_id === one) : READINGS;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await injectSession(page);
  await page.addInitScript(() => {
    window.webkit = { messageHandlers: { timegrapher: { postMessage: () => {} }, appAction: { postMessage: () => {} } } };
  });
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'measure');
  await page.evaluate(() => document.getElementById('msr-help-modal')?.classList.add('hidden'));
}
const names = (page) => page.locator('.acc-ov-row .acc-ov-name').allTextContents();

test.describe('Accuracy overview (mocked)', () => {
  test('the header icon opens every watch on one screen', async ({ page }) => {
    await boot(page);
    await page.click('#msr-history-btn');
    await expect(page.locator('.acc-ov-row')).toHaveCount(3);
    expect(await names(page)).toEqual(['Omega Speedmaster', 'Seiko SKX', 'A<b>&"c Tank']);
    const odd = page.locator('.acc-ov-row[data-watch-id="w-odd"]');
    await expect(odd).toHaveClass(/acc-ov-empty/);
    await expect(odd).toContainText('Not measured yet');
    await expect(page.locator('.acc-ov-row b')).toHaveCount(0); // the name is text, not markup
    const seiko = page.locator('.acc-ov-row[data-watch-id="w-seiko"]');
    await expect(seiko).toContainText('+38.0 s/d');
    await expect(seiko.locator('.acc-strip-arrow')).toHaveCount(1);
    await expect(page.locator('.acc-ov-row[data-watch-id="w-omega"]')).toContainText('+2.1 s/d');
    await expect(page.locator('.acc-ov-row[data-watch-id="w-omega"] .acc-strip-bar')).toHaveCount(1);
  });

  test('the sort choice reorders the list and is remembered', async ({ page }) => {
    await boot(page);
    await page.click('#msr-history-btn');
    await expect(page.locator('.acc-ov-row')).toHaveCount(3);
    await page.selectOption('#msr-hist-sort', 'accurate');
    expect((await names(page))[0]).toBe('Omega Speedmaster');
    await page.selectOption('#msr-hist-sort', 'recent');
    expect(await names(page)).toEqual(['Seiko SKX', 'Omega Speedmaster', 'A<b>&"c Tank']);
    expect(await page.evaluate(() => localStorage.getItem('msr_hist_sort'))).toBe('recent');
    await page.reload();
    await waitForAppBoot(page);
    await navigateTo(page, 'measure');
    await page.evaluate(() => document.getElementById('msr-help-modal')?.classList.add('hidden'));
    await page.click('#msr-history-btn');
    await expect(page.locator('#msr-hist-sort')).toHaveValue('recent');
  });

  test('a row opens that watch, and back returns to the overview, then to Measure', async ({ page }) => {
    await boot(page);
    await page.click('#msr-history-btn');
    await page.click('.acc-ov-row[data-watch-id="w-seiko"]');
    await expect(page.locator('#msr-hist-detail')).toBeVisible();
    await expect(page.locator('#msr-hist-watch-name')).toHaveText('Seiko SKX');
    await expect(page.locator('#msr-hist-overview')).toBeHidden();
    await expect(page.locator('#msr-hist-summary')).toContainText('+38.0 s/d');
    await page.click('#page-msr-history .page-header button');
    await expect(page.locator('#msr-hist-overview')).toBeVisible();
    await expect(page.locator('#msr-hist-detail')).toBeHidden();
    await page.click('#page-msr-history .page-header button');
    await expect(page.locator('#page-measure')).toBeVisible();
  });

  test('the card under the chart still lands on its own watch', async ({ page }) => {
    await boot(page);
    await page.selectOption('#msr-watch-select', 'w-omega');
    await expect(page.locator('#msr-history-hint')).toBeVisible();
    await page.click('#msr-history-hint');
    await expect(page.locator('#msr-hist-detail')).toBeVisible();
    await expect(page.locator('#msr-hist-watch-name')).toHaveText('Omega Speedmaster');
    // Two readings that day (+2.1 newest, +3.8): the headline is the newest reading, the
    // same number the overview row shows, not the day's median.
    await expect(page.locator('#msr-hist-summary strong')).toHaveText('+2.1 s/d');
    await page.click('#page-msr-history .page-header button');
    await expect(page.locator('.acc-ov-row')).toHaveCount(3);
  });

  test('a feed promo with the open_accuracy action lands on the overview', async ({ page }) => {
    await boot(page);
    await navigateTo(page, 'feed');
    await page.evaluate(() => {
      window.logPromoEvent = () => {};
      _promoSlots = [{ id: 'acc-promo', kind: 'authored', heading: 'Accuracy', body: '', images: [],
        cta_label: 'See my watches', cta_action: 'open_accuracy' }];
      document.body.insertAdjacentHTML('afterbegin', window.renderPromoCard(_promoSlots[0]));
    });
    await page.click('[data-promo-cta]');
    await expect(page.locator('#page-msr-history')).toBeVisible();
    await expect(page.locator('#msr-hist-overview')).toBeVisible();
    await expect(page.locator('.acc-ov-row')).toHaveCount(3);
  });

  test('a failed load says so instead of calling every watch unmeasured', async ({ page }) => {
    await boot(page, { failAll: true });
    await page.click('#msr-history-btn');
    await expect(page.locator('#msr-hist-ov-list')).toContainText('Could not load your readings.');
    await expect(page.locator('.acc-ov-empty')).toHaveCount(0);
  });
});
