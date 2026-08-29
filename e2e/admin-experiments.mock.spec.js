import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// Admin → Experiments tab.
//
// loadAdminExperiments() drives two parallel reads (admin_experiments_list RPC +
// experiment_metrics table) and renders a table; adminExpAction() confirms
// through the shared #confirm-modal before posting admin_experiment_set_status.
// These are called directly via page.evaluate rather than through nav clicks —
// the admin tab itself is exercised by other admin specs; this one is scoped to
// the experiments render + action wiring.

const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';
const ROW = {
  key: 'feed_compact', name: 'Compact feed cards', status: 'running', rollout_pct: 20, metric_key: 'log_created',
  min_lift_pct: 10, min_users_per_arm: 50, min_days: 7, max_guardrail_drop_pct: 5, decision: null,
  eval: { metric_kind: 'rate', days_running: 12, control: { users: 60, converted: 12, mean: 0.2 }, treatment: { users: 58, converted: 20, mean: 0.3448 },
          lift_pct: 72.4, p_value: 0.0771, guardrail: { drop_pct: 1.2, p_value: 0.6 }, verdict: 'inconclusive' },
  decisions: [],
};

test('experiments tab renders a running row and Kill posts the status change', async ({ page }) => {
  await mockSupabase(page);
  const calls = [];
  await page.route('**/rest/v1/rpc/admin_experiments_list*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ROW]) }));
  await page.route('**/rest/v1/experiment_metrics*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'log_created', label: 'Logged a wear / post', kind: 'rate' }]) }));
  await page.route('**/rest/v1/rpc/admin_experiment_set_status*', r => { calls.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }); });
  await injectSession(page, { id: ADMIN_ID, email: 'admin@wrotate.com', aud: 'authenticated' });
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(async (id) => { currentUser = { id }; await loadAdminExperiments(); }, ADMIN_ID);
  const list = page.locator('#admin-experiments-list');
  await expect(list).toContainText('Compact feed cards');
  await expect(list).toContainText('12/60 (20.0%)');
  await expect(list).toContainText('20/58 (34.5%)');
  await expect(list).toContainText('+72.4%');
  await expect(list).toContainText('inconclusive');

  await page.evaluate(() => { adminExpAction('feed_compact', 'killed'); });
  await page.waitForSelector('#confirm-modal:not(.hidden)');
  await page.evaluate(() => _confirmOk());
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({ p_key: 'feed_compact', p_status: 'killed', p_rollout_pct: null });
});

test('a row with no evaluation yet renders "not evaluated", and only running rows get a Refresh chip', async ({ page }) => {
  const rows = [
    { key: 'draft_exp', name: 'Draft Experiment', status: 'draft', rollout_pct: 10, metric_key: 'log_created',
      min_lift_pct: 10, min_users_per_arm: 50, min_days: 7, max_guardrail_drop_pct: 5, decision: null, eval: null, decisions: [] },
    { key: 'running_no_eval', name: 'Running No Eval', status: 'running', rollout_pct: 15, metric_key: 'log_created',
      min_lift_pct: 10, min_users_per_arm: 50, min_days: 7, max_guardrail_drop_pct: 5, decision: null, eval: null, decisions: [] },
  ];
  await mockSupabase(page);
  await page.route('**/rest/v1/rpc/admin_experiments_list*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }));
  await page.route('**/rest/v1/experiment_metrics*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'log_created', label: 'Logged a wear / post', kind: 'rate' }]) }));
  await injectSession(page, { id: ADMIN_ID, email: 'admin@wrotate.com', aud: 'authenticated' });
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(async (id) => { currentUser = { id }; await loadAdminExperiments(); }, ADMIN_ID);

  const list = page.locator('#admin-experiments-list');
  const draftRow = list.locator('.adm-exp-card', { hasText: 'Draft Experiment' });
  const runningRow = list.locator('.adm-exp-card', { hasText: 'Running No Eval' });
  await expect(draftRow).toContainText('not evaluated');
  await expect(runningRow).toContainText('not evaluated');
  // The admin page section isn't navigated to (loadAdminExperiments() is called
  // directly), so its container is display:none — a display:none ancestor drops
  // getByRole() matches from the accessibility tree entirely, so match on the
  // button element/text instead of role.
  await expect(runningRow.locator('button', { hasText: 'Refresh' })).toHaveCount(1);
  await expect(draftRow.locator('button', { hasText: 'Refresh' })).toHaveCount(0);
});
