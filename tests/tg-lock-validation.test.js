import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// TG lock validation (docs/spec-tg-lock-validation.md) — rides DARK in the 2.5 build.
//
// The 2026-08-15 deep dive found tg's failures are bimodal lock acquisition: good
// locks repeat at 2.5 s/d back-to-back, bad locks ship confidently wrong rates
// (226 wild "converged" results in the 2.4 era) because every stability signal the
// engine has is computed from overlapping reads of one ring — a wrong lock confirms
// itself. T1 confirms a lock against a DISJOINT audio segment; T2 makes the harmonic
// guard refuse instead of median-shipping; T3 feeds σ-gate health into convergence;
// T4 stops the tick detector's recal loop from tearing down a session tg is still
// evaluating.
//
// THE CONTRACT THAT MATTERS MOST HERE: every knob's ship default reproduces 2.4
// behaviour exactly, so the submitted binary is behaviourally identical until the
// knobs are flipped server-side. If a default in this file's assertions ever fails,
// the build would go out with an engine change LIVE instead of dark.
//
// Source assertions — this repo has Command Line Tools only, no Xcode, so the Swift
// cannot be executed here. They guard the contract, not the wiring.

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const engine = read('ios', 'Wrotate', 'Wrotate', 'TimegrapherEngine.swift');
const bridge = read('ios', 'Wrotate', 'Wrotate', 'TimegrapherBridge.swift');

const swiftFn = (src, signaturePrefix) => {
  const start = src.indexOf(signaturePrefix);
  if (start < 0) return null;
  let depth = 0, seen = false;
  for (let p = src.indexOf('{', start); p < src.length; p++) {
    if (src[p] === '{') { depth++; seen = true; }
    else if (src[p] === '}') { depth--; if (seen && depth === 0) return src.slice(start, p + 1); }
  }
  return null;
};

describe('dark-ship defaults reproduce 2.4 behaviour exactly', () => {
  it('T1 confirm band ships OFF for ENFORCEMENT, but the shadow always runs', () => {
    expect(engine).toMatch(/private var tgConfirmBand = 999\.0/);
    const fn = swiftFn(engine, 'private func tgUpdateLockConfirmation(');
    // No knob short-circuit: the state machine must produce lc=/lr= verdicts on every
    // live session (the silent field A/B). Enforcement is gated at the convergence
    // check instead — see the next assertion.
    expect(fn).not.toContain('guard tgConfirmBand < 900');
    // The shadow judges with the staged band, never the raw knob (999 would confirm
    // everything and make the shadow data-free); a LOWERED knob tightens both.
    expect(fn).toContain('let shadowBand = min(tgConfirmBand, 6.0)');
    expect(fn).toContain('abs(r1 - r0) <= shadowBand');
    // The only behavioural consumer of tgLockConfirmed at dark defaults is knob-gated:
    expect(engine).toContain('if tgConfirmBand < 900 && !tgLockConfirmed { isStable = false }');
  });

  it('T2 guard mode ships 0 = median fallback (2.4 bit for bit)', () => {
    expect(engine).toMatch(/private var tgGuardMode = 0/);
  });

  it('T3 gate-reject ceiling ships 1.0 (a fraction can never exceed it)', () => {
    expect(engine).toMatch(/private var tgGateMaxRej = 1\.0/);
    // and the convergence block only consults it when lowered
    expect(engine).toContain('if tgGateMaxRej < 1.0, let rf = tgGateRejFraction(), rf > tgGateMaxRej { isStable = false }');
  });

  it('T4 acquire runway ships 15 s and the recal suppression requires it RAISED', () => {
    expect(engine).toMatch(/private var tgAcquireMaxSec = 15\.0/);
    expect(engine).toContain('tgAcquireMaxSec > 15.0');
  });
});

describe('T1 — disjoint-segment lock confirmation', () => {
  const fn = swiftFn(engine, 'private func tgUpdateLockConfirmation(');

  it('exists and is driven from computeTgRate with this pass\'s window rates', () => {
    expect(fn).toBeTruthy();
    const ctr = swiftFn(engine, 'private func computeTgRate(');
    expect(ctr).toContain('tgUpdateLockConfirmation(chosen: chosen, rates: rates');
  });

  it('waits until the 8 s confirm window holds only post-lock audio (zero overlap)', () => {
    expect(fn).toContain('let confirmWin = 8.0');
    expect(fn).toContain('Double(energyRingAbs - tgPendingLockAbs) >= confirmWin * ringSampleRate');
    expect(fn).toContain('rates.first(where: { $0.secs == confirmWin })');
  });

  it('confirms within band; on disagreement re-pends on the NEWER estimate', () => {
    expect(fn).toContain('if abs(r1 - r0) <= shadowBand');
    expect(fn).toContain('tgLockConfirmed = true');
    // the failed lock must not survive as the pending candidate
    expect(fn).toContain('tgPendingLockRate = r1; tgPendingLockAbs = energyRingAbs');
    expect(fn).toContain('[TGALGO lock-reject]');
    expect(fn).toContain('[TGALGO lock-confirm]');
  });

  it('convergence cannot be GAINED on an unconfirmed lock (loss unaffected)', () => {
    expect(engine).toContain('if useTgAlgo && isStable && !wasStable {');
    expect(engine).toContain('if tgConfirmBand < 900 && !tgLockConfirmed { isStable = false }');
  });
});

describe('T2 — harmonic guard refuses instead of median-shipping', () => {
  const ctr = swiftFn(engine, 'private func computeTgRate(');

  it('mode 1: disagreement (n >= 2) returns nil and keeps acquiring', () => {
    expect(ctr).toContain('if tgGuardMode >= 1, rates.count >= 2, disagree {');
    expect(ctr).toContain('-> nil');
  });

  it('a refusal clears an UNCONFIRMED pending lock but never a confirmed one', () => {
    expect(ctr).toContain('if !tgLockConfirmed { tgPendingLockRate = nil; tgPendingLockAbs = -1 }');
  });

  it('mode 0 median fallback survives verbatim (n >= 3 only, "-> median")', () => {
    expect(ctr).toContain('if rates.count >= 3 && disagree {');
    expect(ctr).toContain('-> median');
    expect(ctr).toContain('chosen = median');
  });
});

describe('T3 — σ-gate health is recorded per attempt, not just per reject', () => {
  it('tgPeriod records both outcomes', () => {
    const fn = swiftFn(engine, 'private func tgPeriod(');
    expect(fn).toContain('tgRecordGateEvent(true)');
    expect(fn).toContain('tgRecordGateEvent(false)');
  });

  it('reject fraction needs a minimum sample and a 10 s pruning horizon', () => {
    const rec = swiftFn(engine, 'private func tgRecordGateEvent(');
    expect(rec).toContain('ringSampleRate * 10');
    const frac = swiftFn(engine, 'private func tgGateRejFraction(');
    expect(frac).toContain('tgGateEvents.count >= 3');
  });
});

describe('T4 — pre-lock runway', () => {
  it('a runway recal reruns calibration but does not consume a teardown attempt', () => {
    expect(engine).toContain('if !tgRunway { recalibrationsDone += 1 }');
    expect(engine).toContain('[tg-runway: not counted]');
  });

  it('runway requires tg actively evaluating within the last 5 s', () => {
    const fn = swiftFn(engine, 'private func tgActivelyEvaluating(');
    expect(fn).toContain('ringSampleRate * 5.0');
    expect(engine).toMatch(/tgRunway = useTgAlgo && tgAcquireMaxSec > 15\.0\s*&& elDbg < tgAcquireMaxSec && tgActivelyEvaluating\(\)/);
  });
});

describe('surface + attribution plumbing', () => {
  it('Update carries tgSignalQuality/tgAcquiring and the single constructor passes them', () => {
    expect(engine).toContain('let tgSignalQuality: String?');
    expect(engine).toContain('let tgAcquiring: Bool');
    expect(engine).toContain('tgSignalQuality: sigQuality');
    expect(engine).toContain('tgAcquiring: acquiring');
    // exactly one Update construction site — a second one would fail the real compile
    expect(engine.match(/= Update\(/g)).toHaveLength(1);
  });

  it('bridge forwards the four knobs and exposes both update fields to JS', () => {
    for (const k of ['tgConfirmBand', 'tgGuardMode', 'tgGateMaxRej', 'tgAcquireMax']) {
      expect(bridge).toContain(`body["${k}"]`);
    }
    expect(bridge).toContain('"tgSignalQuality": update.tgSignalQuality as Any');
    expect(bridge).toContain('"tgAcquiring": update.tgAcquiring');
  });

  it('TGTUNE echoes every knob so the weekly review can segment sessions by flip state', () => {
    for (const k of ['confirmBand=', 'guardMode=', 'gateMaxRej=', 'acquireMax=']) {
      expect(engine).toContain(k);
    }
  });

  it('TGALGO line carries lock state (lc=/lr=) and gate attempts (ga=)', () => {
    expect(engine).toContain('ga=\\(tgGateAttempts)');
    expect(engine).toContain('lc=\\(tgLockConfirmed ? 1 : 0)');
    expect(engine).toContain('lr=\\(tgLockRejects)');
  });

  it('session reset clears the whole lock/gate state machine', () => {
    expect(engine).toContain('tgPendingLockRate = nil; tgPendingLockAbs = -1; tgLockConfirmed = false; tgLockRejects = 0');
    expect(engine).toContain('tgGateEvents.removeAll(keepingCapacity: true); tgGateAttempts = 0');
  });

  it('index.html sends all four knobs with DARK defaults (localStorage-overridable)', () => {
    const html = read('index.html');
    expect(html).toContain("tgConfirmBand: _tgKnob('tg_confirmband', 999)");
    expect(html).toContain("tgGuardMode: Number(safeLS.get('tg_guardmode') ?? 0)");
    expect(html).toContain("tgGateMaxRej: _tgKnob('tg_gatemaxrej', 1)");
    expect(html).toContain("tgAcquireMax: _tgKnob('tg_acquiremax', 15)");
  });

  it('the admin knob panel exposes all four (personal-stage flip UI)', () => {
    const html = read('index.html');
    for (const id of ['tg-knob-confirmband', 'tg-knob-guardmode', 'tg-knob-gatemaxrej', 'tg-knob-acquiremax']) {
      expect(html).toContain(`id="${id}"`);       // input exists
      expect(html).toContain(`set('${id}'`);      // and is populated from localStorage
    }
    // guardmode 0 (= back to 2.4 behaviour) must be settable: onTgKnob rejects 0
    expect(html).toContain("onTgKnob0('tg_guardmode'");
    expect(html).toContain('function onTgKnob0(k, v) { if (v !== \'\' && Number(v) >= 0)');
  });

  it('applyTuning validates knob ranges (a bad admin value cannot brick measurement)', () => {
    expect(engine).toContain('if let v = tgConfirmBand, v >= 1 { self.tgConfirmBand = v }');
    expect(engine).toContain('if let v = tgGuardMode, v >= 0, v <= 1 { self.tgGuardMode = v }');
    expect(engine).toContain('if let v = tgGateMaxRej, v > 0, v <= 1 { self.tgGateMaxRej = v }');
    expect(engine).toContain('if let v = tgAcquireMax, v >= 10, v <= 120 { self.tgAcquireMaxSec = v }');
  });
});
