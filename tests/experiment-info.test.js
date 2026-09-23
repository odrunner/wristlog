import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { experimentInfoSections, EXP_OWNER_AUDIENCE, EXP_STATUS_AUDIENCE } from '../wrotate_test.js';

// The Admin → Experiments ⓘ modal: "what are we testing again?" in plain language.
// Every field comes from the row admin_experiments_list() already returns.

const LABELS = {
  accuracy_reading_saved: 'Saved an accuracy reading',
  d7_retained: 'Seen again 7+ days later',
  active_days: 'Active days per user',
  tg_bad_lock: 'Bad lock rate',
};

const row = (over = {}) => ({
  key: 'remeasure_d7',
  name: 'Day-7 nudge',
  hypothesis: 'A nudge a week later brings people back to re-measure.',
  status: 'running',
  owner: 'server',
  rollout_pct: 50,
  metric_key: 'accuracy_reading_saved',
  guardrail_metric_key: 'd7_retained',
  min_lift_pct: 25,
  min_users_per_arm: 50,
  min_days: 14,
  max_guardrail_drop_pct: 5,
  ...over,
});

const bodyOf = (x, labels = LABELS) => experimentInfoSections(x, labels).map(s => s.body);

describe('experimentInfoSections', () => {
  it('returns the three headings in order', () => {
    const hs = experimentInfoSections(row(), LABELS).map(s => s.h);
    expect(hs).toEqual(['What we’re testing', 'Who’s in it', 'How it gets judged']);
  });

  it('leads with the hypothesis verbatim', () => {
    expect(bodyOf(row())[0]).toBe('A nudge a week later brings people back to re-measure.');
  });

  it('says so when no hypothesis was recorded — blank, whitespace or missing', () => {
    expect(bodyOf(row({ hypothesis: null }))[0]).toMatch(/No hypothesis/);
    expect(bodyOf(row({ hypothesis: '   ' }))[0]).toMatch(/No hypothesis/);
    const { hypothesis, ...noHyp } = row();
    expect(bodyOf(noHyp)[0]).toMatch(/No hypothesis/);
  });

  it('a running experiment shows the split, and the owner explains how arms are picked', () => {
    const audience = bodyOf(row())[1];
    expect(audience).toContain('50% treatment / 50% control.');
    expect(audience).toContain(EXP_OWNER_AUDIENCE.server);
  });

  it('a finished or unstarted experiment replaces the split with its state', () => {
    for (const s of ['draft', 'won', 'killed', 'archived']) {
      const audience = bodyOf(row({ status: s }))[1];
      expect(audience).toContain(EXP_STATUS_AUDIENCE[s]);
      expect(EXP_STATUS_AUDIENCE[s]).toBeTruthy();
      expect(audience).not.toContain('treatment / ');
    }
  });

  it('an unknown status falls back to the split, an unknown owner to the login rule', () => {
    const audience = bodyOf(row({ status: 'paused', owner: 'someone_new' }))[1];
    expect(audience).toContain('50% treatment / 50% control.');
    expect(audience).toContain(EXP_OWNER_AUDIENCE.sql);
  });

  it('a non-numeric rollout drops the split rather than printing NaN', () => {
    const audience = bodyOf(row({ status: 'paused', owner: 'sql', rollout_pct: null }))[1];
    expect(audience).not.toMatch(/NaN/);
    expect(audience).toBe(EXP_OWNER_AUDIENCE.sql);
  });

  it('quotes the row’s own gates, by metric NAME not key', () => {
    const judged = bodyOf(row())[2];
    expect(judged).toContain('“Saved an accuracy reading”');
    expect(judged).toContain('“Seen again 7+ days later”');
    expect(judged).toContain('25% higher');
    expect(judged).toContain('50 users');
    expect(judged).toContain('14 days');
    expect(judged).toContain('5%');
    expect(judged).not.toContain('accuracy_reading_saved');
  });

  it('falls back to the metric key when the label map is missing or short', () => {
    expect(bodyOf(row(), null)[2]).toContain('“accuracy_reading_saved”');
    expect(bodyOf(row(), {})[2]).toContain('“d7_retained”');
    expect(bodyOf(row({ metric_key: null }), {})[2]).toContain('“—”');
  });

  // A knob trial is judged by the Sunday accuracy loop on wrong-of-converged, not by
  // the nightly SQL judge on the row's metric — quoting its gates would be a lie.
  it('a knob trial describes the Sunday loop, never the nightly judge', () => {
    const judged = bodyOf(row({ owner: 'weekly_review', key: 'tgknob_stabwin_8' }))[2];
    expect(judged).toContain('Sunday');
    expect(judged).toContain('p < 0.20');
    expect(judged).not.toContain('06:00 UTC');
    expect(judged).not.toContain('Saved an accuracy reading');
    expect(bodyOf(row())[2]).toContain('06:00 UTC');
  });

  it('every owner the DB allows has audience copy', () => {
    const sql = readFileSync(new URL('../sql/2026-08-30-accuracy-loop.sql', import.meta.url), 'utf8');
    // The CHECK constraint is the source of truth for 'sql'/'weekly_review'; 'server'
    // was added by docs/experiments.md + sql/2026-09-11-remeasure-d7.sql.
    const m = /experiments_owner_check[\s\S]*?owner IN \(([^)]*)\)/.exec(sql);
    expect(m, 'owner CHECK constraint not found — did the column move?').toBeTruthy();
    const owners = [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).concat('server');
    for (const o of owners) expect(EXP_OWNER_AUDIENCE[o], `no copy for owner=${o}`).toBeTruthy();
  });
});
