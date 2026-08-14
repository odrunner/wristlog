import { test, expect } from '@playwright/test';

// Email click-through tagging. SES click tracking has been off since
// 2026-07-31 (it rewrites hrefs to a redirect host, which breaks the iOS
// Universal Link on the CTA), so these utm tags are the only click measurement
// there is. Broadcasts previously carried no utm at all and every drip shared
// utm_campaign=welcome. Spec: sql/2026-08-14-email-clickthrough.sql.
const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';

const asAdmin = async (page) => {
  await page.goto('/');
  await page.evaluate((id) => { currentUser = { id }; }, ADMIN_ID);
};

test.describe('broadcast link tagging', () => {
  const build = (page, subject) => page.evaluate((s) => {
    document.getElementById('broadcast-subject').value = s;
    document.getElementById('broadcast-heading').value = '';
    document.getElementById('broadcast-body').value = 'Body [img1] more';
    // One inline image so the image anchor is exercised too.
    return buildBroadcastEmailHtml('', 'Body [img1] more',
      [{ src: 'https://example.com/a.jpg', caption: '' }], '', campaignSlug(s));
  }, subject);

  test('every link carries the campaign tag and points at /open', async ({ page }) => {
    await asAdmin(page);
    const html = await build(page, 'We rebuilt the wishlist');
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const site = hrefs.filter((h) => h.startsWith('https://wrotate.com'));
    expect(site.length).toBeGreaterThan(0);
    for (const h of site) {
      // The AASA file excludes "/" and "/index.html": a bare root link opens
      // Safari instead of the installed app. That was the logo and every image.
      expect(h).toContain('/open?');
      expect(h).toContain('utm_source=email');
      expect(h).toContain('utm_medium=broadcast');
      expect(h).toContain('utm_campaign=we-rebuilt-the-wishlist');
    }
    expect(html).not.toMatch(/href="https:\/\/wrotate\.com"/);
  });

  test('the slug is derived from the subject, so each send is its own bucket', async ({ page }) => {
    await asAdmin(page);
    const a = await build(page, 'We rebuilt the wishlist');
    const b = await build(page, 'What should we build next?');
    expect(a).toContain('utm_campaign=we-rebuilt-the-wishlist');
    expect(b).toContain('utm_campaign=what-should-we-build-next');
  });

  test('an empty subject still yields a valid tag, never a bare parameter', async ({ page }) => {
    await asAdmin(page);
    const html = await build(page, '');
    expect(html).toContain('utm_campaign=broadcast');
    expect(html).not.toContain('utm_campaign=&');
    expect(html).not.toContain('utm_campaign="');
  });
});

test.describe('click-through card', () => {
  test('renders campaigns by visits and flags the untagged-era rows', async ({ page }) => {
    await asAdmin(page);
    const html = await page.evaluate(() => renderEmailClickthrough([
      { campaign: 'we-rebuilt-the-wishlist', medium: 'broadcast', visits: 12, visits_24h: 3, known_users: 5, last_visit: new Date().toISOString() },
      { campaign: 'welcome', medium: 'campaign', visits: 6, visits_24h: 0, known_users: 1, last_visit: new Date(Date.now() - 864e5).toISOString() },
    ]));
    expect(html).toContain('we-rebuilt-the-wishlist');
    expect(html).toContain('12');
    expect(html).toContain('+3');
    // 'welcome' was shared by all five drips and the wear reminder, so it is
    // not comparable to a per-campaign figure and says so.
    expect(html).toContain('untagged era');
  });

  test('renders nothing at all when there is no click-through yet', async ({ page }) => {
    await asAdmin(page);
    const empty = await page.evaluate(() => [
      renderEmailClickthrough([]), renderEmailClickthrough(null),
    ]);
    expect(empty).toEqual(['', '']);
  });
});
