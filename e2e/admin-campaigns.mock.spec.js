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
    { subject: 'A fun fact about your Seiko Sekonda', sent: 1, delivered: 1, opened: 0, clicked: 0 },
    { subject: 'A fun fact about the Omega Speedmaster', sent: 1, delivered: 1, opened: 1, clicked: 0 },
    { subject: 'Which watch is really your favorite?', sent: 362, delivered: 358, opened: 90, clicked: 8 },
    { subject: 'SA commented on your post', sent: 61, delivered: 60, opened: 20, clicked: 2 },
    { subject: 'SA also commented', sent: 52, delivered: 50, opened: 18, clicked: 1 },
    { subject: 'masont wants to follow you', sent: 30, delivered: 29, opened: 10, clicked: 0 },
    { subject: 'Timur added you as a close friend', sent: 4, delivered: 4, opened: 1, clicked: 0 },
    { subject: 'Dan accepted your friend request', sent: 1, delivered: 1, opened: 0, clicked: 0 },
    { subject: 'Call me T mentioned you', sent: 1, delivered: 1, opened: 1, clicked: 0 },
    { subject: 'masont mentioned you', sent: 2, delivered: 2, opened: 0, clicked: 0 },
    { subject: '3 new things in WRotate since you joined', sent: 159, delivered: 159, opened: 50, clicked: 6 },
    // Stray personalized one-off — one inbox, not a campaign.
    { subject: 'We miss you, Tyler', sent: 1, delivered: 1, opened: 0, clicked: 0 },
  ],
  // Broadcasts, keyed by broadcast_queue.label as the RPC returns them — the
  // name the send was given, NOT the per-recipient rendered subject. Their
  // events are already excluded from by_subject server-side.
  broadcasts: [
    { label: 'Your watches miss you — here’s a fun fact about {{watchPhrase}}', pending: 2, sent: 1, delivered: 1, opened: 0, clicked: 0 },
    // Regression guard: this label shares the onboarding drip's prefix, so
    // normalizing it through campaignSubject would collapse it onto
    // CAMPAIGN_FUNFACT_DRIP and campaignGroupOf would file it under Onboarding —
    // which is how a live 266-email send became invisible in By Campaign.
    { label: 'A fun fact about {{watchPhrase}}', pending: 232, sent: 34, delivered: 32, opened: 3, clicked: 0 },
    // Drained: no pending rows, so it belongs in Older, not in-progress forever.
    { label: 'Pro V2 engine (beta)', pending: 0, sent: 45, delivered: 39, opened: 12, clicked: 3 },
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

  test('Connections, Comments and Mentions sit under Notifications', async ({ page }) => {
    const labels = await renderLabels(page);
    const start = labels.indexOf('Notifications');
    const end = labels.indexOf('Broadcast — in progress');
    const section = labels.slice(start + 1, end);
    expect(section).toEqual(['Connections', 'Comments', 'Mentions']);
  });

  test('mentions are collapsed into one bucket, not per-actor rows', async ({ page }) => {
    const labels = await renderLabels(page);
    expect(labels).not.toContain('masont mentioned you');
    expect(labels).not.toContain('Call me T mentioned you');
    expect(labels.filter(l => l === 'Mentions')).toHaveLength(1);
  });

  test('friend requests join Connections instead of standing alone', async ({ page }) => {
    const labels = await renderLabels(page);
    expect(labels).not.toContain('Dan accepted your friend request');
    expect(labels.filter(l => l === 'Connections')).toHaveLength(1);
  });

  test('mentions no longer fall into Older campaigns', async ({ page }) => {
    const labels = await renderLabels(page);
    const older = labels.slice(labels.indexOf('Older campaigns') + 1);
    expect(older).not.toContain('Mentions');
  });

  test('onboarding drips keep their 1-4 numbering, with fun fact at 2', async ({ page }) => {
    const labels = await renderLabels(page);
    expect(labels).toContain('1. Add your first watch');
    expect(labels).toContain('2. A fun fact about your watch');
    expect(labels).toContain('4. Which watch is really your favorite?');
    // The personalized variants collapsed rather than rendering one row each.
    expect(labels).not.toContain('A fun fact about your Seiko Sekonda');
    expect(labels).not.toContain('A fun fact about the Omega Speedmaster');
  });

  test('only the broadcasts with pending queue rows are in progress', async ({ page }) => {
    const labels = await renderLabels(page);
    const start = labels.indexOf('Broadcast — in progress');
    const section = labels.slice(start + 1, labels.indexOf('Older campaigns'));
    // Both pending broadcasts, ordered by volume within the group.
    expect(section).toEqual([
      'A fun fact about {{watchPhrase}}',
      'Your watches miss you — here’s a fun fact about {{watchPhrase}}',
    ]);
    // Drained: falls through to Older instead of claiming in-progress forever.
    const older = labels.slice(labels.indexOf('Older campaigns') + 1);
    expect(older).toContain('Pro V2 engine (beta)');
  });

  test('a broadcast sharing the drip prefix is not swallowed by Onboarding', async ({ page }) => {
    // The reported bug: "A fun fact about {{watchPhrase}}" was queued and live,
    // but By Campaign showed nothing for it — its numbers were folded into the
    // day-3 onboarding drip row.
    const labels = await renderLabels(page);
    const inProgress = labels.slice(
      labels.indexOf('Broadcast — in progress') + 1, labels.indexOf('Older campaigns'));
    expect(inProgress).toContain('A fun fact about {{watchPhrase}}');
    // The onboarding drip row still exists, and is still the drip — the two are
    // separate campaigns that merely share a subject template.
    const onboarding = labels.slice(0, labels.indexOf('Notifications'));
    expect(onboarding).toContain('2. A fun fact about your watch');
    expect(onboarding).not.toContain('A fun fact about {{watchPhrase}}');
  });

  test('an in-flight broadcast shows from its first delivery', async ({ page }) => {
    // 1 delivered, but exempt from the one-off filter because it is mid-send.
    const labels = await renderLabels(page);
    expect(labels).toContain('Your watches miss you — here’s a fun fact about {{watchPhrase}}');
  });

  test('a queued broadcast with no engagement yet still shows in progress', async ({ page }) => {
    // A freshly queued broadcast has no email_events rows at all — and its first
    // sends are often internal test sends the RPC filters out by recipient. The
    // section is seeded from the queue so it is not blank while a send is live.
    const section = await page.evaluate(() => {
      const d = document.createElement('div');
      d.innerHTML = renderEmailEngagement({
        by_subject: [
          { subject: '3 new things in WRotate since you joined', sent: 159, delivered: 159, opened: 50, clicked: 6 },
        ],
        broadcasts: [{ label: 'Your watches miss you — here’s a fun fact about {{watchPhrase}}', pending: 5, sent: 0, delivered: 0, opened: 0, clicked: 0 }],
        recent: [],
      });
      const all = [...d.querySelectorAll('div')]
        .map(e => (e.childElementCount === 0 ? e.textContent.trim() : ''))
        .filter(t => t && !/^(Queued|Delivered|Opened|Clicked):/.test(t));
      return all.slice(all.indexOf('Broadcast — in progress') + 1, all.indexOf('Older campaigns'));
    });
    expect(section).toEqual(['Your watches miss you — here’s a fun fact about {{watchPhrase}}']);
  });

  test('stray one-off sends are hidden from Older campaigns', async ({ page }) => {
    const labels = await renderLabels(page);
    expect(labels).not.toContain('We miss you, Tyler');
    // A real campaign at the same spot in the list is untouched.
    expect(labels).toContain('3 new things in WRotate since you joined');
  });

  test('unsubscribe categories never reach the render', async ({ page }) => {
    // The RPC drops event_type='unsubscribed' rows, whose `subject` is the unsub
    // category. Guard the render too, so a regression there is visible here.
    const labels = await page.evaluate(() => {
      const d = document.createElement('div');
      d.innerHTML = renderEmailEngagement({
        by_subject: [
          { subject: '3 new things in WRotate since you joined', sent: 159, delivered: 159, opened: 50, clicked: 6 },
          { subject: 'updates', sent: 0, delivered: 0, opened: 0, clicked: 0 },
          { subject: 'reminders', sent: 0, delivered: 0, opened: 0, clicked: 0 },
        ],
        broadcasts: [],
        recent: [],
      });
      return [...d.querySelectorAll('div')]
        .map(e => (e.childElementCount === 0 ? e.textContent.trim() : ''))
        .filter(Boolean);
    });
    expect(labels).not.toContain('updates');
    expect(labels).not.toContain('reminders');
  });
});

// A staged send sits at pending = 0 with its remainder held for review. The
// in-flight test used to read only `pending`, so a campaign 50 of 457 sent was
// filed under "Older campaigns" — hidden exactly while you were deciding
// whether to release the other 407.
test.describe('Admin — By Campaign, staged sends (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, {});
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  const render = (page, broadcasts) => page.evaluate((broadcasts) => {
    const d = document.createElement('div');
    d.innerHTML = renderEmailEngagement({ by_subject: [], broadcasts, recent: [] });
    return d.innerHTML;
  }, broadcasts);

  test('a held-only campaign lands in "Broadcast — in progress", not Older', async ({ page }) => {
    const html = await render(page, [
      { label: 'What should we build next?', pending: 0, held: 407, sent: 50, delivered: 48, opened: 22, clicked: 0 },
    ]);
    const inProgress = html.indexOf('Broadcast — in progress');
    const older = html.indexOf('Older campaigns');
    expect(inProgress).toBeGreaterThan(-1);
    // Either Older is absent, or the campaign sits before it.
    const campaign = html.indexOf('What should we build next?');
    expect(campaign).toBeGreaterThan(inProgress);
    if (older > -1) expect(campaign).toBeLessThan(older);
  });

  test('held rows read as held, not as queued to send', async ({ page }) => {
    // "Queued" promises a send that happens by itself; held rows go nowhere
    // until released. The two must not be collapsed into one number.
    const html = await render(page, [
      { label: 'What should we build next?', pending: 0, held: 407, sent: 50, delivered: 48, opened: 22, clicked: 0 },
    ]);
    expect(html).toContain('Held for review: 407');
    expect(html).not.toContain('Queued: 407');
  });

  test('a campaign both draining and holding reports the two separately', async ({ page }) => {
    const html = await render(page, [
      { label: 'Mixed', pending: 12, held: 30, sent: 8, delivered: 8, opened: 2, clicked: 0 },
    ]);
    expect(html).toContain('Queued: 12');
    expect(html).toContain('Held for review: 30');
  });

  test('a fully drained campaign still falls through to Older', async ({ page }) => {
    // The fix must not pin every past broadcast in "in progress" forever.
    const html = await render(page, [
      { label: 'Pro V2 engine (beta)', pending: 0, held: 0, sent: 401, delivered: 392, opened: 160, clicked: 12 },
    ]);
    expect(html).toContain('Older campaigns');
    expect(html).not.toContain('Held for review');
  });
});
