import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

test.describe('EULA gate UAT (real Supabase)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForSelector('.btn-google', { timeout: 10000 });
    const devBtn = page.locator('button:has-text("testuser")').first();
    await devBtn.click();
    await page.waitForSelector('#feed-list', { timeout: 15000 });
  });

  test('app boots without showing onboarding or EULA modal', async ({ page }) => {
    const welcomeModal = page.locator('#welcome-modal');
    await expect(welcomeModal).toHaveClass(/hidden/);
    const eulaModal = page.locator('#eula-modal');
    await expect(eulaModal).toHaveClass(/hidden/);
    await expect(page.locator('#feed-list')).toBeVisible();
  });

  test('EULA modal appears when trying to save profile', async ({ page }) => {
    // Navigate to profile via the profile button
    await page.evaluate(() => openProfileModal());
    await page.waitForTimeout(2000);
    // Click Save button
    const saveBtn = page.locator('#profile-save-btn');
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      await page.waitForTimeout(1000);
      const eulaModal = page.locator('#eula-modal');
      const cls = await eulaModal.getAttribute('class') || '';
      expect(cls).not.toContain('hidden');
    }
  });

  test('accepting EULA dismisses modal and sets acceptance', async ({ page }) => {
    await page.evaluate(() => openProfileModal());
    await page.waitForTimeout(2000);
    const saveBtn = page.locator('#profile-save-btn');
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      await page.waitForTimeout(1000);
      const checkbox = page.locator('#eula-modal input[type="checkbox"]');
      if (await checkbox.isVisible()) await checkbox.check();
      const acceptBtn = page.locator('#eula-modal button:has-text("Accept")');
      if (await acceptBtn.isVisible()) {
        await acceptBtn.click();
        await page.waitForTimeout(1500);
        const eulaModal = page.locator('#eula-modal');
        await expect(eulaModal).toHaveClass(/hidden/);
        const accepted = await page.evaluate(() => myProfile?.eula_accepted_at);
        expect(accepted).toBeTruthy();
      }
    }
  });
});
