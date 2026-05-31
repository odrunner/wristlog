import { test, expect } from '@playwright/test';

// Integration UAT: opening the app while logged in should fire the throttled
// presence ping (touch_presence), recording "last open" without any user action
// like posting/logging. Hits real Supabase via the testuser dev login.
const APP_URL = 'http://localhost:3000';

test('presence ping fires on app boot for a logged-in user', async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });

  // Arm the response listener BEFORE login so we catch the boot-time RPC.
  const pingResp = page.waitForResponse(
    (r) => r.url().includes('/rpc/touch_presence'),
    { timeout: 20_000 }
  );

  // Dev login as testuser (first button). Fresh context => empty localStorage,
  // so the once-per-hour throttle does not suppress this first ping.
  await page.click('#dev-login-wrap button:first-child');
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 15_000 });

  const resp = await pingResp;
  // touch_presence RETURNS void -> PostgREST replies 204 No Content.
  expect(resp.status()).toBeGreaterThanOrEqual(200);
  expect(resp.status()).toBeLessThan(300);
});
