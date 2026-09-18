import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES } from './helpers.js';

// _nativeRefreshSession() is what the iOS app calls when it is backgrounded.
// Drives the real function with a stand-in native bridge and a stubbed auth
// client: an old token is renewed, a recent one is left alone, and native
// always gets SESSION_REFRESH_DONE so it can end its background task.

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = iat => ['h', b64url({ iat }), 's'].join('.');

async function run(page, { ageSec, refreshError = null, signedOut = false }) {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [] });
  await page.goto('/');
  await waitForAppBoot(page);
  return page.evaluate(async ({ token, refreshError, signedOut }) => {
    const posted = [];
    window.webkit = { messageHandlers: { auth: { postMessage: m => posted.push(m) } } };
    let refreshCalls = 0;
    db.auth.getSession = () => Promise.resolve({ data: { session: { access_token: token, refresh_token: 'r', expires_at: 0, expires_in: 0 } }, error: null });
    db.auth.refreshSession = () => { refreshCalls++; return Promise.resolve({ data: {}, error: refreshError }); };
    if (signedOut) currentUser = null;
    const outcome = await _nativeRefreshSession();
    return { outcome, posted, refreshCalls };
  }, { token: jwt(Math.floor(Date.now() / 1000) - ageSec), refreshError, signedOut });
}

test('a token older than an hour is renewed and native is told', async ({ page }) => {
  const r = await run(page, { ageSec: 5 * 3600 });
  expect(r.refreshCalls).toBe(1);
  expect(r.posted).toEqual([{ event: 'SESSION_REFRESH_DONE', outcome: 'refreshed' }]);
});

test('a recent token is left alone — no rotation on a quick app-switch', async ({ page }) => {
  const r = await run(page, { ageSec: 120 });
  expect(r.refreshCalls).toBe(0);
  expect(r.posted).toEqual([{ event: 'SESSION_REFRESH_DONE', outcome: 'fresh' }]);
});

test('a failed refresh still answers native', async ({ page }) => {
  const r = await run(page, { ageSec: 5 * 3600, refreshError: { message: 'offline' } });
  expect(r.posted).toEqual([{ event: 'SESSION_REFRESH_DONE', outcome: 'error' }]);
});

test('a signed-out page skips without touching the session', async ({ page }) => {
  const r = await run(page, { ageSec: 5 * 3600, signedOut: true });
  expect(r.refreshCalls).toBe(0);
  expect(r.posted).toEqual([{ event: 'SESSION_REFRESH_DONE', outcome: 'skipped' }]);
});
