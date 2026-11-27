import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// Experiment msr_retry_coach: numbered retry steps after the FIRST failed run in the
// treatment arm; control still waits for a second failure.
async function boot(page, arms) {
  await mockSupabase(page, {});
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(arms),
  }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await expect.poll(() => page.evaluate(() => typeof EXPERIMENTS === 'object' && 'msr_retry_coach' in EXPERIMENTS)).toBe(true);
}

test('treatment: the coach appears after one failed run', async ({ page }) => {
  await boot(page, [{ key: 'msr_retry_coach', variant: 'treatment' }]);
  await page.evaluate(() => { _msrConsecutiveFailures = 0; stopMsrListen('no_ticks_after_recal'); });
  const box = page.locator('#msr-troubleshoot');
  await expect(box).toContainText('No reading yet. Try this, then tap Retry:');
  await expect(box).toContainText('1. Rest the watch on the microphone at the bottom edge of the phone, with the back of the watch against it');
  expect(await box.evaluate(el => el.style.display)).toBe('');
});

test('treatment: a weak signal is coached too, with the keep-still step', async ({ page }) => {
  await boot(page, [{ key: 'msr_retry_coach', variant: 'treatment' }]);
  await page.evaluate(() => { _msrConsecutiveFailures = 0; stopMsrListen('weak_signal'); });
  await expect(page.locator('#msr-troubleshoot')).toContainText('2. Keep the watch and the phone still');
});

test('control: nothing after one failed run, the old tips after two', async ({ page }) => {
  await boot(page, [{ key: 'msr_retry_coach', variant: 'control' }]);
  await page.evaluate(() => { _msrConsecutiveFailures = 0; stopMsrListen('no_ticks_after_recal'); });
  await page.waitForTimeout(900);
  expect(await page.locator('#msr-troubleshoot').evaluate(el => el.style.display)).toBe('none');
  await page.evaluate(() => stopMsrListen('no_ticks_after_recal'));
  await expect(page.locator('#msr-troubleshoot')).toContainText('directly on the microphone');
  await expect(page.locator('#msr-troubleshoot')).not.toContainText('No reading yet');
});
