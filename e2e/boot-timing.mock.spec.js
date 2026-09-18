import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  FAKE_USER, SAMPLE_WATCHES,
} from './helpers.js';

// boot_timing is how first-load work gets measured on real devices. This drives
// the real boot through the app and asserts the one event per page load lands
// with the marks in the order they must happen: script → session → first live
// render → enriched render; a second visit additionally reports the cached paint.

const OTHER = '00000000-0000-4000-8000-0000000000ff';
const POSTS = [1, 2, 3].map(i => ({
  id: `p-${i}`, user_id: OTHER, watch_id: 'watch-001',
  date: `2026-08-0${8 - i}`, created_at: `2026-08-0${8 - i}T10:00:00Z`,
  use_case: 'work', notes: `Post ${i}`, strap_id: null, photo_url: null, visibility: 'public', club_id: null,
}));

// Stand in for the PostHog snippet: __SV makes the real loader skip itself, and
// every capture() is kept for the test to read back.
const spyPostHog = page => page.addInitScript(() => {
  window.__ph = [];
  window.posthog = { __SV: 1, init() {}, identify() {}, capture(name, props) { window.__ph.push({ name, props }); } };
});

const bootEvents = page => page.evaluate(() => window.__ph.filter(e => e.name === 'boot_timing'));

async function visit(page) {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
}

test('one boot_timing event per load, marks in boot order', async ({ page }) => {
  await injectSession(page);
  await spyPostHog(page);
  await visit(page);

  await expect.poll(() => bootEvents(page).then(e => e.length)).toBe(1);
  const [{ props }] = await bootEvents(page);
  expect(props.script_ms).toBeGreaterThan(0);
  expect(props.session_ms).toBeGreaterThanOrEqual(props.script_ms);
  expect(props.first_live_ms).toBeGreaterThanOrEqual(props.session_ms);
  expect(props.enriched_ms).toBeGreaterThanOrEqual(props.first_live_ms);
  expect(props.cached_paint_ms).toBeNull();
  expect(props.cached_feed).toBe(false);
  expect(props.feed_error).toBe(false);
  expect(props.nav_type).toBe('navigate');
  expect(props.shell_from).toBe('network');

  // The Phase-2 render fires it; nothing later may send a second copy.
  await page.waitForTimeout(500);
  expect((await bootEvents(page)).length).toBe(1);
});

test('a returning user reports the cached paint', async ({ page }) => {
  await injectSession(page);
  await spyPostHog(page);
  await visit(page);
  await expect.poll(() => page.evaluate(id => localStorage.getItem('wrotate_feed_cache_' + id), FAKE_USER.id)).not.toBe(null);

  await visit(page);
  await expect.poll(() => bootEvents(page).then(e => e.length)).toBe(1);
  const [{ props }] = await bootEvents(page);
  expect(props.cached_feed).toBe(true);
  expect(props.cached_paint_ms).toBeGreaterThan(0);
  expect(props.first_live_ms).toBeGreaterThanOrEqual(props.cached_paint_ms);
});
