import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { siblingWithCap } from '../wrotate_test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Regression (Pixel 7, 2026-10-31 23:29 UTC edge logs): uploadImage awaited its
// best-effort card sibling inside Promise.all, so the post save — and the
// "Posting…" spinner — sat behind the sibling's decode→re-encode→upload leg.
// On Android WebView that leg measured 13.1 s (and 4.1 s on the edit a minute
// later) against <0.2 s on every iPhone post the same day. The sibling is
// droppable by design (missing card → onerror fallback to the original), so
// the save now waits for it at most SIBLING_WAIT_MS and lets it finish in the
// background.
describe('siblingWithCap', () => {
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));

  it('resolves with the sibling value when it beats the cap, and never reports late', async () => {
    let late = false;
    const v = await siblingWithCap(nap(5).then(() => 'done'), 50, nap, () => { late = true; });
    expect(v).toBe('done');
    // Let the cap timer fire too — a settled sibling must not report late.
    await nap(80);
    expect(late).toBe(false);
  });

  it('an already-resolved sibling (null path → Promise.resolve()) passes straight through', async () => {
    let late = false;
    await siblingWithCap(Promise.resolve(), 50, nap, () => { late = true; });
    await nap(80);
    expect(late).toBe(false);
  });

  it('gives up at the cap when the sibling is slower, and reports late once', async () => {
    let late = 0;
    const t0 = Date.now();
    await siblingWithCap(nap(10_000), 20, nap, () => { late++; });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(late).toBe(1);
  });

  it('a sibling that never settles cannot hold the caller past the cap', async () => {
    const never = new Promise(() => {});
    await expect(siblingWithCap(never, 20, nap, () => {})).resolves.toBeUndefined();
  });

  it('a rejecting sibling settles the race without throwing and without a late report', async () => {
    let late = false;
    await expect(
      siblingWithCap(Promise.reject(new Error('upload failed')), 50, nap, () => { late = true; }),
    ).resolves.toBeUndefined();
    await nap(80);
    expect(late).toBe(false);
  });

  it('a sibling that rejects after the cap stays handled (no unhandled rejection)', async () => {
    let unhandled = null;
    const onUnhandled = (e) => { unhandled = e; };
    process.on('unhandledRejection', onUnhandled);
    try {
      await siblingWithCap(nap(30).then(() => { throw new Error('late failure'); }), 10, nap, () => {});
      await nap(60);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toBeNull();
  });

  it('tolerates a missing onLate callback', async () => {
    await expect(siblingWithCap(nap(10_000), 20, nap, null)).resolves.toBeUndefined();
  });
});

describe('uploadImage wires the sibling cap', () => {
  it('both siblings go through siblingWithCap with SIBLING_WAIT_MS', () => {
    const i = html.indexOf('async function uploadImage(');
    expect(i).toBeGreaterThan(-1);
    const body = html.slice(i, i + 2500);
    expect(body).toMatch(/siblingWithCap\(sibling\(thumbPathFor\(path\)[\s\S]*?SIBLING_WAIT_MS/);
    expect(body).toMatch(/siblingWithCap\(sibling\(cardPathFor\(path\)[\s\S]*?SIBLING_WAIT_MS/);
  });

  it('the main upload itself is NOT capped — a slow main image must still be awaited', () => {
    const i = html.indexOf('async function uploadImage(');
    const body = html.slice(i, i + 2500);
    expect(body).toMatch(/db\.storage\.from\('media'\)\.upload\(path, resized/);
    expect(body).not.toMatch(/siblingWithCap\(\s*db\.storage/);
  });

  it('a capped-out sibling is counted via feature_events', () => {
    expect(html).toMatch(/function logSiblingLate\(/);
    expect(html).toMatch(/event:\s*'sibling_upload_late'/);
  });
});
