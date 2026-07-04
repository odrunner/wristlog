#!/usr/bin/env python3
"""
tg-style detection prototype vs our phase-lock, on the raw piezo captures we already have.

tg measures the PERIOD directly by FFT-autocorrelation of a whole window (no beat-time
regression), then rate = (nominal_period/measured_period - 1)*86400. This script implements
that core and compares it to our phase-lock (Theil-Sen slope) on the SAME audio, across
window sizes, to see if it's faster/steadier — especially on weak captures where the
phase-lock threw fliers.

Usage: python3 scripts/tg_offline_prototype.py            # analyze recent captures
       python3 scripts/tg_offline_prototype.py 12 90 92   # specific ids
"""
import sys, json, re, base64, subprocess, math
import numpy as np
from scipy.signal import butter, lfilter

def q(sql):
    for _ in range(3):
        out = subprocess.run(["npx","supabase","db","query","--linked",sql],
                             capture_output=True, text=True).stdout
        m = re.search(r'\{.*\}', out, re.S)
        if m: return json.loads(m.group(0))['rows']
    return []

def fetch(ids=None):
    where = ("id IN (%s)"%",".join(map(str,ids))) if ids else "true ORDER BY created_at DESC LIMIT 20"
    rows = q(f"SELECT id,bph,sample_rate,samples_b64 FROM piezo_raw_captures WHERE {where};")
    out=[]
    for r in rows:
        a = np.frombuffer(base64.b64decode(r['samples_b64']), '<i2').astype(np.float64)/32768.0
        out.append((int(r['id']), int(r['bph'] or 28800), float(r['sample_rate']), a))
    return out

def envelope(x, sr):
    # bandpass (tick energy) -> rectify -> lowpass smooth = beat envelope
    bp = butter(2, [200/(sr/2), 5000/(sr/2)], 'band'); y = np.abs(lfilter(*bp, x))
    lp = butter(2, 80/(sr/2), 'low'); return lfilter(*lp, y)

SIGMA_GATE = 3e-4   # reject a window whose per-cycle period estimates disagree (relative std)

def tg_rate(env, sr, bph, gate=True):
    """tg core: FFT-autocorrelation period, refined across lag-cycles -> rate.
    Returns (rate, rel_sigma) or (None, None). Rejects window if rel_sigma > SIGMA_GATE."""
    e = env - env.mean(); n = len(e)
    tap = int(sr*0.1); ramp = 0.5*(1-np.cos(np.linspace(0,np.pi,tap)))
    w = np.ones(n); w[:tap]=ramp; w[-tap:]=ramp[::-1]; e = e*w
    f = np.fft.rfft(e, 2*n); ac = np.fft.irfft(f*np.conj(f))[:n]
    nominal = 7200.0/bph*sr                 # full tic-to-tic period, samples
    tol = sr*0.02
    ests=[]; cyc=1
    while nominal*cyc < n*0.66:
        lo=int(nominal*cyc-tol); hi=int(nominal*cyc+tol)
        if hi>=n or lo<1: break
        k=lo+int(np.argmax(ac[lo:hi]))
        a0,b0,c0=ac[k-1],ac[k],ac[k+1]; d=a0-2*b0+c0
        fr=0.5*(a0-c0)/d if abs(d)>1e-9 else 0
        ests.append((k+fr)/cyc); cyc+=1
    if not ests: return None, None, None
    period = float(np.mean(ests))
    rel_sigma = float(np.std(ests)/period) if len(ests)>1 else 0.0
    if gate and rel_sigma > SIGMA_GATE: return None, rel_sigma, period
    return (nominal/period - 1)*86400, rel_sigma, period

def tg_fold(env, period):
    """Averaged beat: fold the envelope at the period, trimmed mean per bin (drop loudest 20%)."""
    P = int(round(period)); n = len(env)//P
    if n < 4: return None
    M = np.array([env[i*P:(i+1)*P] for i in range(n)])   # n beats × P
    keep = max(1, int(n*0.8))
    fold = np.sort(M, axis=0)[:keep].mean(axis=0)
    return fold - np.median(fold)

def tg_amplitude(fold, period, la=52.0):
    """Amplitude (deg) from the escapement pulse-pair + lift angle. None if not plausible."""
    P = len(fold); glob = fold.max()
    thr = max(0.01*glob, 1.4*np.median(np.abs(fold)))
    def pulse_before(marker):
        for d in range(int(P/8), 2, -1):
            if fold[(marker - d) % P] > thr: return d      # Δt (samples) pulse→marker
        return None
    tic = int(np.argmax(fold))
    lo=(tic+int(P*0.4))%P; hi=(tic+int(P*0.6))%P
    idx=list(range(lo,hi)) if lo<hi else list(range(lo,P))+list(range(0,hi))
    toc = max(idx, key=lambda i: fold[i])
    amps=[]
    for mk in (tic, toc):
        dt = pulse_before(mk)
        if dt is None: return None
        s = math.sin(math.pi*dt/period)
        if s <= 0: return None
        amps.append(la/(2*s))
    if not (135<=amps[0]<=360 and 135<=amps[1]<=360 and abs(amps[0]-amps[1])<=60): return None
    return sum(amps)/2

def phaselock_rate(x, sr, bph):
    """Our approach (compact): band-pass envelope -> phase-locked peaks -> Theil-Sen slope."""
    RING=12000.0; SUB=max(1,int(round(sr/RING))); EXP=RING/(bph/3600.0); CALIB=int(RING*2)
    bp=butter(2,[150/(sr/2),5000/(sr/2)],'band'); y=np.abs(lfilter(*bp,x))
    ncut=(len(y)//SUB)*SUB; e=y[:ncut].reshape(-1,SUB).max(axis=1)
    cf=math.exp(-1/((6/1000.)*RING)); o=np.empty_like(e); s=0.
    for i in range(len(e)): s=cf*s+(1-cf)*e[i]; o[i]=s
    e=o
    if len(e)<CALIB+int(EXP*3): return None
    i0=CALIB+int(np.argmax(e[CALIB:CALIB+int(EXP*1.5)])); last=float(i0); B=[last]
    while last+EXP*1.08<len(e):
        w0=int(last+EXP-EXP*.08); w1=int(last+EXP+EXP*.08)
        if w1>=len(e): break
        k=int(np.argmax(e[w0:w1]))+w0; B.append(float(k)); last=float(k)
    bt=[b/RING for b in B]; prev=None;pa=0;ph=0;cum=0;reg=[];tot=0
    for t in bt:
        if prev is None: prev=t; continue
        intr=(t-prev)*RING; prev=t
        if intr/EXP<.85 or intr/EXP>1.15: continue
        pa+=intr; ph+=1
        if ph==1: continue
        pd=(EXP*2-pa)/RING*1000; pa=0;ph=0;tot+=1
        if tot<=10: continue
        cum+=pd; reg.append((t,cum))
    if len(reg)<10: return None
    sl=sorted((reg[j][1]-reg[i][1])/(reg[j][0]-reg[i][0]) for i in range(len(reg)) for j in range(i+1,len(reg)) if reg[j][0]-reg[i][0]>.01)
    return sl[len(sl)//2]*86.4 if sl else None

def main():
    ids=[int(a) for a in sys.argv[1:]] or None
    caps=fetch(ids)
    print("id    bph    rawAmp  | phaseLock | tg per window (2s/4s/8s/full)      | CHOSEN | AMP°")
    print("-"*96)
    for cid,bph,sr,a in caps:
        rawamp=np.abs(a).max()
        pl=phaselock_rate(a,sr,bph)
        env=envelope(a,sr); dur=len(a)/sr
        wr=[]
        for W in [2,4,8,dur]:
            seg=env[-int(W*sr):] if W<dur else env
            r=tg_rate(seg,sr,bph)[0] if len(seg)>int(sr*1.5) else None
            wr.append(r)
        # tg display value = longest window that passed the σ-gate
        best=next((r for r in reversed(wr) if r is not None and abs(r)<200), None)
        wr=wr+[best]
        # amplitude on the full window
        _,_,period = tg_rate(env,sr,bph,gate=False)
        ampdeg=None
        if period:
            fold=tg_fold(env,period)
            if fold is not None: ampdeg=tg_amplitude(fold,period)
        fmt=lambda r: ('%+6.1f'%r if r is not None and abs(r)<400 else '  --  ')
        print("%-5d %-6d %.4f | %s   | %s %s %s %s | %s | %s"%(
            cid,bph,rawamp, fmt(pl), fmt(wr[0]),fmt(wr[1]),fmt(wr[2]),fmt(wr[3]), fmt(wr[4]),
            ('%.0f'%ampdeg if ampdeg is not None else ' -- ')))

if __name__=='__main__': main()
