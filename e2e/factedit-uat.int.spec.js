// ── Real UAT: fun fact attaches when a watch is tagged AFTER posting ─────────
// Regression (@crash, 2026-07-28): a post created untagged and tagged later via
// Edit post kept fact_id null forever — saveEditPost wrote watch_id but never
// called attachFunFact. This drives the real path against real Supabase:
// post untagged (PRIVATE) → tag a watch via Edit → assert fact_id lands.
//
// Requires dev-config.js. Uses testuser only, private visibility, and deletes
// the post it creates.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const response = await page.goto('/dev-config.js');
  if (!response || response.status() !== 200) {
    test.skip(true, 'dev-config.js not found — skipping integration tests');
  }
});

async function devLogin(page) {
  await page.goto('/');
  await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });
  await page.click('#dev-login-wrap button:first-child');
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 15_000 });
  await page.waitForSelector('nav', { state: 'visible', timeout: 5_000 });
}

test('tagging a watch on an untagged post attaches a fun fact', async ({ page }) => {
  test.setTimeout(120_000);
  await devLogin(page);

  // The collection loads asynchronously after boot. Acting before it lands made
  // an earlier version of this test mistake a pre-existing log for its own.
  await page.waitForFunction(() => Array.isArray(watches) && watches.length > 0, null,
    { timeout: 20_000 });

  // 1. Post with no watch tagged, private. Marked with a unique body so the row
  // is identified by content, never by "whatever is new in logs".
  const marker = `UAT tag-after-post ${Date.now()}`;
  const logId = await page.evaluate(async (body) => {
    openNewPost();
    document.getElementById('np-body').value = body;
    document.querySelectorAll('#np-vis-chips .chip').forEach(c => c.classList.remove('selected'));
    document.querySelector('#np-vis-chips .chip[data-vis="private"]').classList.add('selected');
    await saveNewPost();
    const mine = logs.filter(l => l.notes === body);
    return mine.length === 1 ? mine[0].id : null;
  }, marker);
  expect(logId, 'exactly one new log row was created, found by its marker').toBeTruthy();

  try {
    const created = await page.evaluate((id) => {
      const l = logs.find(x => x.id === id);
      return { watchId: l.watchId || null, factId: l.factId || null };
    }, logId);
    expect(created.watchId, 'post starts untagged').toBeNull();
    expect(created.factId, 'untagged post has no fact').toBeNull();

    // 2. Edit post is reached from the feed card, and openEditPost() bails
    // unless the log is in feedItems — so load the feed the way a user would.
    // loadFeed() self-guards against re-entry, so a single call can no-op while
    // the boot load is still in flight — retry until the post shows up.
    await expect.poll(async () => page.evaluate(async (id) => {
      if (feedItems.some(i => i.id === id)) return true;
      if (feedLoading) return false;
      feedLoadedAt = 0;
      await loadFeed();
      return feedItems.some(i => i.id === id);
    }, logId), { timeout: 30_000, intervals: [1000] }).toBe(true);

    // 3. Tag a watch through the Edit post flow.
    const opened = await page.evaluate(async (id) => {
      openEditPost(id);
      if (editPostLogId !== id) return { ok: false };
      selectEpWatch(watches[0].id);
      await saveEditPost();
      return { ok: true, watch: watches[0].brand + ' ' + watches[0].name };
    }, logId);
    expect(opened.ok, 'the edit modal actually opened on our post').toBe(true);

    // 4. The fact generation is fire-and-forget and grounded (~10-15s) — poll.
    await expect.poll(async () => page.evaluate((id) => {
      const l = logs.find(x => x.id === id);
      return l && l.factId ? 'has-fact' : 'no-fact';
    }, logId), { timeout: 90_000, intervals: [1000] }).toBe('has-fact');

    // 5. It must be persisted server-side, not just in local state.
    const persisted = await page.evaluate(async (id) => {
      const { data } = await db.from('logs').select('watch_id, fact_id').eq('id', id).single();
      return data;
    }, logId);
    expect(persisted.watch_id, 'watch tag persisted').toBeTruthy();
    expect(persisted.fact_id, 'fact_id persisted').toBeTruthy();
  } finally {
    // Delete by id AND marker — never remove a row this test didn't create.
    await page.evaluate(async ({ id, body }) => {
      await db.from('logs').delete().eq('id', id).eq('notes', body);
    }, { id: logId, body: marker });
  }
});
