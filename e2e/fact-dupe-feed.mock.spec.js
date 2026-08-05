// Regression (@diegovagni, 2026-08-02): the same Citizen NY0107-85L was logged
// twice, 11 minutes apart. Both posts froze the same fact_id, so the feed
// rendered the identical "Fun fact — ..." footnote on both cards. Only the
// first post carrying a given fact should keep the footnote.
import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES, FAKE_USER } from './helpers.js';

const FACT_A = 'The legendary durability of this design lineage was proven on an expedition.';
const FACT_B = 'Its crystal is a mineral hardlex, not sapphire, which is why it survives knocks.';

const log = (id, fact_id, user_id = FAKE_USER.id, watch_id = 'watch-001', date = '2026-08-02') => ({
  id, user_id, watch_id, date,
  use_case: 'work', notes: null, strap_id: null, photo_url: null,
  visibility: 'public', club_id: null, fact_id,
});

async function bootFeed(page, logs, facts) {
  await mockSupabase(page, { logs, watches: SAMPLE_WATCHES });
  await page.route('**/rest/v1/watch_facts*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(facts) })
  );
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
  // Phase 1 renders without facts; wait for the Phase-2 enrichment render.
  await expect(page.locator('#feedcard-log-dupe-1')).toBeVisible({ timeout: 8000 });
}

test.describe('Duplicate fun fact in the feed (mocked)', () => {
  test('two posts sharing a fact render the footnote once, on the first card', async ({ page }) => {
    await bootFeed(
      page,
      [log('log-dupe-1', 'fact-a'), log('log-dupe-2', 'fact-a')],
      [{ id: 'fact-a', fact: FACT_A }],
    );
    await expect(page.locator('#feedcard-log-dupe-1 .funfact-row')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('#feedcard-log-dupe-2 .funfact-row')).toHaveCount(0);
    await expect(page.locator('.funfact-row')).toHaveCount(1);
  });

  // Deliberately NOT deduped across users: a post that silently has no fun fact
  // reads as broken to the person who wrote it. The picker's per-user offset is
  // what keeps two people from drawing the same fact in the first place.
  test('a different user posting the same watch keeps their own footnote', async ({ page }) => {
    await bootFeed(
      page,
      [log('log-dupe-1', 'fact-a'), log('log-dupe-2', 'fact-a', 'other-user-id-111')],
      [{ id: 'fact-a', fact: FACT_A }],
    );
    await expect(page.locator('#feedcard-log-dupe-1 .funfact-row')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('#feedcard-log-dupe-2 .funfact-row')).toHaveCount(1);
  });

  test('two posts with different facts both keep their footnote', async ({ page }) => {
    await bootFeed(
      page,
      [log('log-dupe-1', 'fact-a'), log('log-dupe-2', 'fact-b')],
      [{ id: 'fact-a', fact: FACT_A }, { id: 'fact-b', fact: FACT_B }],
    );
    await expect(page.locator('#feedcard-log-dupe-1 .funfact-row')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('#feedcard-log-dupe-2 .funfact-row')).toHaveCount(1);
  });
});
