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

  // Regression (2026-11-16 03:25 UTC): a 10-watch run showed "Error" on 8 rows
  // although the server had priced all 10. The page left the foreground for
  // ~30s mid-run and iOS dropped the answers in flight. A dropped connection
  // now re-asks once, flagged `retry` so the server replays the answer it
  // already has instead of paying for the lookup again.
  test('a dropped connection is re-asked once and the row still gets its price', async ({ page }) => {
    const few = manyWatches.slice(0, 4);
    const seen = {};
    const retryFlags = [];
    const completes = [];
    page.on('request', (req) => {
      if (req.method() !== 'POST' || !req.url().includes('/rest/v1/valuation_events')) return;
      const b = req.postDataJSON();
      if (b && b.action === 'complete') completes.push(b);
    });

    await mockSupabase(page, { watches: few, logs: [] });
    await injectSession(page);

    await page.route('**/functions/v1/watch-value', async (route) => {
      const body = route.request().postDataJSON();
      seen[body.watch_id] = (seen[body.watch_id] || 0) + 1;
      if (seen[body.watch_id] === 1) return route.abort('connectionreset');
      retryFlags.push(body.retry);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ estimated_value_usd: { low: 100, mid: 200, high: 300 }, confidence: 'high' }),
      });
    });

    await page.goto('/');
    await waitForAppBoot(page);
    await page.evaluate(() => { openUpdatePrices(); });

    await expect(page.locator('#update-prices-status'))
      .toContainText(`Done — ${few.length} prices found`, { timeout: 30_000 });
    await expect(page.locator('#update-prices-rows')).not.toContainText('Error');
    expect(retryFlags, 'every second ask is flagged as a retry').toEqual(few.map(() => true));

    // A recovered row is still recorded: first ask failed, retry worked.
    await expect.poll(() => completes.length).toBe(1);
    const why = JSON.parse(completes[0].error);
    expect(why.f.filter((x) => x.a === 1 && x.e).length).toBe(few.length);
    expect(why.f.filter((x) => x.a === 2 && x.ok === 1).length).toBe(few.length);
  });

  test('a lookup that fails twice still ends as Error, asked no more than twice', async ({ page }) => {
    const few = manyWatches.slice(0, 2);
    let asks = 0;

    await mockSupabase(page, { watches: few, logs: [] });
    await injectSession(page);
    await page.route('**/functions/v1/watch-value', (route) => { asks++; return route.abort('connectionreset'); });
    // The run's own record must say why each row failed (2026-11-16: three
    // failed runs, and nothing recorded what the phone had seen).
    const completes = [];
    page.on('request', (req) => {
      if (req.method() !== 'POST' || !req.url().includes('/rest/v1/valuation_events')) return;
      const b = req.postDataJSON();
      if (b && b.action === 'complete') completes.push(b);
    });

    await page.goto('/');
    await waitForAppBoot(page);
    await page.evaluate(() => { openUpdatePrices(); });

    await expect(page.locator('#update-prices-status')).toContainText('Done', { timeout: 30_000 });
    await expect(page.locator('#update-prices-rows .text-danger')).toHaveCount(few.length);
    expect(asks).toBe(few.length * 2);

    await expect.poll(() => completes.length).toBe(1);
    const why = JSON.parse(completes[0].error);
    expect(why.v, 'names the page version that ran').toBeTruthy();
    expect(why.f.map((x) => `${x.i}:${x.a}`).sort()).toEqual(['0:1', '0:2', '1:1', '1:2']);
    for (const x of why.f) {
      expect(x.e, 'carries the browser error text').toMatch(/\S/);
      expect(x.vis).toBe(1);
      expect(typeof x.t).toBe('number');
    }
  });
});
