// ── New Post: posting before AI identification lands ────────────────────────
// Regression (@crash, 2026-07-28 14:58:17 UTC): identification is fire-and-
// forget, started when the photo is attached. saveNewPost read the tagged watch
// synchronously, so a post submitted 23ms before a 4610ms identify returned
// landed with watch_id null — no wear attribution, and no fun fact. The user
// then had to tag the watch by hand afterwards.
import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES, SAMPLE_LOGS,
} from './helpers.js';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/AP+AAAAAElFTkSuQmCC',
  'base64'
);
const tinyFile = { name: 'watch.png', mimeType: 'image/png', buffer: PNG_1x1 };

// Capture what the app actually writes to logs — the tag either made it into
// the insert or it didn't.
async function captureLogInserts(page) {
  const inserts = [];
  await page.route('**/rest/v1/logs*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      try { inserts.push(JSON.parse(req.postData() || '{}')); } catch { /* ignore */ }
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  return inserts;
}

// helpers.js doesn't mock Storage, and saveNewPost bails before the insert if
// the photo upload throws — so a photo post needs this stub to reach the DB.
async function mockStorage(page) {
  await page.route('**/storage/v1/object/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'media/x.jpg' }) })
  );
}

async function openComposerWithPhoto(page) {
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(() => openNewPost());
  await expect(page.locator('#new-post-modal')).toBeVisible();
  await page.locator('#np-photo-input').setInputFiles(tinyFile);
  // The thumbstrip appearing means the file was accepted and identification started.
  await page.waitForFunction(() => newPostFiles.length === 1, null, { timeout: 10_000 });
  await page.evaluate(() => { document.getElementById('np-body').value = 'race test'; });
}

test.describe('New Post identify race (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
  });

  test('a post submitted before a slow identification still gets the watch tagged', async ({ page }) => {
    // Identification takes 2.5s — the user posts well before it returns.
    await page.route('**/functions/v1/identify-watch', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        watches: [{ brand: 'Rolex', model: 'Submariner Date', reference: '126610LN', confidence: 'high' }],
      }) });
    });
    await mockStorage(page);
    const inserts = await captureLogInserts(page);
    await openComposerWithPhoto(page);

    // Post immediately — before identification can possibly have landed.
    await page.evaluate(() => { npIdentifiedWatchId = null; });
    await page.locator('#new-post-modal .btn-primary').click();

    await expect.poll(() => inserts.length, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(inserts[0].watch_id, 'the late identification still tagged the post')
      .toBe('watch-001');
  });

  test('an identification that finds nothing does not delay the post', async ({ page }) => {
    await page.route('**/functions/v1/identify-watch', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ watches: [] }) })
    );
    await mockStorage(page);
    const inserts = await captureLogInserts(page);
    await openComposerWithPhoto(page);

    const t0 = Date.now();
    await page.locator('#new-post-modal .btn-primary').click();
    await expect.poll(() => inserts.length, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(inserts[0].watch_id).toBeNull();
    // No wait beyond the identify itself — nowhere near the 8s cap.
    expect(Date.now() - t0).toBeLessThan(8000);
  });

  test('an explicit "no watch" choice is not overridden by a late identification', async ({ page }) => {
    await page.route('**/functions/v1/identify-watch', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        watches: [{ brand: 'Rolex', model: 'Submariner Date', reference: '126610LN', confidence: 'high' }],
      }) });
    });
    await mockStorage(page);
    const inserts = await captureLogInserts(page);
    await openComposerWithPhoto(page);

    // User deliberately clears the tag while identification is still running.
    await page.evaluate(() => clearNpWatch());
    const t0 = Date.now();
    await page.locator('#new-post-modal .btn-primary').click();

    await expect.poll(() => inserts.length, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(inserts[0].watch_id, 'the explicit choice wins').toBeNull();
    expect(Date.now() - t0, 'and Post did not wait on a result it would ignore').toBeLessThan(2000);
  });
});
