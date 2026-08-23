import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES, SAMPLE_LOGS, FAKE_USER } from './helpers.js';

// The mocked account is a new user: retroactiveBadgeScan() awards the starter
// badges on its first boot. Those awards must then be ON RECORD for the rest of
// the test (user_badges is stateful in mockSupabase), so a reload does not
// award — and push-notify — the same badges again. (Until 2026-08-22 the table
// was never mocked at all — the helper routed a nonexistent `earned_badges` —
// so every boot re-awarded 1/3/4 and popped the reveal modal.)

test('starter badges are awarded once per mocked context, not on every boot', async ({ page }) => {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
  const posts = [];
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/rest/v1/user_badges')) posts.push(JSON.parse(r.postData() || '{}').badge_ref); });

  await page.goto('/');
  await waitForAppBoot(page);
  await expect.poll(() => page.evaluate(() => (_earnedBadges || []).map(e => e.badge_ref).sort())).toEqual([1, 3, 4]);
  const firstBoot = posts.length;
  expect(firstBoot).toBeGreaterThan(0);

  await page.reload();
  await waitForAppBoot(page);
  await expect.poll(() => page.evaluate(() => (_earnedBadges || []).map(e => e.badge_ref).sort())).toEqual([1, 3, 4]);
  await page.waitForTimeout(1500);
  expect(posts.length).toBe(firstBoot);                 // nothing re-awarded
});

test('a seeded badges fixture is what the app sees, and nothing is re-awarded', async ({ page }) => {
  await injectSession(page);
  const seeded = [1, 3, 4].map(r => ({ id: 'b' + r, user_id: FAKE_USER.id, badge_ref: r, earned_at: '2026-01-01T00:00:00Z', seen: true }));
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS, badges: seeded });
  const posts = [];
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/rest/v1/user_badges')) posts.push(1); });
  await page.goto('/');
  await waitForAppBoot(page);
  await expect.poll(() => page.evaluate(() => (_earnedBadges || []).length)).toBe(3);
  await page.waitForTimeout(1500);
  expect(posts.length).toBe(0);
});
