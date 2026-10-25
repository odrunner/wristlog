import { describe, it, expect } from 'vitest';

// Mirrors index.html _proV2Available() / _tgAlgo(). The Standard engine was RETIRED
// 2026-10-25: there is no selector and no per-session opt-out (_tgAlgoSel/onTgAlgo are
// gone — removed code archived in docs/archive/standard-engine-selector-retired-2026-10-25.md).
// Pro V2 is THE engine on native 2.1+ builds; 'original' survives only as the fallback for
// pre-2.1 binaries, which do not contain Pro V2 at all. There is no web engine, so
// availability is purely a build question.
function _proV2Available(native21) { return native21; }
function _tgAlgo(native21) {
  return _proV2Available(native21) ? 'tg' : 'original';
}

describe('measurement engine (Pro V2, Standard retired)', () => {
  it('runs Pro V2 on every 2.1+ build', () => {
    expect(_tgAlgo(true)).toBe('tg');
  });
  it('falls back to Standard only when Pro V2 is not in the build', () => {
    expect(_tgAlgo(false)).toBe('original');
  });
  it('availability is a build question — no flag override', () => {
    expect(_proV2Available(true)).toBe(true);
    expect(_proV2Available(false)).toBe(false);
  });
});
