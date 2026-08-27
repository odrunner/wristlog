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

  // Regression (@od, 2026-08-27 17:23 UTC): a Rolex shared from Photos came back
  // unrecognised with no error and no spinner. Sharing launches the app, native
  // hands the photo over before the session restores, and bootApp opens this
  // composer one tick after clearUserState() has emptied `watches` — so
  // npIdentifyWatch's `if (!watches.length) return` raced the collection
  // download against the user's tap and lost silently. No request ever reached
  // the server. It must wait for the load instead of skipping identification.
  test('a photo shared into a cold start waits for the collection instead of skipping identification', async ({ page }) => {
    let identifyCalls = 0;
    await page.route('**/functions/v1/identify-watch', (route) => {
      identifyCalls++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        watches: [{ brand: 'Rolex', model: 'Submariner Date', reference: '126610LN', confidence: 'high' }],
      }) });
    });
    await mockStorage(page);
    await page.goto('/');
    await waitForAppBoot(page);

    // Put the app back into the state bootApp hands the share modal: collection
    // wiped, load still in flight.
    await page.evaluate((b64) => {
      window.__savedWatches = watches.slice();
      watches = [];
      resetUserDataReady();
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      openNewPost({ prefillFiles: [new File([arr], 'shared.png', { type: 'image/png' })], source: 'share' });
    }, PNG_1x1.toString('base64'));

    // Nothing to match against yet, so nothing should have been sent.
    await page.waitForTimeout(400);
    expect(identifyCalls, 'must not identify against an empty collection').toBe(0);

    // loadUserData() lands, exactly as it would mid-tap on a cold start.
    await page.evaluate(() => { watches = window.__savedWatches; _markUserDataReady(); });

    await expect.poll(() => identifyCalls, {
      timeout: 10_000,
      message: 'identification must run once the collection arrives',
    }).toBe(1);
  });

  // Silence was the original complaint: recognition failed with no spinner and no
  // message, so there was no way to tell "we tried and missed" from "we never ran".
  test('a failed recognition says so, without offering a pointless retry', async ({ page }) => {
    await page.route('**/functions/v1/identify-watch', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ watches: [] }) })
    );
    await mockStorage(page);
    await openComposerWithPhoto(page);

    const sug = page.locator('#np-watch-suggestion');
    await expect(sug).toContainText("Couldn't recognize this one");
    // The picker is still the action, and it is still reachable.
    await expect(sug).toContainText('Tag a watch from your collection');
    // Retrying a genuine no-match would spend a call to print the same line.
    await expect(sug.locator('button', { hasText: 'Retry' })).toHaveCount(0);
  });

  test('a server error offers Retry, and Retry runs identification again', async ({ page }) => {
    let calls = 0;
    await page.route('**/functions/v1/identify-watch', (route) => {
      calls++;
      // Fail first, succeed on the retry — the case Retry exists for.
      if (calls === 1) return route.fulfill({ status: 502, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        watches: [{ brand: 'Rolex', model: 'Submariner Date', reference: '126610LN', confidence: 'high' }],
      }) });
    });
    await mockStorage(page);
    await openComposerWithPhoto(page);

    const sug = page.locator('#np-watch-suggestion');
    await expect(sug).toContainText("Couldn't check right now");
    await sug.locator('button', { hasText: 'Retry' }).click();

    await expect(sug).toContainText('recognized');
    expect(calls, 'Retry re-ran the identification').toBe(2);
    await expect.poll(() => page.evaluate(() => npIdentifiedWatchId)).toBe('watch-001');
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
