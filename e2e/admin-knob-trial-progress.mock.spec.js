import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// Admin → Experiments: a running knob trial (owner weekly_review) is judged only on
// Sundays, so between Sundays its card shows live sample-size progress per group
// (admin_knob_trial_progress). Other experiments do not get the block, and the tab
// still renders when that optional call fails.
const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';
const base = { status: 'running', rollout_pct: 50, min_lift_pct: 10, min_users_per_arm: 50, min_days: 7, max_guardrail_drop_pct: 5, decision: null, decisions: [] };
const ROWS = [
  { ...base, key: 'tgknob_stabwin_8', name: 'tg_stabwin = 8 vs live 6', metric_key: 'tg_bad_lock', owner: 'weekly_review', eval: null },
  { ...base, key: 'follow_suggest', name: 'Follow suggestions', metric_key: 'active_days', owner: 'sql', eval: null },
];
const PROG = { tgknob_stabwin_8: { control: { users: 8, sessions: 34, converged: 23 }, treatment: { users: 15, sessions: 123, converged: 61 } } };

async function open(page, progHandler) {
  await mockSupabase(page);
  await page.route('**/rest/v1/rpc/admin_experiments_list*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) }));
  await page.route('**/rest/v1/experiment_metrics*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/rest/v1/rpc/admin_experiment_speed*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/rest/v1/rpc/admin_knob_trial_progress*', progHandler);
  await injectSession(page, { id: ADMIN_ID, email: 'admin@wrotate.com', aud: 'authenticated' });
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(async () => {
    if (!document.getElementById('admin-experiments-list')) { const d = document.createElement('div'); d.id = 'admin-experiments-list'; document.body.appendChild(d); }
    await loadAdminExperiments();
  });
  return page.locator('#admin-experiments-list .adm-exp-card');
}

test('a running knob trial shows progress per group; a normal experiment does not', async ({ page }) => {
  const cards = await open(page, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROG) }));
  await expect(cards).toHaveCount(2);
  const knob = cards.filter({ hasText: 'tg_stabwin' });
  const panel = knob.locator('.adm-exp-progress');
  await expect(panel).toHaveCount(1);
  await expect(panel).toContainText('Control8 / 1523 / 6034');
  await expect(panel).toContainText('Treatment15 / 15 ✓61 / 60 ✓123');
  await expect(cards.filter({ hasText: 'Follow suggestions' }).locator('.adm-exp-progress')).toHaveCount(0);
});

test('the tab renders with an empty progress block when the progress call fails', async ({ page }) => {
  const cards = await open(page, r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: 'tg_stabwin' }).locator('.adm-exp-progress')).toContainText('Control0 / 150 / 600');
});
