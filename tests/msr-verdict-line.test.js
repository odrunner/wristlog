import { describe, it, expect } from 'vitest';
import { msrVerdictLine } from '../wrotate_test.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Verdict line under a converged reading (experiment msr_verdict_line,
// weekly agents A3 2026-10-12). Rate-only interpretation, no weekly
// conversions (owner: collectors speak in s/day).

describe('msrVerdictLine bands', () => {
  it('returns nothing without a finite rate', () => {
    expect(msrVerdictLine(null)).toBe('');
    expect(msrVerdictLine(undefined)).toBe('');
    expect(msrVerdictLine(NaN)).toBe('');
    expect(msrVerdictLine('garbage')).toBe('');
  });

  it('chronometer spec is the signed COSC band -4..+6, inclusive', () => {
    for (const r of [-4, 0, 4.2, 6]) {
      expect(msrVerdictLine(r)).toBe('Within chronometer spec (-4/+6 s/day) — excellent.');
    }
  });

  it('outside spec but within ±15 reads as healthy (both signs)', () => {
    for (const r of [6.1, 12, 15, -4.1, -15]) {
      expect(msrVerdictLine(r)).toBe('Healthy — most mechanical watches run within ±15 s/day.');
    }
  });

  it('±15..±30 points at regulation', () => {
    for (const r of [15.1, 22, 30, -30]) {
      expect(msrVerdictLine(r)).toBe('Common for older movements; a regulation can bring it down.');
    }
  });

  it('beyond ±30 names magnetism/service without alarm words', () => {
    for (const r of [30.1, 45, -120]) {
      expect(msrVerdictLine(r)).toBe('Higher than typical — magnetism or service wear are common causes.');
    }
  });

  it('accepts numeric strings (rate inputs are text fields)', () => {
    expect(msrVerdictLine('4.2')).toBe('Within chronometer spec (-4/+6 s/day) — excellent.');
  });
});

describe('verdict line wiring (index.html)', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

  it('save section has the verdict element, hidden by default', () => {
    expect(html).toMatch(/id="msr-verdict-line"[^>]*class="[^"]*hidden/);
  });

  it('rendering is gated on convergence AND the experiment', () => {
    expect(html).toContain("wasConverged && experiment('msr_verdict_line')");
  });
});
