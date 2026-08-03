import { test, expect } from '@playwright/test';

const SLOT = {
  id: 'p1', kind: 'authored', eyebrow: 'New', heading: 'Rank your collection',
  body: 'Head-to-head matchups <b>sort</b> your watches.',
  image_url: 'https://x.test/hero.jpg', images: [],
  cta_label: 'Start ranking', cta_action: 'open_ranking_game',
};

async function html(page, slot) {
  await page.goto('/');
  return page.evaluate((s) => window.renderPromoCard(s), slot);
}

test.describe('renderPromoCard', () => {
  test('renders the identity block, eyebrow and heading', async ({ page }) => {
    const out = await html(page, SLOT);
    expect(out).toContain('WRotate');
    expect(out).toContain('New');
    expect(out).toContain('Rank your collection');
  });

  test('keeps allowed HTML in the body and drops the rest', async ({ page }) => {
    const out = await html(page, { ...SLOT, body: '<b>keep</b><script>alert(1)<\/script>' });
    expect(out).toContain('<b>keep</b>');
    expect(out).not.toContain('alert(1)');
  });

  test('escapes the heading rather than rendering it as HTML', async ({ page }) => {
    await page.goto('/');
    const res = await page.evaluate((s) => {
      const host = document.createElement('div');
      host.innerHTML = window.renderPromoCard(s);
      const heading = host.querySelector('.promo-heading');
      return {
        headingText: heading.textContent,
        headingChildCount: heading.children.length,
        anyOnerror: !!host.querySelector('[onerror]'),
        payloadImg: !!host.querySelector('img[src="x"]'),
      };
    }, { ...SLOT, heading: '<img src=x onerror=alert(1)>' });
    // The markup arrives as literal text, creating no elements at all.
    expect(res.headingText).toBe('<img src=x onerror=alert(1)>');
    expect(res.headingChildCount).toBe(0);
    expect(res.anyOnerror).toBe(false);
    expect(res.payloadImg).toBe(false);
  });

  test('has no like, comment or share controls — the strongest not-a-post signal', async ({ page }) => {
    const out = (await html(page, SLOT)).toLowerCase();
    for (const s of ['togglelike', 'comment-input', 'sharepost', 'feed-card-actions']) {
      expect(out, `promo card must not contain ${s}`).not.toContain(s);
    }
  });

  test('renders the hero 16:9, never the post 4:5', async ({ page }) => {
    const out = await html(page, SLOT);
    expect(out).toContain('promo-card-hero');
    const ratio = await page.evaluate(() => {
      const d = document.createElement('div');
      d.className = 'promo-card-hero';
      document.body.appendChild(d);
      return getComputedStyle(d).aspectRatio;
    });
    expect(ratio.replace(/\s/g, '')).toBe('16/9');
  });

  test('omits the button when the action key is unknown', async ({ page }) => {
    const out = await html(page, { ...SLOT, cta_action: 'not_a_real_action' });
    expect(out).not.toContain('Start ranking');
  });

  test('omits the button when there is no label', async ({ page }) => {
    const out = await html(page, { ...SLOT, cta_label: '' });
    expect(out).not.toContain('runPromoAction');
  });

  test('rejects a non-https url: action', async ({ page }) => {
    const bad = await html(page, { ...SLOT, cta_action: 'url:javascript:alert(1)' });
    expect(bad).not.toContain('Start ranking');
    const good = await html(page, { ...SLOT, cta_action: 'url:https://wrotate.com/open' });
    expect(good).toContain('Start ranking');
  });

  test('expands [img1] tokens from the images array', async ({ page }) => {
    const out = await html(page, {
      ...SLOT, body: 'before [img1] after', images: ['https://x.test/one.jpg'],
    });
    expect(out).toContain('https://x.test/one.jpg');
    expect(out).not.toContain('[img1]');
  });

  test('leaves a token with no matching image as nothing, not literal text', async ({ page }) => {
    const out = await html(page, { ...SLOT, body: 'a [img3] b', images: [] });
    expect(out).not.toContain('[img3]');
  });

  test('a crafted slot id cannot break out of the CTA click handler, and a normal id still fires its action', async ({ page }) => {
    await page.goto('/');
    // Reviewer's payload: a slot id containing a quote, closing paren and ';'
    // — with the old inline onclick="runPromoAction('${escAttr(id)}')" this
    // decoded back to a literal ' inside the JS string literal (escAttr only
    // closes the HTML-attribute context, not the nested JS context) and ran
    // arbitrary script on click. Delegation reads the id from a data
    // attribute instead, so there is no JS string literal to break out of.
    const pwned = await page.evaluate((s) => {
      window.__pwned = undefined;
      window.logPromoEvent = () => {};
      const evilId = "x');window.__pwned=true;//";
      window._promoSlots = [{ ...s, id: evilId }];
      document.body.insertAdjacentHTML('afterbegin', window.renderPromoCard(window._promoSlots[0]));
      document.querySelector('[data-promo-cta]').click();
      return window.__pwned;
    }, SLOT);
    expect(pwned).toBeUndefined();

    const openedUrl = await page.evaluate((s) => {
      window.logPromoEvent = () => {};
      let opened = null;
      window.open = (url) => { opened = url; };
      window._promoSlots = [{ ...s, id: 'a-normal-uuid', cta_action: 'url:https://wrotate.com/open' }];
      document.body.insertAdjacentHTML('afterbegin', window.renderPromoCard(window._promoSlots[0]));
      document.querySelector('[data-promo-cta]').click();
      return opened;
    }, SLOT);
    expect(openedUrl).toBe('https://wrotate.com/open');
  });

  test('omits the hero for a non-https image_url', async ({ page }) => {
    const http = await html(page, { ...SLOT, image_url: 'http://evil.test/t.gif?u=1' });
    expect(http).not.toContain('promo-card-hero');
    expect(http).not.toContain('evil.test');

    const js = await html(page, { ...SLOT, image_url: 'javascript:alert(1)' });
    expect(js).not.toContain('promo-card-hero');
    expect(js).not.toContain('javascript:alert(1)');
  });

  test('rejects Object.prototype-shaped cta_action keys without throwing', async ({ page }) => {
    await page.goto('/');
    const direct = await page.evaluate(() => ({
      proto: window.promoActionFor('__proto__'),
      ctor: window.promoActionFor('constructor'),
      hasOwn: window.promoActionFor('hasOwnProperty'),
    }));
    expect(direct.proto).toBeNull();
    expect(direct.ctor).toBeNull();
    expect(direct.hasOwn).toBeNull();

    const protoOut = await html(page, { ...SLOT, cta_action: '__proto__' });
    expect(protoOut).not.toContain('Start ranking');
    expect(protoOut).not.toContain('data-promo-cta');

    const ctorOut = await html(page, { ...SLOT, cta_action: 'constructor' });
    expect(ctorOut).not.toContain('Start ranking');
    expect(ctorOut).not.toContain('data-promo-cta');

    // Rendering (and, if it had rendered, clicking) must never throw.
    const noThrow = await page.evaluate((s) => {
      window.logPromoEvent = () => {};
      window._promoSlots = [{ ...s, id: 'y1', cta_action: '__proto__' }];
      const markup = window.renderPromoCard(window._promoSlots[0]);
      document.body.insertAdjacentHTML('afterbegin', markup);
      // No CTA button was rendered, so runPromoAction is only reachable via
      // the delegated handler if one somehow existed — confirm it doesn't.
      return !document.querySelector('[data-promo-cta]');
    }, SLOT);
    expect(noThrow).toBe(true);
  });
});
