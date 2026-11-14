import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

// The pages a member passes through outside the app (docs/i18n.md): a shared post (/p/),
// a public profile (/profile/) and the stub every email button lands on (/open). They follow
// the language chosen in the app (wr_lang, same origin). English loads nothing extra;
// another language loads its dictionary plus the generated runtime /i18n/page.js.
// The member's own text is never translated, even when it spells one of our labels.

const de = JSON.parse(readFileSync(new URL('../i18n/de.json', import.meta.url), 'utf8'));
const API = 'https://api.wrotate.com';
const PROFILE = { id: 'u1', username: 'steel', display_name: 'Steel', bio: 'Leather', avatar_url: null, profile_privacy: 'public', collection_visibility: 'public', is_official: true };
const WATCHES = [
  { id: 'w1', brand: 'Steel', name: 'Leather', image: null, watch_privacy: 'public' },
  { id: 'w2', brand: null, name: 'Date', image: null, watch_privacy: 'public' },
];
const LOG = { id: 'l1', user_id: 'u1', watch_id: 'w2', photo_url: '/icon.svg', notes: 'Leather', use_case: 'casual', date: '2026-03-05', visibility: 'public' };

// No network: the database is mocked, the CDN copy of supabase-js is swapped for the vendored
// file (the page pins the CDN one by hash), and every other outside address is refused.
async function mock(page, { profile = PROFILE, watches = WATCHES, log = LOG } = {}) {
  const asked = [];
  page.on('request', (r) => { if (r.url().includes('/i18n/')) asked.push(new URL(r.url()).pathname); });
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  // /open sends the visitor on to the app at once; without that one script the test can read the stub.
  await page.route(/localhost:3000\/open(\?|$)/, async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/<script>\s*var isIOS[\s\S]*?<\/script>/, '');
    expect(body).not.toContain('isIOS');
    route.fulfill({ response: res, body });
  });
  await page.route(`${API}/**`, (route) => {
    const table = new URL(route.request().url()).pathname.split('/').pop();
    const post = page.url().includes('/p/'); // /p/ asks for one row of each; /profile/ for lists
    const wears = [{ watch_id: 'w1', date: '2026-03-01' }, { watch_id: 'w1', date: '2026-03-02' }, { watch_id: 'w1', date: '2026-03-03' }, { watch_id: 'w2', date: '2026-03-01' }];
    const rows = { profiles: profile ? [profile] : [], watches: post ? watches.slice(1) : watches, logs: post ? (log ? [log] : []) : wears }[table] || [];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await page.route(/localhost:3000\/(p|profile)\/(\?|$)/, async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, '<script src="/supabase-js-2.98.0.min.js"></script>');
    expect(body).toContain('src="/supabase-js-2.98.0.min.js"');
    route.fulfill({ response: res, body });
  });
  return asked;
}

test.describe('English visitor: nothing extra is loaded, nothing changes', () => {
  test('/p/', async ({ page }) => {
    const asked = await mock(page);
    await page.goto('/p/?id=l1');
    await expect(page.locator('.post-name')).toHaveText('Steel');
    expect(asked).toEqual([]);
    expect(await page.evaluate(() => [window.WR_I18N, typeof window.i18nWalk, document.documentElement.lang])).toEqual([undefined, 'undefined', 'en']);
    await expect(page.locator('.post-meta')).toHaveText('Mar 5, 2026 · Casual');
    await expect(page.locator('.post-caption')).toHaveText('Leather');
    // No marker comments either: the markup is what it was before the page knew about languages.
    expect(await page.locator('.post-caption').innerHTML()).toBe('Leather');
    await expect(page.locator('.post-photo')).toHaveAttribute('alt', 'Date');
  });
  test('/profile/', async ({ page }) => {
    const asked = await mock(page);
    await page.goto('/profile/?u=steel');
    await expect(page.locator('.display-name')).toHaveText('SteelOfficial');
    expect(asked).toEqual([]);
    expect(await page.evaluate(() => [window.WR_I18N, document.documentElement.lang])).toEqual([undefined, 'en']);
    await expect(page.locator('.stat-lbl')).toHaveText(['Watches', 'Total Wears', 'Most Worn']);
    await expect(page.locator('.watch-card-wears')).toHaveText(['3 wears', '1 wear']);
    expect(await page.locator('.bio-text').innerHTML()).toBe('Leather');
  });
  test('/open', async ({ page }) => {
    const asked = await mock(page);
    await page.goto('/open');
    expect(asked).toEqual([]);
    await expect(page.locator('p')).toHaveText('Redirecting to WRotate...');
    await expect(page.locator('a')).toHaveText('Open WRotate');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  });
});

test.describe('German visitor: labels are translated, the member\'s own words are not', () => {
  test('/p/ with ?lang=de', async ({ page }) => {
    for (const k of ['Steel', 'Leather', 'Date', 'Casual']) expect(de[k], k).not.toBe(k);
    const asked = await mock(page);
    await page.goto('/p/?id=l1&lang=de');
    await expect(page.locator('.post-name')).toHaveText('Steel');
    expect(asked.sort()).toEqual(['/i18n/de.js', '/i18n/page.js']);
    expect(await page.evaluate(() => [document.documentElement.lang, localStorage.getItem('wr_lang')])).toEqual(['de', 'de']);
    // Ours: the occasion label, the date's month, the store badges.
    const date = new Date('2026-03-05T12:00:00').toLocaleDateString('de', { month: 'short', day: 'numeric', year: 'numeric' });
    await expect(page.locator('.post-meta')).toHaveText(`${date} · ${de['Casual']}`);
    await expect(page.locator('.cta-wrap img').first()).toHaveAttribute('alt', de['Download on the App Store']);
    // Theirs: a name, a caption and a watch that each spell a label, in text and in an attribute.
    await expect(page.locator('.post-caption')).toHaveText('Leather');
    await expect(page.locator('.post-watch')).toHaveText('Date');
    await expect(page.locator('.post-photo')).toHaveAttribute('alt', 'Date');
    // The same words as labels of ours are still translated on this page.
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p id="probe">Leather</p>'));
    await expect(page.locator('#probe')).toHaveText(de['Leather']);
    expect(await page.title()).toBe(de["{0}'s {1} — WRotate"].replace('{0}', 'Steel').replace('{1}', 'Date'));
  });
  test('/p/ signed out, post not public: the sign-in prompt is translated', async ({ page }) => {
    await mock(page, { log: null });
    await page.addInitScript(() => localStorage.setItem('wr_lang', 'de'));
    await page.goto('/p/?id=l1');
    await expect(page.locator('.state-title')).toHaveText(de['Sign in to view this post']);
    await expect(page.locator('#signin-btn')).toHaveText(de['Sign in to view']);
  });
  test('/profile/ with a stored choice', async ({ page }) => {
    const asked = await mock(page);
    await page.addInitScript(() => localStorage.setItem('wr_lang', 'de'));
    await page.goto('/profile/?u=steel');
    await expect(page.locator('.stat-lbl')).toHaveText([de['Watches'], de['Total Wears'], de['Most Worn']]);
    expect(asked.sort()).toEqual(['/i18n/de.js', '/i18n/page.js']);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');
    await expect(page.locator('.topbar .btn-open-app')).toHaveText(de['Open App']);
    await expect(page.locator('.official-badge')).toHaveText(de['Official']);
    await expect(page.locator('.section-title')).toHaveText(de['Collection ({0})'].replace('{0}', '2'));
    await expect(page.locator('.watch-card-wears')).toHaveText([de['{0} wears'].replace('{0}', '3'), de['{0} wear'].replace('{0}', '1')]);
    await expect(page.locator('.cta-banner .btn-cta')).toHaveText(de['Join for Free']);
    // Theirs.
    await expect(page.locator('.display-name')).toHaveText('Steel' + de['Official']);
    await expect(page.locator('.username-lbl')).toHaveText('@steel');
    await expect(page.locator('.bio-text')).toHaveText('Leather');
    await expect(page.locator('.watch-card-brand')).toHaveText(['Steel']);
    await expect(page.locator('.watch-card-name')).toHaveText(['Leather', 'Date']);
    await expect(page.locator('.stat-val').nth(2)).toHaveText('Steel Leather');
    await expect(page.locator('.stat-val').nth(2)).toHaveAttribute('title', 'Steel Leather');
  });
  test('/profile/ private: the sentence is translated around the member\'s name', async ({ page }) => {
    await mock(page, { profile: { ...PROFILE, display_name: 'Leather', profile_privacy: 'private', is_official: false } });
    await page.goto('/profile/?u=steel&lang=de');
    await expect(page.locator('.state-title')).toHaveText(de['Private profile']);
    await expect(page.locator('.state-sub')).toHaveText(de['This collection is private. Follow {0} on WRotate to see their watches.'].replace('{0}', 'Leather'));
    await expect(page.locator('.display-name')).toHaveText('Leather');
  });
  test('/profile/ unknown member: the message keeps the name that was asked for', async ({ page }) => {
    await mock(page, { profile: null });
    await page.goto('/profile/?u=Leather&lang=de');
    await expect(page.locator('.state-title')).toHaveText(de['Profile not found']);
    await expect(page.locator('.state-sub')).toHaveText(de['No user found with username "{0}".'].replace('{0}', 'Leather'));
  });
  test('/open', async ({ page }) => {
    const asked = await mock(page);
    await page.addInitScript(() => localStorage.setItem('wr_lang', 'de'));
    await page.goto('/open');
    await expect(page.locator('a')).toHaveText(de['Open WRotate']);
    await expect(page.locator('p')).toHaveText(de['Redirecting to WRotate...']);
    expect(asked.sort()).toEqual(['/i18n/de.js', '/i18n/page.js']);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');
  });
});
