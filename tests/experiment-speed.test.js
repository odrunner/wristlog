import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { experimentSpeedHtml, SPEED_EXPERIMENTS, knobTrialProgressHtml, KNOB_TRIAL_MIN, fmtExperimentMetric } from '../wrotate_test.js';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const arm = (extra = {}) => ({ loads: 9, users: 4, first_live_p50: 2392, first_live_p90: 2974, enriched_p50: 2392, enriched_p90: 3097, error_pct: 0, ...extra });

// Admin → Experiments shows load time per arm, but only where it means something.
describe('SPEED_EXPERIMENTS', () => {
  it('lists the experiments that are about load time, identically in both copies', () => {
    expect(SPEED_EXPERIMENTS).toEqual(['feed_rpc']);
    expect(html).toContain("const SPEED_EXPERIMENTS = ['feed_rpc'];");
  });
});

describe('experimentSpeedHtml', () => {
  it('shows both arms as median / p90 seconds with loads, users and error rate', () => {
    const out = experimentSpeedHtml('feed_rpc', { control: arm({ loads: 3, users: 2, first_live_p50: 1285, first_live_p90: 2448, enriched_p50: 2043, enriched_p90: 3080, error_pct: 33.4 }), treatment: arm() });
    expect(out).toContain('Control <span class="text-muted">(3 loads, 2 users)</span>');
    expect(out).toContain('1.3s <span class="text-muted">/ 2.4s</span>');
    expect(out).toContain('2.0s <span class="text-muted">/ 3.1s</span>');
    expect(out).toContain('>33%<');
    expect(out).toContain('Treatment <span class="text-muted">(9 loads, 4 users)</span>');
    expect(out).toContain('2.4s <span class="text-muted">/ 3.0s</span>');
    expect(out).toContain('Repeat loads only');
  });
  it('says so when an arm has no repeat loads yet', () => {
    const out = experimentSpeedHtml('feed_rpc', { treatment: arm() });
    expect(out).toContain('no repeat loads yet');
    expect(out).toContain('Treatment');
    expect(experimentSpeedHtml('feed_rpc', { control: arm({ loads: 0 }), treatment: arm() })).toContain('no repeat loads yet');
  });
  it('renders nothing for experiments that are not about speed, or without data', () => {
    expect(experimentSpeedHtml('follow_suggest', { control: arm(), treatment: arm() })).toBe('');
    expect(experimentSpeedHtml('feed_rpc', null)).toBe('');
    expect(experimentSpeedHtml('feed_rpc', undefined)).toBe('');
    expect(experimentSpeedHtml('feed_rpc', 'x')).toBe('');
  });
  it('shows a dash for missing numbers and never NaN', () => {
    const out = experimentSpeedHtml('feed_rpc', { control: arm({ users: null, first_live_p50: null, enriched_p90: 'n/a', error_pct: null }), treatment: arm({ error_pct: '' }) });
    expect(out).toContain('(9 loads, – users)');
    expect(out).toContain('– <span');
    expect(out).toContain('/ –</span>');
    expect(out).not.toContain('NaN');
  });
  it('accepts numeric strings', () => {
    expect(experimentSpeedHtml('feed_rpc', { control: arm({ loads: '5', first_live_p50: '1500', first_live_p90: '3000' }), treatment: arm() })).toContain('1.5s <span class="text-muted">/ 3.0s</span>');
  });
});

describe('knobTrialProgressHtml', () => {
  it('mirrors the judge floor and is wired into the knob-trial card', () => {
    expect(KNOB_TRIAL_MIN).toEqual({ users: 15, converged: 60 });
    expect(html).toContain('const KNOB_TRIAL_MIN = { users: 15, converged: 60 };');
    const loop = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'accuracy_loop.py'), 'utf8');
    expect(loop).toContain('MIN_CONV_PER_ARM = 60');
    expect(loop).toContain('MIN_USERS_PER_ARM = 15');
    expect(html).toContain("db.rpc('admin_knob_trial_progress')");
    expect(html).toContain("x.owner === 'weekly_review' && x.status === 'running' ? knobTrialProgressHtml(_knobProg[x.key] || {}) : ''");
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'wrotate_test.js'), 'utf8');
    expect(html).toContain(src.match(/export (function knobTrialProgressHtml[\s\S]*?\n\})/)[1]);
  });
  it('shows users and converged against the floor, ticking a met floor', () => {
    const out = knobTrialProgressHtml({ control: { users: 8, sessions: 34, converged: 23 }, treatment: { users: 15, sessions: 123, converged: 61 } });
    expect(out).toContain('<div>Control</div><div>8<span class="text-muted"> / 15</span></div><div>23<span class="text-muted"> / 60</span></div><div>34</div>');
    expect(out).toContain('<div>Treatment</div><div>15<span class="text-muted"> / 15</span> ✓</div><div>61<span class="text-muted"> / 60</span> ✓</div><div>123</div>');
    expect(out).toContain('provisional');
  });
  it('shows zeros for a missing arm or bad numbers, never NaN', () => {
    const out = knobTrialProgressHtml({ treatment: { users: '3', sessions: null, converged: 'x' } });
    expect(out).toContain('<div>Control</div><div>0<span class="text-muted"> / 15</span></div><div>0<span class="text-muted"> / 60</span></div><div>0</div>');
    expect(out).toContain('<div>Treatment</div><div>3<span');
    expect(out).not.toContain('NaN');
    expect(knobTrialProgressHtml({})).toContain('<div>Control</div>');
  });
  it('renders nothing without data', () => {
    expect(knobTrialProgressHtml(null)).toBe('');
    expect(knobTrialProgressHtml('x')).toBe('');
  });
});

describe('fmtExperimentMetric on a knob-trial eval', () => {
  it('shows wrong-of-converged instead of NaN', () => {
    const ev = { control: { conv: 720, n: 1165, users: 55, wrong_conv: 164 }, treatment: { conv: 0, wrong_conv: 0, users: 1 } };
    expect(fmtExperimentMetric(ev, 'control')).toBe('164/720 wrong (22.8%)');
    expect(fmtExperimentMetric(ev, 'treatment')).toBe('—');
  });
});
