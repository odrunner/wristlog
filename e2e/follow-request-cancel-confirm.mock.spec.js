import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// A single tap on "Requested" used to cancel the follow request instantly.
// One accidental tap silently deleted the pending request, the natural next
// tap re-sent it, and the target got a duplicate notification + email (the
// client-side notification dedup can't work — RLS hides the target's rows).
// The button now requires a second confirming tap, like Unfollow/Unfriend.

async function boot(page) {
  await mockSupabase(page, {});
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
}

async function addRequestedButton(page) {
  // Wired exactly like friendActionBtn renders it for a pending request.
  await page.evaluate(() => {
    pendingRequests.add('e2e-target-1');
    const b = document.createElement('button');
    b.id = 'e2e-req-btn';
    b.className = 'follow-btn requested';
    b.textContent = 'Requested';
    b.onclick = function () { confirmCancelRequest('e2e-target-1', this); };
    document.body.appendChild(b);
  });
  return page.locator('#e2e-req-btn');
}

test.describe('Requested button confirm-before-cancel (mocked)', () => {
  test('first tap only arms; second tap deletes the request', async ({ page }) => {
    await boot(page);
    const deletes = [];
    await page.route('**/rest/v1/follow_requests*', (route) => {
      if (route.request().method() === 'DELETE') {
        deletes.push(route.request().url());
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    const btn = await addRequestedButton(page);

    await btn.click();
    await expect(btn).toHaveText('Cancel request?');
    expect(deletes).toEqual([]);

    await btn.click();
    await expect(btn).toHaveText('Follow');
    await expect.poll(() => deletes.length).toBe(1);
    expect(deletes[0]).toContain('target_id=eq.e2e-target-1');
  });

  test('an armed button reverts to Requested after 3s without cancelling', async ({ page }) => {
    await boot(page);
    const deletes = [];
    await page.route('**/rest/v1/follow_requests*', (route) => {
      if (route.request().method() === 'DELETE') {
        deletes.push(1);
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    const btn = await addRequestedButton(page);

    await btn.click();
    await expect(btn).toHaveText('Cancel request?');
    await expect(btn).toHaveText('Requested', { timeout: 5000 });
    expect(deletes).toEqual([]);
  });
});
