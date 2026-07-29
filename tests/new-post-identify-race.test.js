import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { npIdentifyWait } from '../wrotate_test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Regression (@crash, 2026-07-28 14:58:17 UTC): New Post's AI identification is
// fire-and-forget — it starts when the photo is attached. saveNewPost read
// npIdentifiedWatchId synchronously, so a post submitted 23ms before a 4610ms
// identify returned landed with watch_id null. The user then had to tag the
// watch by hand, and because the tag arrived after creation the fun fact never
// fired either. Posting must wait for an in-flight identify — but capped, so a
// slow model can never hold the Post button hostage.
describe('npIdentifyWait', () => {
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));

  it('resolves immediately when a watch is already tagged (no wait, no sleep)', async () => {
    let slept = false;
    const never = new Promise(() => {});
    await npIdentifyWait(never, 'watch-1', 8000, () => { slept = true; return nap(0); });
    expect(slept).toBe(false);
  });

  it('resolves immediately when nothing is in flight', async () => {
    let slept = false;
    await npIdentifyWait(null, null, 8000, () => { slept = true; return nap(0); });
    expect(slept).toBe(false);
  });

  it('waits for the in-flight identification when no watch is tagged yet', async () => {
    let settled = false;
    const inFlight = nap(5).then(() => { settled = true; });
    await npIdentifyWait(inFlight, null, 8000, () => nap(10_000));
    expect(settled).toBe(true);
  });

  it('gives up at the cap so a slow identify never blocks posting', async () => {
    const never = new Promise(() => {});
    let capUsed = null;
    await npIdentifyWait(never, null, 8000, (ms) => { capUsed = ms; return nap(0); });
    expect(capUsed).toBe(8000);
  });

  it('does not reject when the in-flight identification throws', async () => {
    const boom = Promise.reject(new Error('network down'));
    await expect(npIdentifyWait(boom, null, 8000, () => nap(10_000))).resolves.toBeUndefined();
  });
});

describe('New Post wires the identify race guard', () => {
  it('tracks the in-flight identify promise', () => {
    expect(html).toMatch(/_npIdentifyInFlight\s*=\s*npIdentifyWatch\(/);
  });

  it('saveNewPost awaits it before snapshotting the tagged watch', () => {
    const i = html.indexOf('async function saveNewPost(');
    expect(i).toBeGreaterThan(-1);
    const body = html.slice(i, html.indexOf('const trackWatchId = npIdentifiedWatchId', i));
    expect(body).toContain('await npIdentifyWait(');
  });

  it('an explicit pick from the picker drops the in-flight handle, so Post never waits on a result it would ignore', () => {
    for (const fn of ['function selectNpWatch(', 'function clearNpWatch(']) {
      const i = html.indexOf(fn);
      expect(i).toBeGreaterThan(-1);
      expect(html.slice(i, i + 300)).toMatch(/_npIdentifyInFlight\s*=\s*null/);
    }
  });

  // closeNewPost() delegates to clearNewPostPhoto(), which is where every other
  // photo-derived bit of state (including npIdentifiedWatchId) is reset.
  it('clears the in-flight handle with the photo, so it cannot leak into the next post', () => {
    const i = html.indexOf('function clearNewPostPhoto(');
    const body = html.slice(i, i + 900);
    expect(body).toMatch(/_npIdentifyInFlight\s*=\s*null/);
    expect(html).toMatch(/function closeNewPost\(\)\s*\{[^}]*clearNewPostPhoto\(\)/);
  });
});
