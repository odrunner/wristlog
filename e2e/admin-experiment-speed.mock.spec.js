import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// Admin → Experiments: the feed_rpc card shows load time per group (from
// admin_experiment_speed), other cards do not, and the tab still renders when
// that optional call fails.
const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';
const row = (key, name) => ({
  key, name, status: 'running', rollout_pct: 50, metric_key: 'active_days', owner: 'sql',
  min_lift_pct: 10, min_users_per_arm: 50, min_days: 7, max_guardrail_drop_pct: 5, decision: null,
  eval: { metric_kind: 'mean', days_running: 1, control: { users: 5, mean: 0 }, treatment: { users: 7, mean: 0.14 }, lift_pct: null, p_value: 0.3173, guardrail: { drop_pct: 0 }, verdict: 'too_early' },
  decisions: [],
});
const SPEED = {
  feed_rpc: {
    control:   { loads: 3, users: 2, first_live_p50: 1285, first_live_p90: 2448, enriched_p50: 2043, enriched_p90: 3080, error_pct: 0 },
    treatment: { loads: 9, users: 4, first_live_p50: 2392, first_live_p90: 2974, enriched_p50: 2392, enriched_p90: 3097, error_pct: 0 },
  },
  follow_suggest: {
    control:   { loads: 5, users: 4, first_live_p50: 2709, first_live_p90: 4927, enriched_p50: 4006, enriched_p90: 6067, error_pct: 0 },
    treatment: { loads: 14, users: 5, first_live_p50: 1654, first_live_p90: 3235, enriched_p50: 2030, enriched_p90: 3862, error_pct: 0 },
  },
};

async function open(page, speedHandler) {
  await mockSupabase(page);
  await page.route('**/rest/v1/rpc/admin_experiments_list*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row('feed_rpc', 'Feed in one request'), row('follow_suggest', 'Follow suggestions')]) }));
  await page.route('**/rest/v1/experiment_metrics*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'active_days', label: 'Active days', kind: 'mean' }]) }));
  await page.route('**/rest/v1/rpc/admin_experiment_speed*', speedHandler);
  await injectSession(page, { id: ADMIN_ID, email: 'admin@wrotate.com', aud: 'authenticated' });
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(async () => {
    if (!document.getElementById('admin-experiments-list')) { const d = document.createElement('div'); d.id = 'admin-experiments-list'; document.body.appendChild(d); }
    await loadAdminExperiments();
  });
  return page.locator('#admin-experiments-list .adm-exp-card');
}

test('the feed_rpc card shows speed per group; a card that is not about speed does not', async ({ page }) => {
  const cards = await open(page, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SPEED) }));
  await expect(cards).toHaveCount(2);
  const feed = cards.filter({ hasText: 'Feed in one request' });
  await expect(feed.locator('.adm-exp-speed')).toHaveCount(1);
  await expect(feed.locator('.adm-exp-speed')).toContainText('Control (3 loads, 2 users)');
  await expect(feed.locator('.adm-exp-speed')).toContainText('Treatment (9 loads, 4 users)');
  await expect(feed.locator('.adm-exp-speed')).toContainText('2.4s / 3.0s');
  await expect(cards.filter({ hasText: 'Follow suggestions' }).locator('.adm-exp-speed')).toHaveCount(0);
});

test('the tab renders without the speed block when the speed call fails', async ({ page }) => {
  const cards = await open(page, r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
  await expect(cards).toHaveCount(2);
  await expect(page.locator('#admin-experiments-list .adm-exp-speed')).toHaveCount(0);
  await expect(cards.first()).toContainText('too_early');
});
