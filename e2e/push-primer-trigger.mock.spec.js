import { test, expect } from '@playwright/test';

// Where the push primer fires, driven through the real functions in a real page.
// The unit test asserts the call sites exist in the source; this proves the modal
// actually appears (and doesn't), which the source scan cannot — the primer is
// wrapped in a 900ms setTimeout AND an overlay guard, so a call site can be
// present and still be dead in practice.
//
// Background: the primer used to fire from markMeasurementTried(), i.e. on the
// "Start Listening" tap. Over its first 25 shows it was clicked 0 times and
// dismissed 25 times at a median of 1.9s. It now fires once a reading is saved.

// The primer is native-only: it needs the appAction bridge and iOS >= 2.3.
// Injected before app scripts run so _pushBridge() sees it at call time.
async function bootNative(page) {
  await page.addInitScript(() => {
    window.webkit = { messageHandlers: { appAction: { postMessage: (m) => {
      (window.__bridgeCalls = window.__bridgeCalls || []).push(m);
    } } } };
    window._iosAppVersion = '2.4';
  });
  await page.goto('/');
  await page.evaluate(() => {
    // currentUser / _isDemoMode are top-level let bindings in index.html's classic
    // script, so they never land on `window` — assign the bare identifiers or the
    // app reads its own untouched values. (Same trap documented in fact-modal.mock.)
    currentUser = { id: 'u1' };
    _isDemoMode = false;
    window._pushAuthStatus = 'notDetermined';
    localStorage.removeItem('wr_push_primer');
    localStorage.removeItem('wrotate_tried_measure');
    // Nothing else on screen: the primer bails if any overlay is already open.
    document.querySelectorAll('.overlay:not(.hidden)').forEach(el => el.classList.add('hidden'));
    // Sign-in is not what's under test here, and the landing screen sits above the
    // modal layer — it swallows the clicks these tests need to make.
    const auth = document.getElementById('auth-screen');
    if (auth) auth.style.display = 'none';
  });
}

const primerVisible = (page) => page.evaluate(async () => {
  // The primer opens on a 900ms timer; give it room, then read the real DOM.
  await new Promise(r => setTimeout(r, 1400));
  const m = document.getElementById('push-primer-modal');
  return !!m && !m.classList.contains('hidden');
});

test('starting a measurement does NOT raise the primer', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => window.markMeasurementTried());
  expect(await primerVisible(page)).toBe(false);
});

test('finishing with a saved measurement raises the primer', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => window.dismissMsrShareCta());
  expect(await primerVisible(page)).toBe(true);
});

test('the primer that appears can actually reach the OS prompt', async ({ page }) => {
  // Guards the whole point of the change: a primer nobody can act on is no
  // better than one nobody sees. "Turn on notifications" must post to the bridge.
  await bootNative(page);
  await page.evaluate(() => window.dismissMsrShareCta());
  expect(await primerVisible(page)).toBe(true);
  await page.locator('#push-primer-modal button.btn-primary').click();
  expect(await page.evaluate(() => window.__bridgeCalls || [])).toContainEqual({
    action: 'requestPushPermission',
  });
  expect(await page.evaluate(() =>
    document.getElementById('push-primer-modal').classList.contains('hidden'))).toBe(true);
});

test('declining records the cooldown so it cannot nag on the next save', async ({ page }) => {
  await bootNative(page);
  await page.evaluate(() => window.dismissMsrShareCta());
  expect(await primerVisible(page)).toBe(true);
  await page.locator('#push-primer-modal button.btn-ghost').click();
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('wr_push_primer') || '{}'));
  expect(st.declineCount).toBe(1);
  expect(st.lastDeclinedMs).toBeGreaterThan(0);
  // Second saved measurement, same session: suppressed by the 7-day cooldown.
  await page.evaluate(() => window.dismissMsrShareCta());
  expect(await primerVisible(page)).toBe(false);
});
