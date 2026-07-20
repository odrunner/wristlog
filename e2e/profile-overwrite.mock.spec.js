import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, FAKE_USER } from './helpers.js';

// Incident 2026-07-15: a user's profile was silently overwritten with signup
// defaults. loadMyProfile treated ANY empty select result — including a transient
// failure like an expiring JWT — as "new OAuth user" and upserted over the real
// row. One statement rewrote username, display_name AND all four visibility
// fields, so a private profile/collection/wishlist silently became public and
// stayed that way for ~5 days.
//
// These tests drive the exact failure condition rather than asserting on source
// text: the profile select fails, and nothing may be written.

const PRIVATE_PROFILE = {
  id: FAKE_USER.id,
  username: 'od',
  display_name: 'OD',
  profile_privacy: 'followers',
  collection_visibility: 'followers',
  wishlist_visibility: 'friends',
  default_post_visibility: 'followers',
  theme_preference: 'os',
};

// Record every write attempt against profiles, and fail the profile GET the way
// a transient auth/network error does.
async function trackWrites(page, { failProfileGet }) {
  const writes = [];
  await page.route('**/rest/v1/profiles*', (route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'GET') {
      if (failProfileGet) {
        // PGRST301 = JWT expired. NOT PGRST116 ("0 rows"), so this must never be
        // read as "profile missing".
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }),
        });
      }
      const accept = req.headers()['accept'] || '';
      const body = accept.includes('vnd.pgrst.object') ? PRIVATE_PROFILE : [PRIVATE_PROFILE];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    let payload = null;
    try { payload = JSON.parse(req.postData() || 'null'); } catch { /* ignore */ }
    writes.push({ method, url: req.url(), payload });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PRIVATE_PROFILE) });
  });
  return writes;
}

const VIS_FIELDS = [
  'profile_privacy',
  'collection_visibility',
  'wishlist_visibility',
  'default_post_visibility',
];

function publicVisibilityWrites(writes) {
  return writes.filter((w) => {
    const rows = Array.isArray(w.payload) ? w.payload : [w.payload];
    return rows.some((r) => r && VIS_FIELDS.some((f) => r[f] === 'public'));
  });
}

test.describe('profile overwrite regression (mocked)', () => {
  test('a failing profile read never writes visibility settings', async ({ page }) => {
    await mockSupabase(page, {});
    const writes = await trackWrites(page, { failProfileGet: true });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await page.waitForTimeout(600);

    // The whole incident: a read failure turning into a write.
    expect(publicVisibilityWrites(writes)).toEqual([]);
  });

  test('a failing profile read does not create a profile at all', async ({ page }) => {
    await mockSupabase(page, {});
    const writes = await trackWrites(page, { failProfileGet: true });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await page.waitForTimeout(600);

    const creates = writes.filter((w) => w.method === 'POST' || w.method === 'PUT');
    expect(creates).toEqual([]);
  });

  test('a successful load leaves the existing private settings untouched', async ({ page }) => {
    await mockSupabase(page, {});
    const writes = await trackWrites(page, { failProfileGet: false });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await page.waitForTimeout(600);

    expect(publicVisibilityWrites(writes)).toEqual([]);
    // myProfile is a top-level `let`, so it is reachable by name but NOT as a
    // property of window.
    const vis = await page.evaluate(() => ({
      profile: myProfile?.profile_privacy,
      collection: myProfile?.collection_visibility,
      wishlist: myProfile?.wishlist_visibility,
      post: myProfile?.default_post_visibility,
    }));
    expect(vis).toEqual({
      profile: 'followers', collection: 'followers',
      wishlist: 'friends', post: 'followers',
    });
  });

});
