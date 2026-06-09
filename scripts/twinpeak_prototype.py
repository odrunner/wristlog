#!/usr/bin/env python3
"""Twin-peak detection prototype: amplitude-pick (current) vs phase-locked (proposed).
Reads a mono recording of a ticking watch, prints interval std + beat error for each method.
Validates the phase-locked fix offline. Usage: python3 scripts/twinpeak_prototype.py <wav_or_m4a> <bph>"""
import sys, subprocess, tempfile, os
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt, find_peaks

def load(path):
    if path.lower().endswith('.wav'):
        wav = path
    else:
        wav = tempfile.mktemp(suffix='.wav')
        subprocess.run(['ffmpeg', '-y', '-i', path, '-ac', '1', '-ar', '48000', wav],
                       check=True, capture_output=True)
    sr, y = wavfile.read(wav)
    return sr, y.astype(float)

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else 'docs/superpowers/specs/kurono1-reference.m4a'
    bph = int(sys.argv[2]) if len(sys.argv) > 2 else 28800
    sr, y = load(path); y -= y.mean()
    sos = butter(4, [1500, 9000], btype='band', fs=sr, output='sos'); yb = sosfiltfilt(sos, y)
    env = np.abs(yb); w = int(sr * 0.0007); env = np.convolve(env, np.ones(w) / w, mode='same'); env /= env.max()
    thr = np.median(env) + 3 * np.median(np.abs(env - np.median(env)))
    EXP = 3600.0 / bph * 1000  # ms per beat
    cand, _ = find_peaks(env, height=thr * 0.5, distance=int(sr * 0.0015)); ct = cand / sr

    def metrics(times):
        t = np.array(sorted(times)); d = np.diff(t) * 1000
        d = d[(d > EXP * 0.5) & (d < EXP * 1.6)]
        even, odd = d[0::2], d[1::2]; m = min(len(even), len(odd))
        be = abs(np.mean(even[:m]) - np.mean(odd[:m])) if m else float('nan')
        return np.std(d), be, len(t)

    amppk, _ = find_peaks(env, height=thr, distance=int(sr * 0.090)); A = metrics(amppk / sr)
    P = EXP / 1000; locked = [ct[0]]; nxt = ct[0] + P
    while nxt < ct[-1] + P:
        near = ct[(ct > nxt - 0.4 * P) & (ct < nxt + 0.4 * P)]
        if len(near):
            pick = near[np.argmin(np.abs(near - nxt))]; locked.append(pick); nxt = pick + P
        else:
            nxt += P
    B = metrics(locked)
    print(f'file={os.path.basename(path)} bph={bph} expected_interval={EXP:.3f}ms')
    print(f'A amplitude-pick (current): interval_std={A[0]:.2f}ms beat_error={A[1]:.2f}ms n={A[2]}')
    print(f'B phase-locked (proposed):  interval_std={B[0]:.2f}ms beat_error={B[1]:.2f}ms n={B[2]}')

if __name__ == '__main__':
    main()
