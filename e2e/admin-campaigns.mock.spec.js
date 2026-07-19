import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// Admin → Traffic → "By Campaign".
//
// Unit tests cover campaignSubject/campaignGroupOf in isolation, but they can't
// catch a ReferenceError in the render function itself — refactoring the group
// constants out left a dangling `ONBOARDING.indexOf(...)` that threw at runtime
// while every unit test still passed. This drives the real render.

const DATA = {
  by_subject: [
    { subject: 'Add your first watch', sent: 100, delivered: 98, opened: 40, clicked: 5 },
    { subject: 'Which watch is really your favorite?', sent: 362, delivered: 358, opened: 90, clicked: 8 },
    { subject: 'SA commented on your post', sent: 61, delivered: 60, opened: 20, clicked: 2 },
    { subject: 'SA also commented', sent: 52, delivered: 50, opened: 18, clicked: 1 },
    { subject: 'masont wants to follow you', sent: 30, delivered: 29, opened: 10, clicked: 0 },
    { subject: 'Timur added you as a close friend', sent: 4, delivered: 4, opened: 1, clicked: 0 },
    { subject: 'Call me T mentioned you', sent: 1, delivered: 1, opened: 1, clicked: 0 },
    { subject: 'masont mentioned you', sent: 2, delivered: 2, opened: 0, clicked: 0 },
    { subject: 'Your watch has more to tell you — meet the Pro V2 engine (beta)', sent: 45, delivered: 39, opened: 12, clicked: 3 },
    { subject: '3 new things in WRotate since you joined', sent: 159, delivered: 159, opened: 50, clicked: 6 },
  ],
  recent: [],
};

async function renderLabels(page) {
  return page.evaluate((data) => {
    const d = document.createElement('div');
    d.innerHTML = renderEmailEngagement(data);
    return [...d.querySelectorAll('div')]
      .map(e => (e.childElementCount === 0 ? e.textContent.trim() : ''))
      .filter(t => t && !/^(Delivered|Opened|Clicked):/.test(t));
  }, DATA);
}

test.describe('Admin — By Campaign grouping (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, {});
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('renders without throwing and groups in order', async ({ page }) => {
    const labels = await renderLabels(page);
    const order = ['Onboarding', 'Notifications', 'Broadcast — in progress', 'Older campaigns']
      .map(g => labels.indexOf(g));
    expect(order.every(i => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test('Follows, Comments and Mentions sit under Notifications', async ({ page }) => {
    const labels = await renderLabels(page);
    const start = labels.indexOf('Notifications');
    const end = labels.indexOf('Broadcast — in progress');
    const section = labels.slice(start + 1, end);
    expect(section).toEqual(['Follows', 'Comments', 'Mentions']);
  });

  test('mentions are collapsed into one bucket, not per-actor rows', async ({ page }) => {
    const labels = await renderLabels(page);
    expect(labels).not.toContain('masont mentioned you');
    expect(labels).not.toContain('Call me T mentioned you');
    expect(labels.filter(l => l === 'Mentions')).toHaveLength(1);
  });

  test('mentions no longer fall into Older campaigns', async ({ page }) => {
    const labels = await renderLabels(page);
    const older = labels.slice(labels.indexOf('Older campaigns') + 1);
    expect(older).not.toContain('Mentions');
  });

  test('onboarding drips keep their 1-4 numbering', async ({ page }) => {
    const labels = await renderLabels(page);
    expect(labels).toContain('1. Add your first watch');
    expect(labels).toContain('4. Which watch is really your favorite?');
  });
});
