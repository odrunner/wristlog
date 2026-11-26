// Experiment msr_retry_coach (2026-11-26): coach on the first failed measurement, and after
// a weak or lost signal. Control keeps the older rule (two failures, four stop reasons).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { msrRunFailed, msrCoachTips } from '../wrotate_test.js';
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

describe('msrRunFailed', () => {
  it('the four older reasons count in both arms', () => {
    for (const r of ['no_ticks', 'no_ticks_after_recal', 'duration_timeout', 'duration_cap']) {
      expect(msrRunFailed(r, false)).toBe(true);
      expect(msrRunFailed(r, true)).toBe(true);
    }
  });
  it('weak and lost signal count only with the coach', () => {
    for (const r of ['weak_signal', 'no_ticks_signal_lost']) {
      expect(msrRunFailed(r, false)).toBe(false);
      expect(msrRunFailed(r, true)).toBe(true);
    }
  });
  it('a reading, a manual stop or an early quit is never a failure', () => {
    for (const r of ['converged', 'user_stopped', 'user_quit_early', 'plateau', 'navigated_away', undefined]) {
      expect(msrRunFailed(r, true)).toBe(false);
      expect(msrRunFailed(r, false)).toBe(false);
    }
  });
});

describe('msrCoachTips', () => {
  it('quiet room, auto BPH: placement only', () => {
    expect(msrCoachTips({ manualBph: false, noise: 0, stopReason: 'no_ticks' })).toEqual(['place']);
  });
  it('noise comes first, in two strengths', () => {
    expect(msrCoachTips({ manualBph: false, noise: 0.1, stopReason: 'no_ticks' })).toEqual(['noise_high', 'place']);
    expect(msrCoachTips({ manualBph: false, noise: 0.2, stopReason: 'no_ticks' })).toEqual(['noise_very_high', 'place']);
    expect(msrCoachTips({ manualBph: false, noise: 0.08, stopReason: 'no_ticks' })).toEqual(['place']);
  });
  it('weak or lost signal adds the keep-still step', () => {
    expect(msrCoachTips({ manualBph: false, noise: 0, stopReason: 'weak_signal' })).toEqual(['place', 'still']);
    expect(msrCoachTips({ manualBph: false, noise: 0, stopReason: 'no_ticks_signal_lost' })).toEqual(['place', 'still']);
  });
  it('a manual BPH suggests Auto, and the list never exceeds three', () => {
    expect(msrCoachTips({ manualBph: true, noise: 0, stopReason: 'duration_timeout' })).toEqual(['place', 'auto_bph']);
    expect(msrCoachTips({ manualBph: true, noise: 0.3, stopReason: 'weak_signal' })).toEqual(['noise_very_high', 'place', 'still']);
  });
});

describe('wiring in index.html', () => {
  it('every tip key has text, and the coach is behind the experiment', () => {
    for (const k of ['noise_very_high', 'noise_high', 'place', 'still', 'auto_bph']) {
      expect(html).toMatch(new RegExp(`\\n  ${k}: '`));
    }
    expect(html).toMatch(/_msrConsecutiveFailures < \(coach \? 1 : 2\)/);
    expect(html).toMatch(/const _coach = experiment\('msr_retry_coach'\);\s*\n\s*if \(msrRunFailed\(stopReason, _coach\)\)/);
  });
  it('the notification card repeats only behind push_ask_repeat and logs which copy it showed', () => {
    expect(html).toMatch(/const repeat = experiment\('push_ask_repeat'\);/);
    expect(html).toMatch(/const useReading = repeat && ctx === 'reading';/);
    expect(html).toMatch(/_logPostCtaEvent\('shown', _pushAskSource\)/);
    expect(html).toMatch(/event: 'push_turned_on'/);
  });
});
