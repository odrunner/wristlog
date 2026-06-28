import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_LOGS } from './helpers.js';

const ADMIN_USER = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5', email: 'admin@wrotate.com', aud: 'authenticated', role: 'authenticated' };

test.describe('Featured post (mocked)', () => {
  test('★ Featured pill renders on the pinned post', async ({ page }) => {
    await mockSupabase(page, { logs: SAMPLE_LOGS, featuredId: 'log-001' });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await navigateTo(page, 'feed');
    await expect(page.locator('.feat-pill').first()).toBeVisible({ timeout: 8000 });
  });

  test('admin sees the Feature kebab item', async ({ page }) => {
    await mockSupabase(page, { logs: SAMPLE_LOGS, user: ADMIN_USER });
    await injectSession(page, ADMIN_USER);
    await page.goto('/');
    await waitForAppBoot(page);
    await navigateTo(page, 'feed');
    // open the kebab on the public post (log-001)
    await page.locator('#feedcard-log-001 .feed-dots-wrap button').click();
    await expect(page.getByText('Feature this post')).toBeVisible({ timeout: 5000 });
  });

  test('non-admin does not see the Feature kebab item', async ({ page }) => {
    await mockSupabase(page, { logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await navigateTo(page, 'feed');
    await page.locator('#feedcard-log-001 .feed-dots-wrap button').click();
    await expect(page.getByText('Feature this post')).toHaveCount(0);
  });
});
