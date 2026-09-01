import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, FAKE_USER } from './helpers.js';

// Remove a follower from your own Followers list (Strava-style). The row gets a
// Remove control that arms on the first tap and deletes the follows row on the
// second. Other people's Followers lists show no such control.

const FOLLOWER = { id: 'e2e-follower-1', username: 'kicked', display_name: 'Kicked Person', avatar_url: null, profile_privacy: 'public' };

async function boot(page, { ownerId }) {
  await mockSupabase(page, {});
  await injectSession(page);
  const deletes = [];
  await page.route('**/rest/v1/follows*', (route) => {
    const m = route.request().method();
    if (m === 'DELETE') { deletes.push(route.request().url()); return route.fulfill({ status: 204, body: '' }); }
    if (m === 'GET' && route.request().url().includes(`following_id=eq.${ownerId}`)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ follower_id: FOLLOWER.id }]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/rest/v1/profiles*', (route) => {
    if (route.request().method() === 'GET' && route.request().url().includes(`id=in.`)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([FOLLOWER]) });
    }
    return route.fallback();
  });
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate((id) => openFollowersModal(id), ownerId);
  await expect(page.locator('#followers-list .user-card')).toHaveCount(1);
  return deletes;
}

test.describe('Remove follower (mocked)', () => {
  test('own list: first tap arms, second tap deletes the follower → me row and drops the row', async ({ page }) => {
    const deletes = await boot(page, { ownerId: FAKE_USER.id });
    const btn = page.locator('#followers-list .remove-follower');
    await expect(btn).toHaveText('Remove');

    await btn.click();
    await expect(btn).toHaveText('Remove?');
    expect(deletes).toEqual([]);

    await btn.click();
    await expect.poll(() => deletes.length).toBe(1);
    expect(deletes[0]).toContain(`follower_id=eq.${FOLLOWER.id}`);
    expect(deletes[0]).toContain(`following_id=eq.${FAKE_USER.id}`);
    await expect(page.locator('#followers-list .user-card')).toHaveCount(0);
    await expect(page.locator('#followers-list')).toContainText('No followers yet');
  });

  test('someone else\'s list has no Remove control', async ({ page }) => {
    await boot(page, { ownerId: 'e2e-other-owner' });
    await expect(page.locator('#followers-list .remove-follower')).toHaveCount(0);
  });
});
