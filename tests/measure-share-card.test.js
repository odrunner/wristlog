import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  MSR_CARD_MIN_DOTS,
  msrCardHasEnoughData,
  msrCardResultText,
} from '../wrotate_test.js';

// Spec: 2026-05-31-measurement-share-graph-card-design.md
// Pure-logic coverage for the accuracy graph share card. The canvas render
// itself is verified by visual UAT, not here.

describe('msrCardHasEnoughData', () => {
  const dots = (n) => Array.from({ length: n }, (_, i) => ({ t: i, d: 0, cd: 0 }));

  it('is false below the threshold', () => {
    expect(msrCardHasEnoughData(dots(MSR_CARD_MIN_DOTS - 1))).toBe(false);
  });

  it('is true at the threshold', () => {
    expect(msrCardHasEnoughData(dots(MSR_CARD_MIN_DOTS))).toBe(true);
  });

  it('is true well above the threshold', () => {
    expect(msrCardHasEnoughData(dots(200))).toBe(true);
  });

  it('handles empty and non-array input safely', () => {
    expect(msrCardHasEnoughData([])).toBe(false);
    expect(msrCardHasEnoughData(null)).toBe(false);
    expect(msrCardHasEnoughData(undefined)).toBe(false);
  });

  it('threshold matches the engine bucket-rate minimum (11)', () => {
    expect(MSR_CARD_MIN_DOTS).toBe(11);
  });
});

describe('msrCardResultText', () => {
  it('formats a positive rate with a leading +', () => {
    expect(msrCardResultText({ rate: 3.2 }).rate).toBe('+3.2 s/d');
  });

  it('formats a negative rate without a + and keeps the minus', () => {
    expect(msrCardResultText({ rate: -4.7 }).rate).toBe('-4.7 s/d');
  });

  it('formats zero rate without a + (matches app convention: + for positives only)', () => {
    expect(msrCardResultText({ rate: 0 }).rate).toBe('0.0 s/d');
  });

  it('shows an em dash for a non-numeric rate', () => {
    expect(msrCardResultText({ rate: null }).rate).toBe('— s/d');
  });

  it('formats beat error in ms when present', () => {
    expect(msrCardResultText({ rate: 1, beatError: 0.4 }).beatError).toBe('0.4 ms');
  });

  it('returns null beat error when absent', () => {
    expect(msrCardResultText({ rate: 1, beatError: null }).beatError).toBe(null);
    expect(msrCardResultText({ rate: 1 }).beatError).toBe(null);
  });

  it('formats BPH with thousands separator and suffix', () => {
    expect(msrCardResultText({ rate: 1, bph: 28800 }).bph).toBe('28,800 bph');
  });

  it('returns null BPH for zero / missing', () => {
    expect(msrCardResultText({ rate: 1, bph: 0 }).bph).toBe(null);
    expect(msrCardResultText({ rate: 1 }).bph).toBe(null);
  });
});

// Guard rails on the index.html wiring — keep the share flow intact.
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('Measurement share card — index.html wiring', () => {
  it('share flow renders the card and passes it to the composer', () => {
    expect(html).toContain('renderMsrShareCard(');
    expect(html).toMatch(/openNewPost\(\{[^}]*prefillFiles/s);
  });

  it('openNewPost stages prefillFiles into the post image arrays', () => {
    expect(html).toContain('o.prefillFiles');
    expect(html).toMatch(/newPostFiles\.push\(f\)/);
  });

  it('only builds the card when there is enough dot data', () => {
    expect(html).toContain('msrCardHasEnoughData(_msrScatterData)');
  });

  it('shares the scatter draw core between the live plot and the card', () => {
    expect(html).toContain('function drawMsrScatterCore(');
    // Both the live plot and the card renderer call the shared core.
    const coreCalls = html.match(/drawMsrScatterCore\(/g) || [];
    expect(coreCalls.length).toBeGreaterThanOrEqual(3); // definition + 2 callers
  });
});

describe('Share button at completion — wiring', () => {
  it('completion Share button calls shareMsrFromComplete', () => {
    expect(html).toContain('id="msr-complete-share-btn"');
    expect(html).toContain('onclick="shareMsrFromComplete()"');
  });

  it('Save and Share share one persist path (no duplicated insert logic)', () => {
    expect(html).toContain('function persistMsrReading(');
    // Exactly one insert into timegrapher_results from the measure flow lives
    // in persistMsrReading; saveMsrReading/shareMsrFromComplete both call it.
    expect(html).toMatch(/async function saveMsrReading\(\)\s*\{[^}]*persistMsrReading\(\)/s);
    expect(html).toMatch(/async function shareMsrFromComplete\(\)\s*\{[^}]*persistMsrReading\(\)/s);
  });

  it('share-at-completion persists before opening the composer', () => {
    // shareMsrFromComplete must persist (and bail on failure) before sharing.
    expect(html).toMatch(/shareMsrFromComplete\(\)\s*\{\s*const res = await persistMsrReading\(\);\s*if \(!res\.ok\) return;\s*shareMsrToFeed/s);
  });

  it('enables the completion Share button when a reading lands', () => {
    expect(html).toContain("getElementById('msr-complete-share-btn')");
  });
});

describe('Measurement share — compact card + not-a-wear', () => {
  it('card height is derived from content (compact), not a fixed 1350 canvas', () => {
    // The renderer computes H from the layout instead of hard-coding 1350.
    expect(html).toMatch(/const H = \(sub \? subY : rateY\) \+ padBottom/);
    expect(html).not.toMatch(/const W = 1080, H = 1350/);
  });

  it('accuracy card uploads to an _accuracy path so the feed can detect it', () => {
    expect(html).toContain("const isAccuracyCard = /^accuracy-/.test(f.name");
    expect(html).toMatch(/const suffix = isAccuracyCard \? '_accuracy' : ''/);
  });

  it('feed renders _accuracy hero at natural height (not the fixed 4:5 slot)', () => {
    expect(html).toContain('feed-card-photo--accuracy');
    expect(html).toMatch(/_accuracy\\.jpg/);
  });

  it('measurement share is tagged use_case=measurement (so it is not a wear)', () => {
    // Measurement shares stay use_case='measurement'; normal posts now carry the
    // chosen occasion when a watch is tagged (see harmonize spec 2026-06-27).
    expect(html).toMatch(/_npSource === 'measurement' \? 'measurement' :/);
    expect(html).toContain('use_case: entry.useCase');
  });

  it('rebuildLogsByWatch excludes measurement logs from wear counts', () => {
    expect(html).toMatch(/if \(l\.useCase === 'measurement'\)[^\n]*continue/);
  });
});
