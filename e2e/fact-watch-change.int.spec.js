// ── F1: changing a post's watch must not leave the old watch's fact ─────────
// Before the fix this post displayed a Rolex GMT-Master II "Batgirl" fact under a
// Cartier Santos, and re-tagging never corrected it because factId was set.
// Real backend, testuser only, private visibility, cleans up after itself.
import { test, expect } from '@playwright/test';

const A = 'c0a3f4ab-5242-4449-a877-c2fa5e2bdbf1'; // Rolex GMT-Master II
const B = '995b0bb4-00bf-4fa3-a0ed-a529c11d2b07'; // Cartier Santos de Cartier Medium
const A_KEY = 'rolex|gmt-master ii';
const B_KEY = 'cartier|santos de cartier medium';

test.beforeEach(async ({ page }) => {
  const r = await page.goto('/dev-config.js');
  if (!r || r.status() !== 200) test.skip(true, 'dev-config.js not found');
});

async function devLogin(page) {
  await page.goto('/');
  await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });
  await page.click('#dev-login-wrap button:first-child');
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 15_000 });
  await page.waitForSelector('nav', { state: 'visible', timeout: 5_000 });
  await page.waitForFunction(() => Array.isArray(watches) && watches.length > 0, null, { timeout: 20_000 });
}

const factKey = (page, logId) => page.evaluate(async (id) => {
  const { data: log } = await db.from('logs').select('watch_id, fact_id').eq('id', id).single();
  if (!log?.fact_id) return null;
  const { data: f } = await db.from('watch_facts').select('model_key').eq('id', log.fact_id).single();
  return f?.model_key ?? null;
}, logId);

async function openInFeed(page, logId) {
  await expect.poll(async () => page.evaluate(async (id) => {
    if (feedItems.some(i => i.id === id)) return true;
    if (feedLoading) return false;
    feedLoadedAt = 0; await loadFeed();
    return feedItems.some(i => i.id === id);
  }, logId), { timeout: 30_000, intervals: [1000] }).toBe(true);
}

test('swapping the tagged watch replaces the fact instead of keeping the old one', async ({ page }) => {
  test.setTimeout(240_000);
  await devLogin(page);

  const marker = `F1 regression ${Date.now()}`;
  const logId = await page.evaluate(async ({ body, a }) => {
    openNewPost();
    document.getElementById('np-body').value = body;
    document.querySelectorAll('#np-vis-chips .chip').forEach(c => c.classList.remove('selected'));
    document.querySelector('#np-vis-chips .chip[data-vis="private"]').classList.add('selected');
    selectNpWatch(a);
    await saveNewPost();
    const mine = logs.filter(l => l.notes === body);
    return mine.length === 1 ? mine[0].id : null;
  }, { body: marker, a: A });
  expect(logId).toBeTruthy();

  try {
    await expect.poll(() => factKey(page, logId), { timeout: 90_000, intervals: [1500] }).toBe(A_KEY);

    // Swap A -> B. The fact must follow the watch.
    await openInFeed(page, logId);
    await page.evaluate(async ({ id, b }) => {
      openEditPost(id); selectEpWatch(b); await saveEditPost();
    }, { id: logId, b: B });
    await expect.poll(() => factKey(page, logId), { timeout: 90_000, intervals: [1500] }).toBe(B_KEY);

    // Removing the watch must not leave a stale fact behind.
    await openInFeed(page, logId);
    await page.evaluate(async (id) => {
      openEditPost(id); removeEpWatch(); await saveEditPost();
    }, logId);
    await expect.poll(() => factKey(page, logId), { timeout: 30_000, intervals: [1000] }).toBe(null);

    // Re-tagging gets a correct fact rather than being blocked forever.
    await openInFeed(page, logId);
    await page.evaluate(async ({ id, b }) => {
      openEditPost(id); selectEpWatch(b); await saveEditPost();
    }, { id: logId, b: B });
    await expect.poll(() => factKey(page, logId), { timeout: 90_000, intervals: [1500] }).toBe(B_KEY);
  } finally {
    await page.evaluate(async ({ id, body }) => {
      await db.from('logs').delete().eq('id', id).eq('notes', body);
    }, { id: logId, body: marker });
  }
});
