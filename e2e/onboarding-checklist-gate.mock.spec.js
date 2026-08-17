import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, FAKE_USER, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';

// The "Getting started" card decides who needs it from the user_badges query.
// renderFeed() paints before that query returns, so it used to show "0/3" to
// every user for the round-trip (and permanently when the query failed).
// The card must stay hidden until badges are actually loaded.

const DONE = [1, 2, 3].map(r => ({ id: 'b' + r, user_id: FAKE_USER.id, badge_ref: r, earned_at: '2026-01-01T00:00:00Z', seen: true }));

async function boot(page, badgeRoute) {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
  await page.route('**/rest/v1/user_badges*', badgeRoute);
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
}
const cardShown = (page) => page.evaluate(() => !!document.querySelector('#onboarding-checklist .ob-card'));

test('completed user never sees the card while badges load slowly', async ({ page }) => {
  await boot(page, async route => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 200, body: '[]' });
    await new Promise(r => setTimeout(r, 2500));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DONE) });
  });
  for (let i = 0; i < 8; i++) {
    expect(await cardShown(page), `sample ${i}`).toBe(false);
    await page.waitForTimeout(500);
  }
});

test('card stays hidden when the badge query fails', async ({ page }) => {
  await boot(page, route => route.request().method() === 'GET'
    ? route.abort('failed')
    : route.fulfill({ status: 200, body: '[]' }));
  await page.waitForTimeout(3000);
  expect(await cardShown(page)).toBe(false);
});

test('new user still gets the card once badges are loaded', async ({ page }) => {
  await boot(page, route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.waitForFunction(() => !!document.querySelector('#onboarding-checklist .ob-card'), null, { timeout: 8000 });
  const count = await page.textContent('#onboarding-checklist .ob-count');
  expect(count).toMatch(/\/3$/);
});
