import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// Audio-interruption recovery (2.5). Before this, TimegrapherEngine installed its tap
// with NO interruption/route/config observers — a call, Siri, an alarm, or AirPods
// connecting mid-measurement killed the tap, isRunning stayed true, and the user
// watched a frozen "listening" spinner forever. Field rate: ~4% of sessions show the
// audio clock >= 20 s behind wall clock; worst case froze at 80 s of audio across 41
// real minutes. (PiezoEngine has had a route observer since day one.)
//
// Source assertions — no Xcode on this Mac; they guard the contract, not the wiring.

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

describe('observers cover all three ways iOS kills a tap', () => {
  it('interruption, route change, and engine config change are all observed', () => {
    const fn = swiftFn(engine, 'private func installAudioObservers(');
    expect(fn).toBeTruthy();
    expect(fn).toContain('AVAudioSession.interruptionNotification');
    expect(fn).toContain('AVAudioSession.routeChangeNotification');
    expect(fn).toContain('.AVAudioEngineConfigurationChange');
  });

  it('start() installs them; stop() and deinit remove them', () => {
    expect(engine).toContain('isRunning = true\n            installAudioObservers()');
    const stop = swiftFn(engine, 'func stop() -> Result {');
    expect(stop).toContain('removeAudioObservers()');
    expect(engine).toContain('deinit { removeAudioObservers() }');
  });

  it('installing twice cannot double-subscribe (remove-first idiom)', () => {
    const fn = swiftFn(engine, 'private func installAudioObservers(');
    expect(fn.indexOf('removeAudioObservers()')).toBeGreaterThan(-1);
    expect(fn.indexOf('removeAudioObservers()')).toBeLessThan(fn.indexOf('addObserver'));
  });
});

describe('interruption lifecycle', () => {
  const began = swiftFn(engine, 'private func handleAudioInterruption(');

  it('.began surfaces to JS instead of pretending to listen', () => {
    expect(began).toContain('onInterruption?("began")');
  });

  it('.ended attempts the rebuild even without .shouldResume (worst case JS gets "failed")', () => {
    expect(began).toContain('rebuildAudioAfterInterruption(reason: "interruption-ended")');
  });

  it('route changes that swap the mic rebuild the tap — but NOT .categoryChange', () => {
    const fn = swiftFn(engine, 'private func handleRouteChange(');
    expect(fn).toContain('.oldDeviceUnavailable, .newDeviceAvailable');
    expect(fn).toContain('rebuildAudioAfterInterruption(');
    // Our own setCategory at start() posts .categoryChange, and main-queue delivery
    // lands after the observers install — reacting to it caused one spurious rebuild
    // (~1-2s re-calibration) per session in the 2026-08-15 TestFlight UAT
    // (route-change-3 in every session log).
    expect(fn).not.toContain('.categoryChange:');
    expect(fn).not.toMatch(/case[^\n]*\.categoryChange/);
  });
});

describe('rebuild correctness', () => {
  const fn = swiftFn(engine, 'private func rebuildAudioAfterInterruption(');

  it('discards pre-gap audio so no analysis window spans the seam', () => {
    expect(fn).toContain('energyRingCount = 0');
    expect(fn).toContain('tgRateCached = nil');
  });

  it('a changed input rate re-derives filters, ring, and capacity (AirPods mic case)', () => {
    expect(fn).toContain('let rateChanged = abs(format.sampleRate - actualSampleRate) > actualSampleRate * 0.01');
    expect(fn).toContain('hpFilters = hpCutoffs.map');
    expect(fn).toContain('energyRingCapacity = Int(rsr * Double(bufferDurationSec))');
  });

  it('a confirmed T1 lock survives the gap; an unconfirmed pending one does not', () => {
    expect(fn).toContain('if !tgLockConfirmed { tgPendingLockRate = nil; tgPendingLockAbs = -1 }');
    expect(fn).not.toContain('tgLockConfirmed = false');
  });

  it('the audio-clock ppm estimator restarts (its anchors are pre-gap)', () => {
    expect(fn).toContain('clkHaveFirst = false');
  });

  it('tick detection recalibrates rather than resuming a stale phase', () => {
    expect(fn).toContain('tickDetectionActive = false');
    expect(fn).toContain('activateTickDetection(ringSampleRate: ringSampleRate)');
  });

  it('resume and failure both surface to JS and the tick log', () => {
    expect(fn).toContain('[TGAUDIO RESUME]');
    expect(fn).toContain('[TGAUDIO RESUME FAILED]');
    expect(fn).toContain('onInterruption?("resumed")');
    expect(fn).toContain('onInterruption?("failed")');
  });
});

describe('bridge exposure', () => {
  it('forwards the lifecycle as an audioInterruption event', () => {
    expect(bridge).toContain('self.engine.onInterruption = ');
    expect(bridge).toContain('"event": "audioInterruption", "state": state');
  });
});
