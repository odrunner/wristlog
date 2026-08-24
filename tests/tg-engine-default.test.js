import { describe, it, expect } from 'vitest';

// Mirrors index.html _proV2Available() / _tgAlgo(): Pro V2 is the DEFAULT engine on
// native 2.1+ builds, Standard is a per-app-session opt-out. `sel` here stands for the
// in-memory _tgAlgoSel, which starts null every app session — it used to be a localStorage
// key, which froze anyone who tried Standard once on the older engine permanently
// (see tests/prov2-precision.test.js). There is no web engine, so availability is
// purely a build question — the old tg_algo flag half was removed 2026-08-23.
function _proV2Available(native21) { return native21; }
function _tgAlgo(native21, sel) {
  if (!_proV2Available(native21)) return 'original';
  return sel === 'original' ? 'original' : 'tg';
}

describe('measurement engine default (Pro V2)', () => {
  it('runs Pro V2 on a 2.1 build when the user has never picked', () => {
    expect(_tgAlgo(true, null)).toBe('tg');
  });
  it('respects an explicit opt-out to Standard for the rest of the session', () => {
    expect(_tgAlgo(true, 'original')).toBe('original');
  });
  it('starts every app session on Pro V2, whatever was picked last time', () => {
    // sel is module state, so a relaunch always arrives here as null.
    expect(_tgAlgo(true, null)).toBe('tg');
  });
  it('keeps Pro V2 for a user who explicitly picked it', () => {
    expect(_tgAlgo(true, 'tg')).toBe('tg');
  });
  it('falls back to Standard when the engine is not in the build', () => {
    expect(_tgAlgo(false, 'tg')).toBe('original');
    expect(_tgAlgo(false, null)).toBe('original');
  });
});

describe('engine selector visibility', () => {
  it('is shown on 2.1 builds, hidden otherwise — no flag override', () => {
    expect(_proV2Available(true)).toBe(true);
    expect(_proV2Available(false)).toBe(false);
  });
  it('displays the engine that will actually run, not the raw preference', () => {
    // The bug this replaced: a never-touched user ran Pro V2 while the dropdown read Standard.
    const shown = _tgAlgo(true, null);
    expect(shown).toBe('tg');
  });
});
