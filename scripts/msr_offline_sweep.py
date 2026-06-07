#!/usr/bin/env python3
"""Offline estimation-policy sweep for mic measurement quality.

Replays recorded batch tick streams (measurement_batch_runs.tick_stream) through
candidate rate-estimation / stop policies and reports cross-run spread, accuracy
vs a Weishi reference, and time-to-result. No app change / no network — operates
on a JSON dump of rows [{batch_id, run_idx, native_rate, tick_stream:[{t,cd}]}].

Usage: python3 scripts/msr_offline_sweep.py /tmp/batches.json
"""
import sys, json, statistics as st

# batch_id -> (label, bph, weishi_ref s/day)
META = {
    '22cdd3ed-7be8-45a1-b219-235056b962d0': ('Hamilton', 21600, 1.0),
    '5c7973de-7cbd-48a3-8c14-64a3a205e279': ('JLC', 28800, 1.0),
}

def win(pts, t0, t1):
    return [(p['t'], p['cd']) for p in pts if t0 <= p['t'] <= t1]

def ls_rate(pts, t0, t1):
    w = win(pts, t0, t1); n = len(w)
    if n < 8: return None
    xs = [a for a, _ in w]; ys = [b for _, b in w]
    mx = sum(xs)/n; my = sum(ys)/n
    sxx = sum((x-mx)**2 for x in xs)
    if sxx == 0: return None
    return sum((xs[i]-mx)*(ys[i]-my) for i in range(n))/sxx * 86.4

def ts_rate(pts, t0, t1):
    w = win(pts, t0, t1); n = len(w)
    if n < 8: return None
    xs = [a for a, _ in w]; ys = [b for _, b in w]
    slopes = []
    maxp = 60000; tot = n*(n-1)//2; stride = max(1, tot//maxp); k = 0
    for i in range(n):
        for j in range(i+1, n):
            k += 1
            if stride > 1 and k % stride: continue
            dx = xs[j]-xs[i]
            if dx: slopes.append((ys[j]-ys[i])/dx)
    return st.median(slopes)*86.4 if slopes else None

def agg(vals, ref):
    v = [x for x in vals if x is not None]
    if len(v) < 2: return None
    return dict(n=len(v), mean=st.mean(v), sd=st.pstdev(v),
               rng=max(v)-min(v), bias=st.mean(v)-ref, maxabs_bias=max(abs(x-ref) for x in v))

def plateau_stop(pts, W, eps, dt, min_extra):
    """Simulate: integrate [W, t]; stop when rate over trailing dt stays within eps band."""
    dur = pts[-1]['t']
    series = []
    t = W + min_extra
    while t <= dur + 0.01:
        r = ls_rate(pts, W, t)
        if r is not None:
            series.append((t, r))
            recent = [rr for tt, rr in series if tt >= t - dt]
            if len(recent) >= 3 and (max(recent)-min(recent)) <= eps:
                return t, r
        t += 1.0
    return (dur, ls_rate(pts, W, dur))

def main():
    rows = json.load(open(sys.argv[1] if len(sys.argv) > 1 else '/tmp/batches.json'))
    batches = {}
    for r in rows:
        batches.setdefault(r['batch_id'], []).append(r)

    for bid, runs in batches.items():
        label, bph, ref = META.get(bid, (bid[:8], 0, 0.0))
        runs = [r for r in runs if r.get('tick_stream')]
        print(f"\n{'='*72}\n{label}  (bph {bph}, {len(runs)} runs, Weishi ref {ref:+.1f})\n{'='*72}")

        # 1) Warm-up skip, full integration to 90s, LS
        print("\n[1] Warm-up skip (fit [W,end], LS) — repeatability + accuracy")
        print(f"  {'W':>3} | {'sd':>5} {'range':>6} {'mean':>6} {'bias':>6} {'maxBias':>7}")
        for W in (0, 10, 15, 20, 25, 30):
            a = agg([ls_rate(r['tick_stream'], W, r['tick_stream'][-1]['t']) for r in runs], ref)
            if a: print(f"  {W:>3} | {a['sd']:>5.2f} {a['rng']:>6.1f} {a['mean']:>+6.2f} {a['bias']:>+6.2f} {a['maxabs_bias']:>7.2f}")

        # 2) Estimator: LS vs Theil-Sen on [15,end]
        print("\n[2] Estimator on [15,end]: LS vs Theil-Sen")
        for name, fn in (('LS', ls_rate), ('TheilSen', ts_rate)):
            a = agg([fn(r['tick_stream'], 15, r['tick_stream'][-1]['t']) for r in runs], ref)
            if a: print(f"  {name:>9}: sd {a['sd']:.2f}  range {a['rng']:.1f}  mean {a['mean']:+.2f}  bias {a['bias']:+.2f}")

        # 3) Fixed integration time (W=15), how short can we go
        print("\n[3] Fixed stop time (warm-up 15s, fit [15,T])")
        print(f"  {'T':>3} | {'sd':>5} {'range':>6} {'mean':>6} {'maxBias':>7}")
        for T in (30, 45, 60, 75, 90):
            a = agg([ls_rate(r['tick_stream'], 15, T) for r in runs], ref)
            if a: print(f"  {T:>3} | {a['sd']:>5.2f} {a['rng']:>6.1f} {a['mean']:>+6.2f} {a['maxabs_bias']:>7.2f}")

        # 4) Plateau adaptive stop (W=15)
        print("\n[4] Plateau adaptive stop (warm-up 15s; stop when trailing-dt band <= eps)")
        print(f"  {'eps':>4} {'dt':>3} | {'sd':>5} {'range':>6} {'mean':>6} {'maxBias':>7} | {'avgStop':>7} {'maxStop':>7}")
        for eps in (0.5, 0.7, 1.0):
            for dt in (15, 20):
                outs = [plateau_stop(r['tick_stream'], 15, eps, dt, 10) for r in runs]
                a = agg([r for _, r in outs], ref)
                stops = [t for t, _ in outs]
                if a:
                    print(f"  {eps:>4.1f} {dt:>3} | {a['sd']:>5.2f} {a['rng']:>6.1f} {a['mean']:>+6.2f} {a['maxabs_bias']:>7.2f} | {st.mean(stops):>6.0f}s {max(stops):>6.0f}s")

if __name__ == '__main__':
    main()
