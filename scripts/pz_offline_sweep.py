#!/usr/bin/env python3
"""
Offline parameter sweep for the piezo timegrapher.

Captures are uploaded by the iOS app to the Supabase `piezo_raw_captures` table
(raw pickup audio, decimated ~24kHz Int16, ~12s) whenever a piezo measurement runs.
This script pulls one, replays the exact PiezoEngine DSP, and reports the rate plus
a small sweep of band-pass / smoothing / search-window so we can pick parameters
offline instead of rebuilding the app per combo.

Usage:
  # latest capture:
  python3 scripts/pz_offline_sweep.py
  # specific row:
  python3 scripts/pz_offline_sweep.py --id 1
  # from a local float32 file (24kHz) at a known BPH:
  python3 scripts/pz_offline_sweep.py --file /tmp/pz_raw.f32 --bph 28800 --rate 24000

Requires: numpy, scipy, and `npx supabase` linked (run from the repo root).
"""
import sys, os, json, re, base64, struct, math, argparse, subprocess
import numpy as np
from scipy.signal import lfilter

RING = 12000.0  # engine ring rate

def fetch_capture(cap_id):
    where = f"id={cap_id}" if cap_id else "true ORDER BY created_at DESC"
    sql = f"SELECT id,bph,sample_rate,n_samples,samples_b64 FROM piezo_raw_captures WHERE {where} LIMIT 1;"
    out = subprocess.run(["npx","supabase","db","query","--linked",sql],
                         capture_output=True, text=True).stdout
    m = re.search(r'\{.*\}', out, re.S)
    row = json.loads(m.group(0))['rows'][0]
    raw = base64.b64decode(row['samples_b64'])
    a = np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768.0
    return a, float(row['sample_rate']), int(row['bph'] or 28800), row['id']

def load_file(path, sr, bph):
    n = os.path.getsize(path)//4
    a = np.array(struct.unpack('<%df'%n, open(path,'rb').read()))
    return a, sr, bph, 'file'

def rbj_bandpass(low, high, sr):
    f0 = math.sqrt(low*high); bw = max(0.1, math.log2(high/low)); w0 = 2*math.pi*f0/sr
    s=math.sin(w0); c=math.cos(w0); al = s*math.sinh(0.5*math.log(2)*bw*w0/s); a0=1+al
    return [al/a0,0,-al/a0],[1,-2*c/a0,(1-al)/a0]

def envelope(raw, sr, low, high, smooth_ms):
    b,a = rbj_bandpass(low,high,sr); y = np.abs(lfilter(b,a,raw))
    sub = max(1, int(round(sr/RING))); n = (len(y)//sub)*sub
    e = y[:n].reshape(-1,sub).max(axis=1)
    if smooth_ms > 0:
        cf = math.exp(-1.0/((smooth_ms/1000.0)*RING)); o = np.empty_like(e); s=0.0
        for i in range(len(e)): s = cf*s + (1-cf)*e[i]; o[i]=s
        e = o
    return e

def theilsen(xs, ys):
    n=len(xs)
    if n<10: return None
    if n>120:
        idx=[int(i*(n-1)/119) for i in range(120)]; xs=[xs[i] for i in idx]; ys=[ys[i] for i in idx]
    sl=[]
    for i in range(len(xs)):
        for j in range(i+1,len(xs)):
            dx=xs[j]-xs[i]
            if dx>0.01: sl.append((ys[j]-ys[i])/dx)
    sl.sort(); return sl[len(sl)//2] if sl else None

def phaselock(e, EXP, win, outlier=0.25):
    CALIB=int(RING*2)
    if len(e) < CALIB+int(EXP*3): return None
    i0=CALIB+int(np.argmax(e[CALIB:CALIB+int(EXP*1.5)])); beats=[float(i0)]; last=float(i0)
    while last+EXP*(1+win) < len(e):
        c=last+EXP; w0=int(c-EXP*win); w1=int(c+EXP*win); seg=e[w0:w1]; k=int(np.argmax(seg))+w0
        if w0<k<w1-1:
            a=e[k-1];b=e[k];cc=e[k+1];d=a-2*b+cc; fr=0.5*(a-cc)/d if abs(d)>1e-12 else 0
        else: fr=0
        bt=k+max(-0.5,min(0.5,fr)); beats.append(bt); last=bt
    bt=[b/RING for b in beats]; prev=None;pa=0;ph=0;cum=0;reg=[];pd=[];first=0
    for t in bt:
        if prev is None: prev=t; continue
        intr=(t-prev)*RING; prev=t; ratio=intr/EXP
        if ratio<1-outlier or ratio>1+outlier: continue
        pa+=intr; ph+=1
        if ph==1: first=t; continue
        pdev=(EXP*2-pa)/RING*1000; pa=0;ph=0; cum+=pdev; reg.append(((first+t)/2,cum)); pd.append(pdev)
    sl=theilsen([r[0] for r in reg],[r[1] for r in reg])
    dur=(len(e)-CALIB)/RING
    return dict(bps=len(beats)/dur, rate=(sl*86.4 if sl else None), pairs=len(reg),
                pstd=(float(np.std(pd)) if pd else 0.0))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--id', type=int, default=0)
    ap.add_argument('--file'); ap.add_argument('--rate', type=float, default=24000)
    ap.add_argument('--bph', type=int, default=28800)
    a=ap.parse_args()
    if a.file: raw,sr,bph,cid = load_file(a.file,a.rate,a.bph)
    else:      raw,sr,bph,cid = fetch_capture(a.id)
    EXP = RING/(bph/3600.0)
    print(f"capture {cid}: {len(raw)} samples @ {sr:.0f}Hz, bph={bph}, EXP={EXP:.0f} ring")
    # validated defaults
    e=envelope(raw,sr,150,5000,8); r=phaselock(e,EXP,0.13)
    print("DEFAULT bp150-5000 smooth8 win0.13 -> bps=%.2f rate=%s pairs=%d pstd=%.2f"%(
        r['bps'], ('%+.1f'%r['rate'] if r['rate'] else 'nil'), r['pairs'], r['pstd']))
    print("\nSWEEP (low,high,smooth,win -> rate, pstd, bps):")
    res=[]
    for low in [100,150,300]:
        for high in [3500,5000]:
            for sm in [4,8,15]:
                e=envelope(raw,sr,low,high,sm)
                for win in [0.10,0.13,0.16]:
                    r=phaselock(e,EXP,win)
                    if r and r['rate'] is not None: res.append((low,high,sm,win,r))
    res.sort(key=lambda x: x[4]['pstd'])
    for low,high,sm,win,r in res[:12]:
        print("  bp[%d-%d] sm=%d win=%.2f -> rate=%+.1f pstd=%.2f bps=%.2f"%(
            low,high,sm,win,r['rate'],r['pstd'],r['bps']))

if __name__=='__main__': main()
