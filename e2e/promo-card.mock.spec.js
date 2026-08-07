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
    await page.goto('/');
    const res = await page.evaluate((s) => {
      const withoutLabel = document.createElement('div');
      withoutLabel.innerHTML = window.renderPromoCard({ ...s, cta_label: '' });
      const withLabel = document.createElement('div');
      withLabel.innerHTML = window.renderPromoCard(s);
      return {
        withoutLabel: !!withoutLabel.querySelector('[data-promo-cta]'),
        withLabel: !!withLabel.querySelector('[data-promo-cta]'),
      };
    }, SLOT);
    expect(res.withoutLabel).toBe(false);
    // Positive half: the same render WITH a label must produce the button —
    // otherwise this test can't tell a correct renderer from one that never
    // emits a CTA at all.
    expect(res.withLabel).toBe(true);
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
      // _promoSlots is a top-level `let` in index.html, not a window property
      // (added in Task 7) — set it as a bare identifier so runPromoAction sees it.
      _promoSlots = [{ ...s, id: evilId }];
      document.body.insertAdjacentHTML('afterbegin', window.renderPromoCard(_promoSlots[0]));
      document.querySelector('[data-promo-cta]').click();
      return window.__pwned;
    }, SLOT);
    expect(pwned).toBeUndefined();

    const openedUrl = await page.evaluate((s) => {
      window.logPromoEvent = () => {};
      let opened = null;
      window.open = (url) => { opened = url; };
      _promoSlots = [{ ...s, id: 'a-normal-uuid', cta_action: 'url:https://wrotate.com/open' }];
      document.body.insertAdjacentHTML('afterbegin', window.renderPromoCard(_promoSlots[0]));
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

// ── Variants ─────────────────────────────────────────────────────────────
// promo_slots.variant + .size pick the treatment. The contract that matters
// beyond looks: EVERY variant keeps the same id + delegation hooks (so
// impression tracking, the click handler and injectPromoCards()'s bookkeeping
// are variant-blind), escapes the heading, and falls back to the classic card
// for anything unrecognized — which is what every row written before these
// columns existed is.
test.describe('renderPromoCard variants', () => {
  const dom = (page, slot) => page.evaluate((s) => {
    const host = document.createElement('div');
    host.innerHTML = window.renderPromoCard(s);
    const card = host.firstElementChild;
    return {
      classes: card.className,
      hasHero: !!card.querySelector('.promo-card-hero'),
      hasClassicHeader: !!card.querySelector('.promo-card-header'),
      hasStrip: !!card.querySelector('.promo-tag-strip'),
      hasDot: !!card.querySelector('.promo-tag-dot'),
      notches: card.querySelectorAll('.promo-tag-notch').length,
      hasWatermark: !!card.querySelector('.promo-band-mark'),
      hasRule: !!card.querySelector('.promo-band-rule'),
      eyebrow: (card.querySelector('.promo-tag-eyebrow, .promo-band-eyebrow, .promo-eyebrow') || {}).textContent || '',
      heading: (card.querySelector('.promo-heading') || {}).textContent || '',
      headingChildren: (card.querySelector('.promo-heading') || { children: [] }).children.length,
      promoId: card.dataset.promoId,
      ctaClasses: (card.querySelector('[data-promo-cta]') || {}).className ?? null,
    };
  }, slot);

  test('no variant renders the classic card — every pre-existing row', async ({ page }) => {
    await page.goto('/');
    const out = await dom(page, SLOT);
    expect(out.classes).toBe('promo-card');
    expect(out.hasClassicHeader).toBe(true);
    expect(out.hasHero).toBe(true);
    expect(out.hasStrip).toBe(false);
  });

  test('an unrecognized or prototype-shaped variant falls back to classic', async ({ page }) => {
    await page.goto('/');
    for (const variant of ['not_a_variant', '__proto__', 'constructor', 'hasOwnProperty', '', null]) {
      const out = await dom(page, { ...SLOT, variant });
      expect(out.classes, `variant ${variant}`).toBe('promo-card');
      expect(out.hasClassicHeader, `variant ${variant}`).toBe(true);
    }
    // Same guard on size: an unknown size renders the prompt layout, and the
    // tag's nudge-only bits (no brand dot) must not leak in.
    const out = await dom(page, { ...SLOT, variant: 'tag', size: '__proto__' });
    expect(out.classes).toContain('promo-tag--prompt');
    expect(out.hasDot).toBe(true);
  });

  test('tag/prompt renders the perforated strip, both notches and the hero', async ({ page }) => {
    await page.goto('/');
    const out = await dom(page, { ...SLOT, variant: 'tag', size: 'prompt' });
    expect(out.classes).toContain('promo-tag');
    expect(out.classes).toContain('promo-tag--prompt');
    expect(out.hasStrip).toBe(true);
    expect(out.hasDot).toBe(true);
    expect(out.notches).toBe(2);
    expect(out.hasClassicHeader).toBe(false);
    expect(out.hasHero).toBe(true);
    expect(out.heading).toBe('Rank your collection');
  });

  test('tag/nudge drops the brand dot and keeps the strip', async ({ page }) => {
    await page.goto('/');
    const out = await dom(page, { ...SLOT, variant: 'tag', size: 'nudge' });
    expect(out.classes).toContain('promo-tag--nudge');
    expect(out.hasStrip).toBe(true);
    expect(out.hasDot).toBe(false);
    expect(out.notches).toBe(2);
  });

  test('band/prompt renders the tick rule and watermark, and never a hero', async ({ page }) => {
    await page.goto('/');
    const out = await dom(page, { ...SLOT, variant: 'band', size: 'prompt' });
    expect(out.classes).toContain('promo-band--prompt');
    expect(out.hasRule).toBe(true);
    expect(out.hasWatermark).toBe(true);
    // SLOT carries a valid https image_url — the band still shows no hero.
    expect(out.hasHero).toBe(false);
  });

  test('band/nudge is the compact bar — no gradient furniture', async ({ page }) => {
    await page.goto('/');
    const out = await dom(page, { ...SLOT, variant: 'band', size: 'nudge' });
    expect(out.classes).toContain('promo-band--nudge');
    expect(out.hasWatermark).toBe(false);
    expect(out.hasRule).toBe(false);
  });

  test('an empty eyebrow falls back to the house label, a set one wins', async ({ page }) => {
    await page.goto('/');
    expect((await dom(page, { ...SLOT, variant: 'tag', eyebrow: '' })).eyebrow).toBe('WRotate HQ');
    expect((await dom(page, { ...SLOT, variant: 'band', eyebrow: '' })).eyebrow).toBe('WRotate');
    expect((await dom(page, { ...SLOT, variant: 'band', eyebrow: 'WRotate asks' })).eyebrow).toBe('WRotate asks');
  });

  test('every variant escapes the heading and keeps the delegation hooks', async ({ page }) => {
    await page.goto('/');
    for (const variant of ['classic', 'tag', 'band']) {
      for (const size of ['prompt', 'nudge']) {
        const out = await dom(page, {
          ...SLOT, variant, size, id: 'p1', heading: '<img src=x onerror=alert(1)>',
        });
        expect(out.heading, `${variant}/${size}`).toBe('<img src=x onerror=alert(1)>');
        expect(out.headingChildren, `${variant}/${size}`).toBe(0);
        expect(out.promoId, `${variant}/${size}`).toBe('p1');
        expect(out.ctaClasses, `${variant}/${size}`).toContain('promo-cta');
      }
    }
  });

  test('a CTA click runs the action in every variant', async ({ page }) => {
    await page.goto('/');
    for (const variant of ['classic', 'tag', 'band']) {
      const opened = await page.evaluate(([s, v]) => {
        window.logPromoEvent = () => {};
        let url = null;
        window.open = (u) => { url = u; };
        _promoSlots = [{ ...s, id: 'cta-' + v, variant: v, cta_action: 'url:https://wrotate.com/open' }];
        document.body.insertAdjacentHTML('afterbegin', window.renderPromoCard(_promoSlots[0]));
        document.querySelector('[data-promo-cta]').click();
        document.querySelector('[data-promo-id]').remove();
        return url;
      }, [SLOT, variant]);
      expect(opened, variant).toBe('https://wrotate.com/open');
    }
  });

  test('the band cancels the page gutter; the tag keeps the card inset', async ({ page }) => {
    await page.goto('/');
    const margins = await page.evaluate((s) => {
      const feed = document.getElementById('feed-list');
      const read = (variant) => {
        feed.insertAdjacentHTML('beforeend', window.renderPromoCard({ ...s, id: 'm-' + variant, variant }));
        const el = document.getElementById('promocard-m-' + variant);
        const cs = getComputedStyle(el);
        const out = { left: parseFloat(cs.marginLeft), radius: cs.borderTopLeftRadius };
        el.remove();
        return out;
      };
      return { band: read('band'), tag: read('tag') };
    }, SLOT);
    // Negative margin = full-bleed: it eats main's horizontal padding.
    expect(margins.band.left).toBeLessThan(0);
    expect(margins.band.radius).toBe('0px');
    expect(margins.tag.left).toBe(0);
    expect(margins.tag.radius).toBe('14px');
  });
});
