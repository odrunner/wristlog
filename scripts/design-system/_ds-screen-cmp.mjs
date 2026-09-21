// Before/after of one screen: same mocked data, old (git HEAD) vs working tree.
// usage: node e2e/_ds-screen-cmp.mjs <oldDir> <outDir> <page> <itemSelector>
import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES, SAMPLE_LOGS, FAKE_USER } from './helpers.js';
const [OLD, OUT, PAGE, SEL] = process.argv.slice(2);
const OTHER = '00000000-0000-4000-8000-0000000000ff';
const log = (id, day, notes, user = OTHER) => ({ id, user_id: user, watch_id: 'watch-001', date: `2026-08-${String(day).padStart(2, '0')}`, created_at: `2026-08-${String(day).padStart(2, '0')}T10:00:00Z`, use_case: 'work', notes, strap_id: null, photo_url: null, visibility: 'public', club_id: null });
const LOGS = [log('a', 9, 'Short one.'), log('b', 8, 'A longer caption that wraps. '.repeat(6)), log('c', 7, 'Mine.', FAKE_USER.id), log('d', 6, 'Dinner.', FAKE_USER.id)];
const WL = [
  { id: 'wl1', brand: 'Rolex', name: 'Cosmograph Daytona', ref: '126519LN', price: 42700, url: 'https://www.rolex.com/en-us/watches/daytona', added_date: '2026-03-18', wish_privacy: 'public', sort_order: 0 },
  { id: 'wl2', brand: 'A. Lange & Söhne', name: 'Datograph', wish_privacy: 'public', sort_order: 1 },
  { id: 'wl3', brand: 'Rolex', name: 'GMT-Master II', ref: '126710BLRO', price: 10900, notes: 'Pepsi, jubilee. Waiting list.', added_date: '2026-05-02', wish_privacy: 'friends', sort_order: 2 },
];
const b = await chromium.launch(); const res = {};
for (const side of ['old', 'new']) for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, baseURL: 'http://localhost:3000' });
  const page = await ctx.newPage();
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: (PAGE === 'stats' || PAGE === 'profile') ? SAMPLE_LOGS : LOGS, wishlist: WL });
  if (side === 'old') {
    await page.route(/localhost:3000\/(\?.*)?$/, r => r.fulfill({ body: readFileSync(OLD + '/index.html'), contentType: 'text/html' }));
    await page.route('**/design-system.css*', r => r.fulfill({ body: readFileSync(OLD + '/design-system.css'), contentType: 'text/css' }));
  }
  await injectSession(page);
  await page.goto('/'); await waitForAppBoot(page); if (PAGE === 'profile') { await page.evaluate(() => { if (typeof viewMyProfile === 'function') viewMyProfile(); else viewUserProfile(currentUser.id); }); await page.waitForSelector('#page-profile', { state: 'visible' }); await page.waitForTimeout(1200); } else await navigateTo(page, PAGE);
  await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForSelector(SEL); await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${PAGE}-${side}-${theme}.png`, fullPage: true });
  res[side + theme] = await page.evaluate(sel => { const els = [...document.querySelectorAll(sel)]; return { items: els.map(c => { const r = c.getBoundingClientRect(); return { top: +(r.top + scrollY).toFixed(2), h: +r.height.toFixed(2), w: +r.width.toFixed(2) }; }), pageH: document.documentElement.scrollHeight, overflowX: document.documentElement.scrollWidth > innerWidth }; }, SEL);
  await ctx.close();
}
for (const theme of ['light', 'dark']) { const o = res['old' + theme], n = res['new' + theme]; console.log(theme, 'page height', o.pageH, '->', n.pageH, ' horizontal overflow:', o.overflowX, '->', n.overflowX, ' items:', o.items.length, '->', n.items.length);
  o.items.slice(0, 6).forEach((a, i) => { const c = n.items[i]; console.log(`  #${i}: h ${a.h} -> ${c.h} (${(c.h - a.h).toFixed(2)})  w ${a.w} -> ${c.w}  top ${a.top} -> ${c.top}`); }); }
await b.close();
