import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot,
  SAMPLE_WATCHES, SAMPLE_LOGS,
} from './helpers.js';

// Sticky-hover regression (2026-11-06): on touch screens :hover stays on the
// tab you just pressed, and `nav button:hover { color: var(--text) }` outranked
// `.active` in the phone block — so the active tab rendered white, not gold,
// until the next header re-render. Playwright reproduces it for free: after
// click() the mouse stays over the button, so :hover is live right here.

async function activeNavIsGold(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('nav button.active');
    const probe = document.createElement('span');
    probe.style.color = 'var(--gold-text)';
    document.body.appendChild(probe);
    const gold = getComputedStyle(probe).color;
    probe.remove();
    return { actual: getComputedStyle(btn).color, gold };
  });
}

for (const [label, vp] of [['phone (bottom bar)', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
  test(`the pressed nav tab stays gold under the stuck hover at ${label}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await page.click('nav button[data-page="collection"]');
    await expect(page.locator('#page-collection')).toBeVisible();
    // The mouse is still over the tab (= a phone's sticky hover). Poll past
    // the color transition: without the fix the hover color is the FINAL
    // value, so this still fails; with it the tab settles on gold.
    await expect.poll(async () => {
      const { actual, gold } = await activeNavIsGold(page);
      return actual === gold;
    }).toBe(true);
  });
}
