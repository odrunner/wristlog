// ── A fun fact that lands mid-sync must still reach the row ─────────────────
// Regression (@chrisdd, 2026-07-29 06:20 UTC): quickLog/saveLog persist the new
// wear through the dirty-sync, then attachFunFact stamps factId and re-marks the
// SAME id dirty. If the first upsert was still in flight, its success deleted
// that id from the dirty set — wiping the re-mark — and fact_id was never
// written. His cursor advanced (the fact was spent) but the post showed nothing.
import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES,
} from './helpers.js';

const FACT_ID = 'fact-abc-123';
const FACT = 'A small Rolex crown sits between Swiss and Made to mark the new movement.';

test.describe('fun fact vs. in-flight sync (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    // No existing logs, so quickLog is allowed to create today's wear.
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [] });
    await injectSession(page);
  });

  test('fact_id still reaches the log when the fact lands during the first upsert', async ({ page }) => {
    const logWrites = [];

    // Timing is the whole test. save() debounces cloudSync by 500ms, so the race
    // only exists when the fact arrives AFTER the first upsert has started and
    // BEFORE it finishes. Hold that upsert open for 1500ms...
    let firstWrite = true;
    await page.route('**/rest/v1/logs*', async (route) => {
      const req = route.request();
      if (req.method() === 'POST' || req.method() === 'PATCH') {
        try { logWrites.push(JSON.parse(req.postData() || '{}')); } catch { /* ignore */ }
        if (firstWrite) { firstWrite = false; await new Promise(r => setTimeout(r, 1500)); }
        return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    // ...and return the pooled fact at 800ms — past the debounce, inside the write.
    await page.route('**/rest/v1/rpc/pick_watch_fact', async (route) => {
      await new Promise(r => setTimeout(r, 800));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        fact_id: FACT_ID, fact: FACT, needs_generation: false, existing_facts: [],
      }) });
    });

    await page.goto('/');
    await waitForAppBoot(page);

    await page.evaluate((id) => quickLog(id), SAMPLE_WATCHES[0].id);

    // Somewhere in the writes, fact_id must have been persisted.
    await expect.poll(
      () => logWrites.flat().some(r => r && r.fact_id === FACT_ID),
      { timeout: 25_000, intervals: [500] }
    ).toBe(true);
  });
});
