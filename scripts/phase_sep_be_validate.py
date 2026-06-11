#!/usr/bin/env python3
"""Validate the phase-separated beat-error estimator BEFORE the Swift port.

Two parts:
  1. SYNTHETIC: inject known beat error + jitter + dropped impulses, confirm the
     skip-robust parity estimator recovers it (and that naive even/odd parity and
     median|dev| do NOT). This is the deterministic correctness gate.
  2. REAL AUDIO: run on the Kurono twin-peak reference recording and compare the
     phase-separated estimate to the folded-envelope estimate (the broken one).

Estimator (matches spec docs/superpowers/specs/2026-06-10-phase-separated-beat-error.md):
  BE = |mean(dev | phase==0) - mean(dev | phase==1)|
  phase = cumulative-expected-impulse-count & 1   (skip-robust)
  only steps==1 intervals feed the buckets.
"""
import sys, subprocess, tempfile, os
import numpy as np

EXP_MS = lambda bph: 3600.0 / bph * 1000.0   # ms per impulse (half-beat)


# ── the estimator under test ────────────────────────────────────────────────
def phase_sep_be(impulse_times_ms, expected_ms, min_per_bucket=8):
    """Skip-robust phase-separated beat error from a list of impulse times (ms)."""
    t = np.asarray(impulse_times_ms, float)
    intervals = np.diff(t)
    phase_idx = 0
    buckets = ([], [])
    for iv in intervals:
        steps = max(1, int(round(iv / expected_ms)))
        phase_idx += steps
        if steps == 1:
            dev = expected_ms - iv          # same sign convention as Swift (:719)
            buckets[phase_idx & 1].append(dev)
    if len(buckets[0]) < min_per_bucket or len(buckets[1]) < min_per_bucket:
        return None, (len(buckets[0]), len(buckets[1]))
    be = abs(np.mean(buckets[0]) - np.mean(buckets[1]))
    return round(be, 3), (len(buckets[0]), len(buckets[1]))


def naive_even_odd_be(impulse_times_ms, expected_ms):
    """The prototype's original method: index-parity even/odd (NOT skip-robust)."""
    d = np.diff(np.asarray(impulse_times_ms, float))
    d = d[(d > expected_ms * 0.5) & (d < expected_ms * 1.6)]
    even, odd = d[0::2], d[1::2]
    m = min(len(even), len(odd))
    return round(abs(np.mean(even[:m]) - np.mean(odd[:m])), 3) if m else None


def median_abs_dev_be(impulse_times_ms, expected_ms):
    """The rejected knownBeatError approach: median|dev| (×2). Shown to fail at low BE."""
    d = np.diff(np.asarray(impulse_times_ms, float))
    d = d[(d > expected_ms * 0.5) & (d < expected_ms * 1.6)]
    devs = np.abs(expected_ms - d)
    return round(2 * float(np.median(devs)), 3) if len(devs) else None


# ── part 1: synthetic ───────────────────────────────────────────────────────
def synth(bph, be_ms, jitter_ms, n=600, drop_frac=0.0, seed=1):
    """Build impulse times with a known beat error. tock late by be/2 each beat."""
    rng = np.random.default_rng(seed)
    H = EXP_MS(bph)
    times = []
    t = 0.0
    for k in range(n):
        times.append(t + rng.normal(0, jitter_ms))
        t += H + (be_ms / 2 if k % 2 == 0 else -be_ms / 2)   # alternating ±be/2
    times = np.array(times)
    if drop_frac > 0:                                         # randomly drop impulses
        keep = rng.random(n) > drop_frac
        keep[0] = True
        times = times[keep]
    return times


def run_synth():
    print("=== SYNTHETIC (known beat error) ===")
    print(f"{'case':28} {'true':>6} {'phase_sep':>10} {'naive_eo':>9} {'med|dev|':>9}")
    cases = [
        ("clean BE=0.2 jit=0.15", 28800, 0.2, 0.15, 0.0),
        ("clean BE=0.6 jit=0.15", 28800, 0.6, 0.15, 0.0),
        ("clean BE=2.0 jit=0.20", 28800, 2.0, 0.20, 0.0),
        ("BE=0.2 + 10% drops",    28800, 0.2, 0.15, 0.10),
        ("BE=0.6 + 20% drops",    28800, 0.6, 0.15, 0.20),
        ("BE=0.0 (none) jit=0.2", 28800, 0.0, 0.20, 0.0),
    ]
    ok = True
    for name, bph, be, jit, drop in cases:
        t = synth(bph, be, jit, drop_frac=drop)
        H = EXP_MS(bph)
        ps, cnt = phase_sep_be(t, H)
        eo = naive_even_odd_be(t, H)
        md = median_abs_dev_be(t, H)
        print(f"{name:28} {be:>6.2f} {str(ps):>10} {str(eo):>9} {str(md):>9}   buckets={cnt}")
        # gate: phase_sep within 0.1 ms of truth on every case
        if ps is None or abs(ps - be) > 0.1:
            ok = False
    print(f"\nphase_sep PASS within ±0.1ms on all cases: {ok}")
    print("(note med|dev| inflates at low BE — the reason knownBeatError was rejected)\n")
    return ok


# ── part 2: real audio (Kurono twin-peak) ───────────────────────────────────
def load(path):
    from scipy.io import wavfile
    if not path.lower().endswith('.wav'):
        wav = tempfile.mktemp(suffix='.wav')
        subprocess.run(['ffmpeg', '-y', '-i', path, '-ac', '1', '-ar', '48000', wav],
                       check=True, capture_output=True)
        path = wav
    sr, y = wavfile.read(path)
    return sr, y.astype(float)


def run_real(path, bph=28800):
    from scipy.signal import butter, sosfiltfilt, find_peaks
    print(f"=== REAL AUDIO: {os.path.basename(path)} (bph={bph}) ===")
    sr, y = load(path); y -= y.mean()
    sos = butter(4, [1500, 9000], btype='band', fs=sr, output='sos'); yb = sosfiltfilt(sos, y)
    env = np.abs(yb); w = int(sr * 0.0007); env = np.convolve(env, np.ones(w)/w, mode='same'); env /= env.max()
    thr = np.median(env) + 3 * np.median(np.abs(env - np.median(env)))
    EXP = EXP_MS(bph)
    cand, _ = find_peaks(env, height=thr * 0.5, distance=int(sr * 0.0015)); ct = cand / sr * 1000.0  # ms

    # phase-lock: step by EXP, take candidate crest closest to predicted time
    P = EXP; locked = [ct[0]]; nxt = ct[0] + P
    while nxt < ct[-1] + P:
        near = ct[(ct > nxt - 0.4*P) & (ct < nxt + 0.4*P)]
        if len(near):
            pick = near[np.argmin(np.abs(near - nxt))]; locked.append(pick); nxt = pick + P
        else:
            nxt += P
    locked = np.array(locked)

    # folded-envelope BE (the broken estimator), mirrors detectTickEvents
    period = int(round(EXP/1000.0 * sr))
    folded = np.zeros(period)
    for i in range(len(env)):
        folded[i % period] += env[i]
    sm = np.convolve(folded, np.ones(max(1, period//50))/max(1, period//50), mode='same')
    p1 = int(np.argmax(sm)); excl = period//4
    mask = (np.minimum(np.abs(np.arange(period)-p1), period-np.abs(np.arange(period)-p1)) > excl)
    p2 = int(np.argmax(np.where(mask, sm, -1)))
    g1 = (p2 - p1) % period; g2 = period - g1
    folded_be = abs(g1 - g2) / sr * 1000.0

    ps, cnt = phase_sep_be(locked, EXP)
    eo = naive_even_odd_be(locked, EXP)
    md = median_abs_dev_be(locked, EXP)
    print(f"impulses locked: {len(locked)}   buckets={cnt}")
    print(f"  folded-envelope BE (current/broken): {folded_be:.2f} ms")
    print(f"  phase-separated BE (skip-robust):    {ps} ms")
    print(f"  naive even/odd BE:                   {eo} ms")
    print(f"  median|dev|×2 (rejected):            {md} ms")
    print("  Weishi reference for Kurono: ~0.2 ms")
    print("  -> folded is fooled by the twin-peak; phase-sep should be small/sane.\n")


if __name__ == '__main__':
    ok = run_synth()
    ref = sys.argv[1] if len(sys.argv) > 1 else 'docs/superpowers/specs/kurono1-reference.m4a'
    if os.path.exists(ref):
        run_real(ref)
    sys.exit(0 if ok else 1)
