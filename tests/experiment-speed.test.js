import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { experimentSpeedHtml, SPEED_EXPERIMENTS } from '../wrotate_test.js';

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
    expect(out).toContain('Control <span style="color:var(--muted);">(3 loads, 2 users)</span>');
    expect(out).toContain('1.3s <span style="color:var(--muted);">/ 2.4s</span>');
    expect(out).toContain('2.0s <span style="color:var(--muted);">/ 3.1s</span>');
    expect(out).toContain('>33%<');
    expect(out).toContain('Treatment <span style="color:var(--muted);">(9 loads, 4 users)</span>');
    expect(out).toContain('2.4s <span style="color:var(--muted);">/ 3.0s</span>');
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
    expect(experimentSpeedHtml('feed_rpc', { control: arm({ loads: '5', first_live_p50: '1500', first_live_p90: '3000' }), treatment: arm() })).toContain('1.5s <span style="color:var(--muted);">/ 3.0s</span>');
  });
});
