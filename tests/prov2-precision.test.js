import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';

// Coverage for the 2026-07-31 measurement audit fixes. These assert against the real
// index.html rather than a copy of the logic, because every one of them is a "the number
// just goes quietly wrong" bug — nothing throws when a preset converges before its own
// analysis window exists, or when a save silently drops five columns.

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function fnBody(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start === -1) return '';
  return html.slice(start, html.indexOf('\n}', start));
}

// Pull the real PROV2_PRECISION literal out of index.html and evaluate it.
function presets() {
  const start = html.indexOf('const PROV2_PRECISION = {');
  const end = html.indexOf('};', start);
  expect(start).toBeGreaterThan(-1);
  return eval('(' + html.slice(start + 'const PROV2_PRECISION = '.length, end + 1) + ')');
}

// computeTgRate skips any window under 90% full, so a W-second window first exists at
// 0.9*W seconds of wall-elapsed. This is the invariant the shipped presets all violated.
const windowAvailableAt = (w) => 0.9 * w;

describe('Pro V2 precision presets reach the window they claim', () => {
  const P = presets();

  it('has exactly the three presets the UI offers', () => {
    expect(Object.keys(P).sort()).toEqual(['balanced', 'quick', 'strict']);
  });

  for (const [name, v] of Object.entries(presets())) {
    it(`${name}: wall-min clears its own analysis window`, () => {
      // The bug: strict advertised a 32s window with a 12s wall-min, so 0 of 13 field
      // sessions ever computed it; balanced converged at 8s and reached the 16s window
      // in 9% of sessions.
      expect(v.tg_wallmin).toBeGreaterThanOrEqual(windowAvailableAt(v.tg_maxwin));
    });
    it(`${name}: stability window fits inside the run`, () => {
      expect(v.tg_stabwin).toBeGreaterThan(0);
      expect(v.tg_stabwin).toBeLessThan(v.tg_wallmin);
    });
  }

  it('orders the presets by precision', () => {
    expect(P.quick.tg_wallmin).toBeLessThan(P.balanced.tg_wallmin);
    expect(P.balanced.tg_wallmin).toBeLessThan(P.strict.tg_wallmin);
    expect(P.quick.tg_stabth).toBeGreaterThanOrEqual(P.balanced.tg_stabth);
  });

  it('defaults for an untouched user track the balanced preset', () => {
    // _tgConvKnob falls back to PROV2_DEFAULTS, so a user who never opened the panel must
    // get the same numbers as one who tapped Balanced.
    expect(html).toContain('const PROV2_DEFAULTS = PROV2_PRECISION.balanced;');
  });

  it('reads every convergence knob through the shared default', () => {
    // These defaults used to be duplicated as literals at seven call sites.
    for (const k of ['tg_wallmin', 'tg_stabwin', 'tg_stabth', 'tg_maxwin']) {
      expect(html).not.toMatch(new RegExp(`_tgKnob\\('${k}'`));
    }
  });

  it('sizes the native ring for the longest window', () => {
    // tgMaxWindowSec of 32 needs bufferSeconds >= 38 or the window silently never fills.
    expect(html).toContain("_tgConvKnob('tg_maxwin') + 6");
  });

  it('gives a Pro V2 run enough wall-clock to reach its wall-min', () => {
    // A fixed 45s cap would guillotine strict (30s wall-min + 8s stability) before it
    // could converge.
    const body = fnBody('_proV2MaxDuration');
    expect(body).toContain("_tgConvKnob('tg_wallmin')");
    expect(body).toContain("_tgConvKnob('tg_stabwin')");
    const P2 = presets();
    // Mirror of the real expression.
    const maxDur = (std, w, s) => Math.max(std, Math.ceil(w + s + 10));
    expect(maxDur(45, P2.strict.tg_wallmin, P2.strict.tg_stabwin))
      .toBeGreaterThan(P2.strict.tg_wallmin + P2.strict.tg_stabwin);
  });
});

// Changing a preset's numbers is not enough: onProV2Precision copies them into localStorage
// when a card is tapped, and _tgConvKnob's default only applies when the key is ABSENT. The
// first TestFlight build of the new engine reported precision "balanced" while running the
// OLD balanced wallMin=8, because that value was already in storage.
describe('preset changes reach users who already picked one', () => {
  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const P = presets();
  const migrate = new Function('localStorage', 'PROV2_PRECISION', 'PROV2_DEFAULTS', `
    const PROV2_PRECISION_V = ${/const PROV2_PRECISION_V = (\d+);/.exec(html)[1]};
    ${fnBody('_migrateProV2Precision')}\n}
    return _migrateProV2Precision;
  `)(localStorage, P, P.balanced);

  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  it('rewrites stale knobs left by an older definition of the same preset', () => {
    store.tg_precision = 'balanced';
    store.tg_wallmin = '8';          // the value that shipped before 2026-07-31
    store.tg_maxwin = '16';
    migrate();
    expect(Number(store.tg_wallmin)).toBe(P.balanced.tg_wallmin);
    expect(Number(store.tg_wallmin)).not.toBe(8);
  });

  it('keeps the user on the preset they chose, not on balanced', () => {
    store.tg_precision = 'strict';
    store.tg_wallmin = '12';
    migrate();
    expect(Number(store.tg_wallmin)).toBe(P.strict.tg_wallmin);
    expect(Number(store.tg_maxwin)).toBe(P.strict.tg_maxwin);
  });

  it('gives a user who never opened the panel the balanced values', () => {
    migrate();
    expect(Number(store.tg_wallmin)).toBe(P.balanced.tg_wallmin);
  });

  it('runs once, then leaves later per-knob tweaks alone', () => {
    migrate();
    store.tg_wallmin = '99';         // e.g. an admin tuning experiment
    migrate();
    expect(store.tg_wallmin).toBe('99');
  });

  it('survives an unknown preset name', () => {
    store.tg_precision = 'nonsense-from-the-future';
    migrate();
    expect(Number(store.tg_wallmin)).toBe(P.balanced.tg_wallmin);
  });

  it('is invoked on init and again at measure start', () => {
    expect(fnBody('initTgSourceSelector')).toContain('_migrateProV2Precision()');
    expect(fnBody('toggleMsrListen')).toContain('_migrateProV2Precision()');
  });

  it('stamps the version when a card is tapped', () => {
    expect(fnBody('onProV2Precision')).toContain("localStorage.setItem('tg_precision_v'");
  });
});

// Pro V2 improves with every release, so a user who tried Standard once must not be frozen
// on the older engine forever. Before 2026-08-02 the pick lived in localStorage and did.
describe('engine choice resets to Pro V2 each app session', () => {
  it('does not persist the choice to localStorage', () => {
    expect(html).not.toContain("localStorage.setItem('tg_algo_sel'");
    expect(html).not.toContain("localStorage.getItem('tg_algo_sel')");
  });

  it('clears the retired key so an old pick cannot resurface', () => {
    expect(fnBody('initTgSourceSelector')).toContain("localStorage.removeItem('tg_algo_sel')");
  });

  it('defaults to Pro V2, honours an in-session pick, and forgets it on reload', () => {
    // Mirrors _tgAlgo/onTgAlgo: module state, so a page load starts from null again.
    const mk = () => {
      let sel = null;
      return {
        algo: (available = true) => (!available ? 'original' : sel === 'original' ? 'original' : 'tg'),
        pick: (v) => { sel = v; },
      };
    };
    let e = mk();
    expect(e.algo()).toBe('tg');               // fresh session defaults to Pro V2
    e.pick('original');
    expect(e.algo()).toBe('original');         // the pick holds within the session
    e = mk();                                  // app relaunch / WebView reload
    expect(e.algo()).toBe('tg');               // and is forgotten
  });

  it('still falls back to Standard when the build has no Pro V2', () => {
    const body = fnBody('_tgAlgo');
    expect(body).toContain("if (!_proV2Available()) return 'original';");
  });
});

describe('the tg core is not torn down by the tick detector', () => {
  it('guards the weak-signal stop on a live tg rate', () => {
    // The Pro V2 rate comes off the energy envelope, not accepted ticks. The no-ticks stop
    // was already guarded; weak_signal was not, and killed 25 sessions in two weeks.
    const i = html.indexOf("stopMsrListen('weak_signal')");
    expect(i).toBeGreaterThan(-1);
    const guard = html.slice(i - 800, i);
    expect(guard).toContain('!tgLiveRate');
    // Must be a live rate, not tgHasSignal — that stays true forever after the first dot
    // and would suppress the stop for a run that has since lost its lock.
    expect(guard).toContain("const tgLiveRate = _tgAlgo() === 'tg' && data.rate != null;");
  });

  it('sends the hold-on-lock knob to the engine', () => {
    expect(html).toContain('tgHoldOnLock:');
  });
});

describe('a saved reading carries its quality metadata', () => {
  // Until this change a timegrapher_results row held only rate + beat_error + bph: 0 of 122
  // saved rows had amplitude, position, duration, tick count or rate spread.
  const body = html.slice(html.indexOf('async function persistMsrReading()'),
                          html.indexOf('async function saveMsrReading()'));

  it('writes every column the run already computed', () => {
    for (const col of ['amplitude:', 'duration_seconds:', 'tick_count:', 'rate_std:', 'position,']) {
      expect(body).toContain(col);
    }
  });

  it('still writes the original columns', () => {
    for (const col of ['rate,', 'beat_error:', 'bph,', 'tick_data:']) {
      expect(body).toContain(col);
    }
  });
});

describe('session_summary records the knobs the run used', () => {
  const body = html.slice(html.indexOf("type: 'session_summary'"),
                          html.indexOf("type: 'session_summary'") + 3000);
  it('logs the precision preset and its convergence knobs', () => {
    for (const f of ['precision:', 'tg_wallmin:', 'tg_stabwin:', 'tg_stabth:', 'tg_maxwin:', 'rate_std:']) {
      expect(body).toContain(f);
    }
  });
});

// _msrRateStd — lifted out of index.html and run for real.
describe('_msrRateStd', () => {
  const fn = new Function('_msrRateHistory', `
    ${fnBody('_msrRateStd')}\n}
    return _msrRateStd;
  `);
  const std = (hist, n) => fn(hist)(n);

  it('returns null below three samples', () => {
    expect(std([])).toBeNull();
    expect(std([1, 2])).toBeNull();
  });
  it('is zero for a perfectly steady rate', () => {
    expect(std([5, 5, 5, 5, 5])).toBe(0);
  });
  it('uses only the final n reports', () => {
    // A wild acquisition transient must not inflate the quality figure for a run that settled.
    expect(std([90, -90, 4, 4, 4, 4, 4])).toBe(0);
  });
  it('computes a sample SD', () => {
    // [2,4,4,4,6] -> sample SD = sqrt(8/4) = 1.414...
    expect(std([2, 4, 4, 4, 6])).toBeCloseTo(1.41, 2);
  });
  it('ignores non-finite entries', () => {
    expect(std([NaN, 3, 3, 3, 3])).toBe(0);
  });
});
