import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// Admin → broadcast queue list ("In Flight").
//
// The list used to render every row admin_broadcast_queue_status returned,
// including fully-drained sends, so finished campaigns accumulated above the
// one actually sending. Completed sends are reported under Traffic → By
// Campaign; this list is only for what is still going.
//
// Driven through the real render (not a unit test) for the same reason as
// admin-campaigns.mock.spec.js: the row markup is built inline, so only an
// actual DOM render catches a mistake in it.

async function renderQueue(page, breakdown, extra = {}) {
  await page.route('**/rest/v1/rpc/admin_broadcast_queue_status*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        pending: breakdown.reduce((n, b) => n + (b.pending || 0), 0),
        sent: breakdown.reduce((n, b) => n + (b.sent || 0), 0),
        failed: breakdown.reduce((n, b) => n + (b.failed || 0), 0),
        used_today: 10,
        breakdown,
        ...extra,
      }),
    }));
  return page.evaluate(async () => {
    document.getElementById('broadcast-sends-list').innerHTML = '';
    await renderBroadcastQueueStatus();
    const el = document.getElementById('broadcast-sends-list');
    return {
      html: el.innerHTML,
      labels: [...el.querySelectorAll('span')]
        .map(s => s.textContent.trim())
        .filter(Boolean),
    };
  });
}

const RUNNING = { label: 'A fun fact about {{watchPhrase}}', pending: 232, sent: 34, failed: 0, total: 266 };
const DONE_A  = { label: 'Pro V2 engine (beta)', pending: 0, sent: 401, failed: 0, total: 401 };
const DONE_B  = { label: 'Your watches miss you — here’s a fun fact about {{watchPhrase}}', pending: 0, sent: 28, failed: 0, total: 28 };

test.describe('Broadcast queue list (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, {});
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('finished campaigns are dropped, the running one stays', async ({ page }) => {
    const { html, labels } = await renderQueue(page, [RUNNING, DONE_A, DONE_B]);
    expect(labels).toContain('A fun fact about {{watchPhrase}}');
    expect(labels).not.toContain('Pro V2 engine (beta)');
    expect(labels).not.toContain('Your watches miss you — here’s a fun fact about {{watchPhrase}}');
    // The survivor is the one sending, and it is first in line.
    expect(html).toContain('sending next');
    expect(html).not.toContain('>done<');
  });

  test('the list disappears entirely once everything has drained', async ({ page }) => {
    const { html } = await renderQueue(page, [DONE_A, DONE_B]);
    expect(html).toBe('');
  });

  test('a send that drained with failures is still shown', async ({ page }) => {
    // Not "finished" — it did not complete. Traffic → By Campaign counts only
    // delivered/opened/clicked, so hiding it here would leave a partly-failed
    // broadcast invisible everywhere.
    const partly = { label: 'Half-sent campaign', pending: 0, sent: 40, failed: 7, total: 47 };
    const { html, labels } = await renderQueue(page, [partly, DONE_A]);
    expect(labels).toContain('Half-sent campaign');
    expect(labels).not.toContain('Pro V2 engine (beta)');
    expect(html).toContain('7 failed');
    // Labelled as failed, not "done".
    expect(html).toContain('failed<');
  });

  test('queue positions number only the running campaigns', async ({ page }) => {
    const second = { label: 'Second in line', pending: 50, sent: 0, failed: 0, total: 50 };
    const { html } = await renderQueue(page, [RUNNING, DONE_A, second]);
    expect(html).toContain('sending next');
    // Drained rows must not consume a position, or the queue reads as #3 of 3
    // when only two are actually waiting.
    expect(html).toContain('#2 in line');
    expect(html).not.toContain('#3 in line');
  });
});
