import { describe, it, expect } from 'vitest';
import { resolveExperiment, experimentVerdict, experimentSortRank, fmtExperimentMetric } from '../wrotate_test.js';

describe('resolveExperiment', () => {
  const state = { a: 'treatment', b: 'control' };
  it('treatment → true, control → false, unknown → false', () => {
    expect(resolveExperiment(state, {}, 'a')).toBe(true);
    expect(resolveExperiment(state, {}, 'b')).toBe(false);
    expect(resolveExperiment(state, {}, 'zzz')).toBe(false);
  });
  it('override wins in both directions', () => {
    expect(resolveExperiment(state, { a: 'control' }, 'a')).toBe(false);
    expect(resolveExperiment(state, { b: 'treatment' }, 'b')).toBe(true);
  });
  it('tolerates null state/overrides', () => {
    expect(resolveExperiment(null, null, 'a')).toBe(false);
  });
});

describe('experimentVerdict', () => {
  const gates = { min_users_per_arm: 50, min_days: 7, min_lift_pct: 10, max_guardrail_drop_pct: 5 };
  const base = { days_running: 10, control: { users: 60 }, treatment: { users: 58 }, lift_pct: 30, p_value: 0.01, guardrail: { drop_pct: 1, p_value: 0.5 } };
  it('too_early on users or days', () => {
    expect(experimentVerdict({ ...base, treatment: { users: 10 } }, gates)).toBe('too_early');
    expect(experimentVerdict({ ...base, days_running: 3 }, gates)).toBe('too_early');
  });
  it('guardrail_breach beats winning', () => {
    expect(experimentVerdict({ ...base, guardrail: { drop_pct: 9, p_value: 0.01 } }, gates)).toBe('guardrail_breach');
    expect(experimentVerdict({ ...base, guardrail: { drop_pct: 9, p_value: 0.4 } }, gates)).toBe('winning');
  });
  it('winning / losing / inconclusive', () => {
    expect(experimentVerdict(base, gates)).toBe('winning');
    expect(experimentVerdict({ ...base, lift_pct: -20 }, gates)).toBe('losing');
    expect(experimentVerdict({ ...base, lift_pct: 5 }, gates)).toBe('inconclusive');
    expect(experimentVerdict({ ...base, p_value: 0.3 }, gates)).toBe('inconclusive');
    expect(experimentVerdict({ ...base, lift_pct: null, p_value: null }, gates)).toBe('inconclusive');
  });
  it('null eval → too_early', () => {
    expect(experimentVerdict(null, gates)).toBe('too_early');
  });
  it('missing guardrail object → still evaluates', () => {
    const noGuardrail = { ...base };
    delete noGuardrail.guardrail;
    expect(experimentVerdict(noGuardrail, gates)).toBe('winning');
  });
  it('guardrail p_value: null with drop_pct: 9 → NOT guardrail_breach', () => {
    expect(experimentVerdict({ ...base, guardrail: { drop_pct: 9, p_value: null } }, gates)).toBe('winning');
  });
  it('missing days_running → too_early', () => {
    const noDays = { ...base };
    delete noDays.days_running;
    expect(experimentVerdict(noDays, gates)).toBe('too_early');
  });
  it('lift -20 with p 0.3 (non-significant) → inconclusive', () => {
    expect(experimentVerdict({ ...base, lift_pct: -20, p_value: 0.3 }, gates)).toBe('inconclusive');
  });
  it('zero-control clause: control.mean=0, treatment.mean=0.3, p=0.01 → winning', () => {
    expect(experimentVerdict({ days_running: 10, control: { users: 60, mean: 0 }, treatment: { users: 58, mean: 0.3 }, lift_pct: null, p_value: 0.01, guardrail: { drop_pct: 1, p_value: 0.5 } }, gates)).toBe('winning');
  });
  it('zero-control with treatment.mean=0 → inconclusive', () => {
    expect(experimentVerdict({ days_running: 10, control: { users: 60, mean: 0 }, treatment: { users: 58, mean: 0 }, lift_pct: null, p_value: 0.01, guardrail: { drop_pct: 1, p_value: 0.5 } }, gates)).toBe('inconclusive');
  });
});

describe('experimentSortRank', () => {
  it('orders running < won < killed < archived < draft', () => {
    const r = ['draft', 'archived', 'killed', 'won', 'running'].map(experimentSortRank);
    expect(r).toEqual([4, 3, 2, 1, 0]);
    expect(experimentSortRank('weird')).toBe(4);
  });
});

describe('fmtExperimentMetric', () => {
  it('rate shows converted/users and %', () => {
    expect(fmtExperimentMetric({ metric_kind: 'rate', control: { users: 60, converted: 12, mean: 0.2 } }, 'control')).toBe('12/60 (20.0%)');
  });
  it('mean shows two decimals', () => {
    expect(fmtExperimentMetric({ metric_kind: 'mean', treatment: { users: 5, mean: 3.1 } }, 'treatment')).toBe('3.10 (n=5)');
  });
  it('missing arm → dash', () => {
    expect(fmtExperimentMetric(null, 'control')).toBe('—');
    expect(fmtExperimentMetric({ metric_kind: 'rate' }, 'control')).toBe('—');
  });
});
