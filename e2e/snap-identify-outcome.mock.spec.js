// ── Snap to Track: recognition outcome is recorded ──────────────────────────
// The admin Usage tab counts snap_identify_outcome rows ("Wear recognition —
// Snap to Track"). Before 2026-09-23 this path wrote nothing, so there was no
// way to tell how often a wrist photo resolved to a watch in the collection.
import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/AP+AAAAAElFTkSuQmCC',
  'base64'
);
const tinyFile = { name: 'wrist.png', mimeType: 'image/png', buffer: PNG_1x1 };

async function captureFeatureEvents(page) {
  const rows = [];
  await page.route('**/rest/v1/feature_events*', async (route) => {
    if (route.request().method() === 'POST') {
      try { rows.push(JSON.parse(route.request().postData() || '{}')); } catch { /* ignore */ }
    }
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  return rows;
}

async function snap(page, identifyBody) {
  await page.route('**/functions/v1/identify-watch', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(identifyBody) })
  );
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'track');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#snap-to-track-btn').click();
  (await chooser).setFiles(tinyFile);
}

const snapRows = (rows) => rows.flat().filter(r => r.event === 'snap_identify_outcome');

test.describe('Snap to Track outcome (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
  });

  test('a photo matching one collection watch records matched', async ({ page }) => {
    const rows = await captureFeatureEvents(page);
    const w = SAMPLE_WATCHES[0];
    await snap(page, { watches: [{ brand: w.brand, model: w.name, reference: w.ref, confidence: 'high' }] });
    await expect.poll(() => snapRows(rows).length, { timeout: 10_000 }).toBe(1);
    expect(snapRows(rows)[0].meta).toEqual({ outcome: 'matched', match_count: 1 });
  });

  test('a watch not in the collection records no_match', async ({ page }) => {
    const rows = await captureFeatureEvents(page);
    await snap(page, { watches: [{ brand: 'Grand Seiko', model: 'Snowflake', reference: 'SBGA211' }] });
    await expect.poll(() => snapRows(rows).length, { timeout: 10_000 }).toBe(1);
    expect(snapRows(rows)[0].meta).toEqual({ outcome: 'no_match' });
  });

  test('nothing recognised records no_watches_found', async ({ page }) => {
    const rows = await captureFeatureEvents(page);
    await snap(page, { watches: [] });
    await expect.poll(() => snapRows(rows).length, { timeout: 10_000 }).toBe(1);
    expect(snapRows(rows)[0].meta).toEqual({ outcome: 'no_watches_found' });
  });
});
