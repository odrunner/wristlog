import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES } from './helpers.js';

// An onboarding email's button names the screen the email is about:
// /open?…&go=<key> (email_campaigns.cta_action). open.html forwards the query
// to /, and the page opens that screen once the signed-in app is up. The
// native shells call runGoLink(key) instead of reloading the page.

async function boot(page, query) {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [] });
  await page.goto('/' + query);
  await waitForAppBoot(page);
}

test('a go link opens the named screen and is stripped from the address', async ({ page }) => {
  await boot(page, '?utm_source=email&utm_medium=campaign&utm_campaign=onboarding-accuracy-overview&go=open_accuracy');
  await expect(page.locator('#page-msr-history')).toHaveClass(/active/);
  expect(new URL(page.url()).searchParams.has('go')).toBe(false);
});

test('the Collection key lands on Collection', async ({ page }) => {
  await boot(page, '?go=open_collection');
  await expect(page.locator('#page-collection')).toHaveClass(/active/);
});

test('an unknown or inherited key does nothing: the Feed stays, the parameter still goes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, '?go=constructor');
  await page.waitForTimeout(1200);
  await expect(page.locator('#page-feed')).toHaveClass(/active/);
  expect(new URL(page.url()).searchParams.has('go')).toBe(false);
  expect(await page.evaluate(() => [runGoLink('__proto__'), runGoLink('url:https://evil.example'), runGoLink(null)])).toEqual([false, false, false]);
  expect(errors).toEqual([]);
});

test('a feedback link wins: its modal opens and the go key does not navigate', async ({ page }) => {
  await boot(page, '?feedback=1&go=open_collection');
  await expect(page.locator('#feedback-modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('#page-feed')).toHaveClass(/active/);
});

test('the native shells call runGoLink: after boot it navigates at once', async ({ page }) => {
  await boot(page, '');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => runGoLink('open_collection'))).toBe(true);
  await expect(page.locator('#page-collection')).toHaveClass(/active/);
});

test('a key handed over before the app is up waits for it', async ({ page }) => {
  // What a cold start from an email does on iOS/Android: the shell calls
  // runGoLink as soon as the page has loaded, before bootApp() has finished.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { window.__early = runGoLink('open_collection'); });
  });
  await boot(page, '');
  expect(await page.evaluate(() => window.__early)).toBe(true);
  await expect(page.locator('#page-collection')).toHaveClass(/active/);
});
