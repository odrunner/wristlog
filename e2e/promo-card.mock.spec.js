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
});
