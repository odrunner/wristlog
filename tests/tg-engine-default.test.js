import { describe, it, expect } from 'vitest';

// Mirrors index.html _proV2Available() / _tgAlgo(): Pro V2 is the DEFAULT engine on
// native 2.1+ builds, Standard is the remembered opt-out (tg_algo_sel === 'original').
// Admins can force the selector on non-2.1 builds via the tg_algo dev flag.
function _proV2Available(native21, tgAlgoFlag) { return native21 || tgAlgoFlag; }
function _tgAlgo(native21, tgAlgoFlag, sel) {
  if (!_proV2Available(native21, tgAlgoFlag)) return 'original';
  return sel === 'original' ? 'original' : 'tg';
}

describe('measurement engine default (Pro V2)', () => {
  it('runs Pro V2 on a 2.1 build when the user has never picked', () => {
    expect(_tgAlgo(true, false, null)).toBe('tg');
  });
  it('respects an explicit opt-out to Standard', () => {
    expect(_tgAlgo(true, false, 'original')).toBe('original');
  });
  it('keeps Pro V2 for a user who explicitly picked it', () => {
    expect(_tgAlgo(true, false, 'tg')).toBe('tg');
  });
  it('falls back to Standard when the engine is not in the build', () => {
    expect(_tgAlgo(false, false, 'tg')).toBe('original');
    expect(_tgAlgo(false, false, null)).toBe('original');
  });
  it('lets an admin flag force Pro V2 on a pre-2.1 build', () => {
    expect(_tgAlgo(false, true, null)).toBe('tg');
    expect(_tgAlgo(false, true, 'original')).toBe('original');
  });
});

describe('engine selector visibility', () => {
  it('is shown on 2.1 builds and to flagged admins, hidden otherwise', () => {
    expect(_proV2Available(true, false)).toBe(true);
    expect(_proV2Available(false, true)).toBe(true);
    expect(_proV2Available(false, false)).toBe(false);
  });
  it('displays the engine that will actually run, not the raw preference', () => {
    // The bug this replaced: a never-touched user ran Pro V2 while the dropdown read Standard.
    const shown = _tgAlgo(true, false, null);
    expect(shown).toBe('tg');
  });
});
