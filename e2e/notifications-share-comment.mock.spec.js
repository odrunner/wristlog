import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';

// A comment left on a share link has no actor profile — the bell row must name
// the commenter from the comment itself and open the matching Shared-links modal.
test('a share_comment notification names the commenter and opens Shared links', async ({ page }) => {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
  await page.route('**/rest/v1/notifications*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'n1', type: 'share_comment', actor_id: null, ref_id: 'c1', is_read: false, created_at: '2026-08-22T10:00:00Z' },
  ]) }));
  await page.route('**/rest/v1/share_comments*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'c1', kind: 'collection', token: 'tok1', name: 'Sarah', body: 'Is the GMT available?', created_at: '2026-08-22T10:00:00Z', deleted_at: null },
  ]) }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(() => loadNotifications().then(() => toggleNotifPanel()));
  await expect(page.locator('#notif-n1')).toContainText('Sarah commented on your shared collection link');
  await page.click('#notif-n1');
  await expect(page.locator('#coll-share-modal')).toBeVisible();
});
