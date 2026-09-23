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

// The ⓘ modal: clicking a card's name says what the experiment tests, who is in it
// and how it gets judged — all from the row already on the page, no extra request.
test('clicking an experiment name opens a modal explaining what it tests', async ({ page }) => {
  const knob = {
    key: 'tgknob_stabwin_8', name: 'tg_stabwin = 8 vs live 6', status: 'running', rollout_pct: 50,
    metric_key: 'tg_bad_lock', guardrail_metric_key: 'active_days', owner: 'weekly_review',
    min_lift_pct: 10, min_users_per_arm: 15, min_days: 7, max_guardrail_drop_pct: 5, decision: null,
    hypothesis: 'A longer stability window rejects the wobbly locks.', started_at: '2026-09-20T08:00:00Z',
    eval: null, decisions: [],
  };
  await mockSupabase(page);
  let listCalls = 0;
  await page.route('**/rest/v1/rpc/admin_experiments_list*', r => { listCalls++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ ...ROW, owner: 'sql', hypothesis: 'Compact cards get more logs.', started_at: '2026-09-01T08:00:00Z' }, knob]) }); });
  await page.route('**/rest/v1/experiment_metrics*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'log_created', label: 'Logged a wear / post', kind: 'rate' }, { key: 'active_days', label: 'Active days per user', kind: 'mean' }]) }));
  await injectSession(page, { id: ADMIN_ID, email: 'admin@wrotate.com', aud: 'authenticated' });
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(async (id) => { currentUser = { id }; await loadAdminExperiments(); }, ADMIN_ID);
  const callsAfterRender = listCalls;

  const modal = page.locator('#adm-exp-info-modal');
  await expect(modal).toHaveClass(/hidden/);
  // Same reason as the spec above: the admin section is display:none because
  // loadAdminExperiments() was called directly, so dispatch the click rather than
  // waiting for visibility — the onclick attribute is still what runs.
  await page.locator('.adm-exp-card', { hasText: 'Compact feed cards' }).locator('.adm-exp-name').dispatchEvent('click');
  await expect(modal).not.toHaveClass(/hidden/);
  await expect(page.locator('#adm-exp-info-title')).toHaveText('Compact feed cards');
  await expect(page.locator('#adm-exp-info-sub')).toContainText('feed_compact');
  // Hypothesis, the split, the arm rule, and gates quoted by metric name.
  await expect(modal).toContainText('Compact cards get more logs.');
  await expect(modal).toContainText('20% treatment / 80% control.');
  await expect(modal).toContainText('at login');
  await expect(modal).toContainText('“Logged a wear / post”');
  await expect(modal).toContainText('inconclusive');
  expect(listCalls).toBe(callsAfterRender);   // nothing refetched to open it

  // Escape closes it (the shared overlay map), and a knob trial names the Sunday loop.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);
  await page.locator('.adm-exp-card', { hasText: 'tg_stabwin' }).locator('.adm-exp-name').dispatchEvent('click');
  await expect(modal).toContainText('Sunday');
  await expect(modal).toContainText('measurement setting');
  await expect(modal).not.toContainText('06:00 UTC');
  await expect(modal).toContainText('not evaluated');
});

// An archived experiment is the one you've most forgotten, so its line in the
// collapsed list opens the same modal.
test('an archived experiment explains itself too', async ({ page }) => {
  const rows = [{
    key: 'tgknob_gatemaxrej_0p5', name: 'tg_gatemaxrej = 0.5', status: 'archived', rollout_pct: 0,
    metric_key: 'log_created', guardrail_metric_key: 'active_days', owner: 'weekly_review',
    min_lift_pct: 10, min_users_per_arm: 15, min_days: 7, max_guardrail_drop_pct: 5,
    hypothesis: 'Blocking convergence while the σ-gate rejects half the windows catches bad locks.',
    decided_at: '2026-08-23T00:00:00Z', decision: 'manual', eval: null, decisions: [],
  }];
  await mockSupabase(page);
  await page.route('**/rest/v1/rpc/admin_experiments_list*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }));
  await page.route('**/rest/v1/experiment_metrics*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'log_created', label: 'Logged a wear / post', kind: 'rate' }]) }));
  await injectSession(page, { id: ADMIN_ID, email: 'admin@wrotate.com', aud: 'authenticated' });
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(async (id) => { currentUser = { id }; await loadAdminExperiments(); }, ADMIN_ID);

  await page.locator('#adm-exp-archived .adm-exp-name').dispatchEvent('click');
  const modal = page.locator('#adm-exp-info-modal');
  await expect(modal).not.toHaveClass(/hidden/);
  await expect(modal).toContainText('σ-gate');
  await expect(modal).toContainText('Archived');
  await expect(modal).not.toContainText('treatment / ');      // a decided row shows its state, not a split
  await expect(modal).toContainText(/decided \d/);   // locale-formatted, so just assert it is there
});
