import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES, FAKE_PROFILE } from './helpers.js';

// Languages (docs/i18n.md). English is the default and must stay byte-identical in
// behaviour: no language file requested, no text changed. ?lang=es stores the choice,
// loads the Spanish dictionary before boot and translates the static markup + toasts.

const SHOTS = process.env.I18N_SHOTS; // folder: save a screenshot per page for review

async function boot(page, url) {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [] });
  await page.goto(url);
  await waitForAppBoot(page);
}

test('English: no language file is requested and labels are unchanged', async ({ page }) => {
  const asked = [];
  page.on('request', (r) => { if (r.url().includes('/i18n/')) asked.push(r.url()); });
  await boot(page, '/');
  await navigateTo(page, 'collection');
  expect(asked).toEqual([]);
  expect(await page.evaluate(() => window.WR_I18N)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  expect(await page.evaluate(() => document.getElementById('fact-modal-title').textContent)).toBe('Did you know?');
});

test('Spanish: static markup, placeholders and toasts are translated; sign-in screen is not', async ({ page }) => {
  await boot(page, '/?lang=es');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('es');
  expect(await page.evaluate(() => safeLS.get('wr_lang'))).toBe('es');
  const dict = await page.evaluate(() => window.WR_I18N.dict);
  expect(await page.evaluate(() => document.getElementById('fact-modal-title').textContent)).toBe(dict['Did you know?']);
  // The sign-in screen is deliberately left alone.
  const authText = await page.evaluate(() => document.getElementById('auth-screen').textContent);
  for (const es of ['Iniciar sesión', 'Colección', 'Cronocomparador']) expect(authText).not.toContain(es);
  // A toast translates its own message.
  await page.evaluate(() => toast('Copied!'));
  await expect(page.locator('#toast')).toHaveText(dict['Copied!'] || 'Copied!');
  // The choice survives a reload without the query string.
  await page.goto('/');
  await waitForAppBoot(page);
  expect(await page.evaluate(() => window.WR_I18N && window.WR_I18N.lang)).toBe('es');
  if (SHOTS) {
    test.setTimeout(120_000);
    for (const p of (process.env.I18N_PAGES || 'feed,collection,track').split(',')) {
      await page.evaluate((x) => { const b = document.querySelector(`nav button[data-page="${x}"]`); if (b) nav(b); else { document.querySelectorAll(".page").forEach((e) => e.classList.remove("active")); document.getElementById("page-" + x).classList.add("active"); } }, p);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/es-${p}.png` });
    }
  }
});

test('Profile -> Language switches the app and back, English stays the default', async ({ page }) => {
  await boot(page, '/');
  await page.evaluate(() => openProfileModal());
  const chips = page.locator('#pp-lang-chips .chip');
  await expect(chips).toHaveText(['English', 'Español', 'Italiano', 'Français', 'Türkçe', 'Deutsch', 'Português']);
  await expect(page.locator('#pp-lang-chips .chip.selected')).toHaveText('English');
  await Promise.all([page.waitForEvent('load'), chips.nth(2).click()]);
  await waitForAppBoot(page);
  expect(await page.evaluate(() => window.WR_I18N.lang)).toBe('it');
  // Drawn by script after boot, so this is the live translator at work.
  await page.evaluate(() => openProfileModal());
  await expect(page.locator('#pp-lang-chips .chip.selected')).toHaveText('Italiano');
  const dict = await page.evaluate(() => window.WR_I18N.dict);
  await expect(page.locator('label', { hasText: dict['Language'] }).first()).toBeVisible();
  await Promise.all([page.waitForEvent('load'), chips.nth(0).click()]);
  await waitForAppBoot(page);
  expect(await page.evaluate(() => window.WR_I18N)).toBeUndefined();
});

test('Spanish: labels the script draws later are translated, user text is not', async ({ page }) => {
  await boot(page, '/?lang=es');
  const dict = await page.evaluate(() => window.WR_I18N.dict);
  await page.evaluate(() => {
    const d = document.createElement('div'); d.id = 'i18n-probe';
    d.innerHTML = '<span class="a">Newest</span><span class="b">3h ago</span><span class="c">2h ago · work</span><span class="d">My grail Speedmaster</span><input class="e" placeholder="Search">';
    document.body.appendChild(d);
  });
  await expect(page.locator('#i18n-probe .a')).toHaveText(dict['Newest']);
  await expect(page.locator('#i18n-probe .b')).toHaveText(dict['{0}h ago'].replace('{0}', '3'));
  await expect(page.locator('#i18n-probe .c')).toHaveText(dict['{0}h ago'].replace('{0}', '2') + ' · ' + dict['work']);
  await expect(page.locator('#i18n-probe .d')).toHaveText('My grail Speedmaster');
  // Sentences built around a watch name or a weekday, and several sentences in one line.
  await page.evaluate(() => document.getElementById('i18n-probe').insertAdjacentHTML('beforeend',
    '<span class="g">Submariner Date has never been logged — today could be its first wear. One of your top-ranked watches.</span><span class="h">Worn once on Friday</span><span class="i">3 watches</span>'));
  const s1 = dict['{0} has never been logged — today could be its first wear.'].replace('{0}', 'Submariner Date');
  await expect(page.locator('#i18n-probe .g')).toHaveText(s1 + ' ' + dict['One of your top-ranked watches'] + '.');
  // Spanish writes a weekday in lower case inside a sentence.
  await expect(page.locator('#i18n-probe .h')).toHaveText(dict['Worn once on {0}'].replace('{0}', dict['Friday'].toLowerCase()));
  await expect(page.locator('#i18n-probe .i')).toHaveText(dict['{0} watches'].replace('{0}', '3'));
  // A translation that spells another English label is not translated twice.
  await page.evaluate(() => { window.WR_I18N.dict['Chain A'] = 'Newest'; document.getElementById('i18n-probe').insertAdjacentHTML('beforeend', '<span class="f">Chain A</span>'); });
  await page.waitForTimeout(200);
  await expect(page.locator('#i18n-probe .f')).toHaveText('Newest');
  await expect(page.locator('#i18n-probe .e')).toHaveAttribute('placeholder', dict['Search']);
});

// A language chosen on another device is on the profile; a device with no choice of
// its own adopts it. A device that has chosen keeps its choice.
test.describe('language follows the account', () => {
  const bootWith = async (page, language) => {
    await injectSession(page);
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [], profile: { ...FAKE_PROFILE, language } });
    await page.goto('/');
  };
  test('a fresh device loads the profile language', async ({ page }) => {
    await bootWith(page, 'it');
    await page.waitForFunction(() => window.WR_I18N && window.WR_I18N.lang === 'it');
    await waitForAppBoot(page);
    expect(await page.evaluate(() => safeLS.get('wr_lang'))).toBe('it');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('it');
  });
  test('English on the profile is remembered without loading anything', async ({ page }) => {
    const asked = [];
    page.on('request', (r) => { if (r.url().includes('/i18n/')) asked.push(r.url()); });
    await bootWith(page, 'en');
    await waitForAppBoot(page);
    await page.waitForFunction(() => safeLS.get('wr_lang') === 'en');
    expect(asked).toEqual([]);
    expect(await page.evaluate(() => window.WR_I18N)).toBeUndefined();
  });
  test('a device that already chose keeps its own choice', async ({ page }) => {
    await injectSession(page);
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [], profile: { ...FAKE_PROFILE, language: 'it' } });
    await page.goto('/?lang=es');
    await waitForAppBoot(page);
    expect(await page.evaluate(() => window.WR_I18N.lang)).toBe('es');
  });
  test('no language on the profile changes nothing', async ({ page }) => {
    await bootWith(page, null);
    await waitForAppBoot(page);
    expect(await page.evaluate(() => window.WR_I18N)).toBeUndefined();
    expect(await page.evaluate(() => safeLS.get('wr_lang'))).toBeNull();
  });
});

test('Language picker: real buttons, the chosen one marked, operable from the keyboard', async ({ page }) => {
  await boot(page, '/');
  await page.evaluate(() => openProfileModal());
  const chips = page.locator('#pp-lang-chips .chip');
  await expect(chips).toHaveCount(7);
  expect(await chips.evaluateAll((els) => els.every((e) => e.tagName === 'BUTTON' && e.type === 'button'))).toBe(true);
  await expect(page.locator('#pp-lang-chips .chip[aria-pressed="true"]')).toHaveText('English');
  await expect(page.locator('#pp-lang-chips .chip[aria-pressed="false"]')).toHaveCount(6);
  await page.locator('#pp-lang-chips .chip', { hasText: 'Deutsch' }).focus();
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
  await waitForAppBoot(page);
  expect(await page.evaluate(() => window.WR_I18N.lang)).toBe('de');
});

test('A browser that refuses to store the language does not reload (no boot loop)', async ({ page }) => {
  await boot(page, '/');
  let loads = 0; page.on('load', () => loads++);
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'wr_lang') throw new Error('QuotaExceededError'); return real.call(this, k, v); };
    setLanguage('it');
  });
  await expect(page.locator('#toast')).toContainText('Could not save the language on this device');
  await page.waitForTimeout(300);
  expect(loads).toBe(0);
  expect(await page.evaluate(() => window.WR_I18N)).toBeUndefined();
});

// The one-time offer: device language, never country. Shown only until a choice exists.
test.describe('language offer banner', () => {
  test('an English device never sees it', async ({ page }) => {
    await boot(page, '/');
    await expect(page.locator('#lang-banner')).toBeHidden();
    expect(await page.evaluate(() => [langOffer(null, 'en-US'), langOffer(null, 'ja-JP'), langOffer(null, ''), langOffer('en', 'it-IT'), langOffer(null, 'IT'), langOffer(null, 'tr-TR')]))
      .toEqual([null, null, null, null, 'it', 'tr']);
  });

  test.describe('on an Italian device', () => {
    test.use({ locale: 'it-IT' });
    test('offers Italian in Italian, stays English until accepted, then switches', async ({ page }) => {
      await boot(page, '/');
      expect(await page.evaluate(() => window.WR_I18N)).toBeUndefined();
      await expect(page.locator('#lang-banner-title')).toHaveText('WRotate è disponibile in italiano');
      await Promise.all([page.waitForEvent('load'), page.locator('#lang-banner-go').click()]);
      await waitForAppBoot(page);
      expect(await page.evaluate(() => window.WR_I18N.lang)).toBe('it');
      await expect(page.locator('#lang-banner')).toBeHidden();
    });
    test('dismissing keeps English and never asks again', async ({ page }) => {
      await boot(page, '/');
      await page.locator('#lang-banner .reminder-banner-close').click();
      await expect(page.locator('#lang-banner')).toBeHidden();
      // Dismissing is permanent, so it says (in Italian) where the setting lives.
      await expect(page.locator('#toast')).toContainText('Puoi cambiare lingua quando vuoi in Profile → Language.');
      await page.goto('/');
      await waitForAppBoot(page);
      await expect(page.locator('#lang-banner')).toBeHidden();
      expect(await page.evaluate(() => window.WR_I18N)).toBeUndefined();
    });
  });
});

test('Text a member wrote is never translated, even when it spells a label', async ({ page }) => {
  await injectSession(page);
  const mine = { ...SAMPLE_WATCHES[0], id: 'w-mine', brand: 'Steel', name: 'Leather' };
  await mockSupabase(page, { watches: [mine, ...SAMPLE_WATCHES.slice(1)], logs: [] });
  await page.goto('/?lang=fr');
  await waitForAppBoot(page);
  await navigateTo(page, 'collection');
  const dict = await page.evaluate(() => window.WR_I18N.dict);
  expect(dict['Steel']).toBeTruthy();
  expect(dict['Leather']).toBeTruthy();
  expect(dict['Steel']).not.toBe('Steel');
  const text = await page.evaluate(() => document.getElementById('page-collection').innerText);
  expect(text).toContain('Steel');
  expect(text).toContain('Leather');
  expect(text).not.toContain(dict['Steel']);
  expect(text).not.toContain(dict['Leather']);
  // The same word as one of our own labels is still translated, and a name inside a
  // sentence or beside a label is left as written.
  const out = await page.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = '<p id="t-label">Steel</p><p id="t-mine">' + escUser('Steel') + '</p>'
      + '<p id="t-mixed">' + escUser('Steel') + ' · 3 wears</p>';
    document.body.appendChild(d);
    return new Promise((r) => setTimeout(() => r({
      label: d.querySelector('#t-label').textContent, mine: d.querySelector('#t-mine').textContent,
      mixed: d.querySelector('#t-mixed').textContent, wears: i18nLookup('3 wears'),
    }), 50));
  });
  expect(out.label).toBe(dict['Steel']);
  expect(out.mine).toBe('Steel');
  expect(out.mixed).toBe('Steel · ' + out.wears);
});

// The phone tab bar is an even grid: a label wider than its share pushes the
// other tabs narrower and moves every thumb target (usability 2026-11-15).
// Six tabs, as in the apps (the fake bridge shows Measure).
test.describe('tab bar stays an even grid at 390px', () => {
  for (const lang of ['es', 'it', 'fr', 'tr', 'de', 'pt']) {
    test(lang, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.addInitScript(() => {
        window.webkit = { messageHandlers: { timegrapher: { postMessage: () => {} }, appAction: { postMessage: () => {} } } };
      });
      await boot(page, '/?lang=' + lang);
      await page.waitForFunction((l) => window.WR_I18N && window.WR_I18N.lang === l, lang);
      const m = await page.evaluate(() => ({
        widths: [...document.querySelectorAll('nav button[data-page]')].filter((b) => b.offsetParent).map((b) => Math.round(b.getBoundingClientRect().width)),
        labels: [...document.querySelectorAll('nav button[data-page] .nav-label')].filter((b) => b.offsetParent).map((b) => b.textContent),
        scroll: document.documentElement.scrollWidth, view: window.innerWidth,
      }));
      console.log(lang, JSON.stringify(m));
      expect(m.widths.length).toBe(6);
      expect(Math.max(...m.widths) - Math.min(...m.widths), `${lang}: ${m.labels.join(' | ')} → ${m.widths.join(',')}`).toBeLessThanOrEqual(1);
      expect(m.scroll).toBeLessThanOrEqual(m.view);
    });
  }
});
