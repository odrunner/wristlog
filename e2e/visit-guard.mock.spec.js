import { test, expect } from '@playwright/test';

// The mocked suite serves the real index.html with the production Supabase URL
// and anon key baked in, so trackVisit() used to write a live page_visits row on
// every page.goto('/') in a spec that didn't intercept the route — ~400 rows per
// suite run, 96% of the last week's table. trackVisit() now bails on
// navigator.webdriver. This spec deliberately does NOT mock the route: it
// asserts the request is never made in the first place.
test.describe('visit tracking under automation', () => {
  test('no page_visits row is written from an automated browser', async ({ page }) => {
    const writes = [];
    await page.route('**/rest/v1/page_visits*', (route) => {
      writes.push(route.request().method());
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[{}]' });
    });
    await page.goto('/');
    // trackVisit runs inline at parse time; give any async insert a chance too.
    await page.waitForTimeout(500);
    expect(writes).toEqual([]);
  });

  test('the guard is what stops it, not a missing utm or a dedup key', async ({ page }) => {
    // A tagged URL with a cleared dedup key is the case that would definitely
    // have inserted before, so it pins the guard rather than a side effect.
    await page.route('**/rest/v1/page_visits*', (route) =>
      route.fulfill({ status: 201, contentType: 'application/json', body: '[{}]' }));
    await page.goto('/?utm_source=email&utm_medium=broadcast&utm_campaign=guard-test');
    const state = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('wristlog_visit_'));
      return { webdriver: navigator.webdriver, keys };
    });
    expect(state.webdriver).toBe(true);
    // The dedup key is only written on the path that also inserts, so an empty
    // list proves trackVisit returned before doing any work.
    expect(state.keys).toEqual([]);
  });
});
