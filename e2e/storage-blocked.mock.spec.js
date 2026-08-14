// ── Regression: the app must boot when the browser refuses storage ──────────
//
// Guards audit finding R1. Reading localStorage THROWS rather than returning null
// under Safari's "Block all cookies", some corporate policies, and certain in-app
// webviews. The app touched it 178 times unguarded, the first during the pre-paint
// theme block, so the exception killed boot: the user got the navigation chrome and
// nothing behind it (809 visible characters -> 84), with the only feedback being
// "Something went wrong. Try refreshing." — advice that could never work.
//
// All app access now goes through window.safeLS / window.safeSS (index.html head),
// which fall back to an in-memory store.
//
// A session cannot be injected here: Supabase persists its token in localStorage, so
// with storage blocked the honest outcome is a logged-out visitor. What must hold is
// that the page RENDERS instead of dying.

import { test, expect } from '@playwright/test';
import { mockSupabase } from './helpers.js';

/** Make every storage access throw, the way a locked-down browser does. */
async function blockStorage(page) {
  await page.addInitScript(() => {
    for (const key of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, key, {
        configurable: true,
        get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
      });
    }
  });
}

test('boots with storage blocked — no uncaught errors, page still renders', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await blockStorage(page);
  await mockSupabase(page);
  await page.goto('/');
  await page.waitForTimeout(2500);

  const text = await page.evaluate(() => document.body.innerText.trim());
  console.log(`[storage-blocked] errors=${errors.length} chars=${text.length}`);
  errors.slice(0, 3).forEach((e) => console.log('   -', e.slice(0, 120)));

  expect(errors, `uncaught errors with storage blocked: ${errors.join(' | ')}`).toHaveLength(0);
  expect(text.length, 'page rendered nothing behind the chrome').toBeGreaterThan(200);
});

test('safeLS degrades to memory rather than throwing', async ({ page }) => {
  await blockStorage(page);
  await mockSupabase(page);
  await page.goto('/');
  await page.waitForTimeout(1500);

  const result = await page.evaluate(() => {
    // Must not throw, and must round-trip within the session.
    const before = safeLS.get('__missing_key__');
    safeLS.set('__probe__', 'value');
    const after = safeLS.get('__probe__');
    safeLS.remove('__probe__');
    return { available: safeLS.available, before, after, afterRemove: safeLS.get('__probe__') };
  });

  console.log('[safeLS]', JSON.stringify(result));
  expect(result.available).toBe(false);   // storage genuinely refused
  expect(result.before).toBeNull();       // missing key reads as null, not a throw
  expect(result.after).toBe('value');     // still usable for the session
  expect(result.afterRemove).toBeNull();
});

test('storage available: the wrapper still uses real localStorage', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await page.waitForTimeout(1500);

  const result = await page.evaluate(() => {
    safeLS.set('__probe__', 'persisted');
    const raw = window.localStorage.getItem('__probe__');   // must reach real storage
    safeLS.remove('__probe__');
    return { available: safeLS.available, raw, afterRemove: window.localStorage.getItem('__probe__') };
  });

  console.log('[safeLS-normal]', JSON.stringify(result));
  expect(result.available).toBe(true);
  expect(result.raw).toBe('persisted');
  expect(result.afterRemove).toBeNull();
});
