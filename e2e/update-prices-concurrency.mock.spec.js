// ── Update Prices: bounded fan-out ───────────────────────────────────────────
// Regression (2026-09-17 19:54:44): openUpdatePrices used a bare forEach, so a
// 38-watch collection fired 38 simultaneous watch-value calls. Google rejected
// one instantly with 503 UNAVAILABLE and two more hit the server's 35s Gemini
// timeout — three watches fell through to Claude + web search, for most of that
// day's spend. Ten concurrent measured clean twice; the pool caps at eight.
import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES } from './helpers.js';

const CAP = 8;
const TOTAL = 20;

const manyWatches = Array.from({ length: TOTAL }, (_, i) => ({
  ...SAMPLE_WATCHES[0],
  id: `watch-${String(i).padStart(3, '0')}`,
  brand: 'Rolex',
  name: `Test Model ${i}`,
  ref: `REF-${i}`,
}));

test.describe('Update Prices concurrency (mocked)', () => {
  test('never has more than the cap in flight, and still looks up every watch', async ({ page }) => {
    let inFlight = 0, peak = 0, started = 0;

    await mockSupabase(page, { watches: manyWatches, logs: [] });
    await injectSession(page);

    await page.route('**/functions/v1/watch-value', async (route) => {
      started++;
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Hold the slot long enough that an unbounded forEach would stack up.
      await new Promise((r) => setTimeout(r, 120));
      inFlight--;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          estimated_value_usd: { low: 100, mid: 200, high: 300 },
          confidence: 'high',
        }),
      });
    });

    await page.goto('/');
    await waitForAppBoot(page);

    await page.evaluate(() => { openUpdatePrices(); });

    await expect(page.locator('#update-prices-status'))
      .toContainText('Done', { timeout: 30_000 });

    expect(started, 'every eligible watch is still looked up').toBe(TOTAL);
    expect(peak, `at most ${CAP} concurrent lookups`).toBeLessThanOrEqual(CAP);
    // Guard the other direction: a serial loop would be correct but far slower.
    expect(peak, 'still runs in parallel, not one at a time').toBeGreaterThan(1);
  });
});
