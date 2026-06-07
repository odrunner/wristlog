# Mic Measurement Quality v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a flag-gated JS experimentation rig that computes a more *repeatable* final mic rate from the live tick stream, scores its quality with stability-driven convergence, and runs a 15×90s batch that logs full tick streams to a new table for offline iteration — with no app build.

**Architecture:** The native iOS engine still does tick detection and emits per-tick cumulative-deviation samples to `_msrScatterData` (`[{t, d, cd}]`). v1 adds a pure JS function `computeRobustRate(samples, bph, opts)` (Theil-Sen slope + MAD outlier rejection + stability/quality scoring) that runs at stop time and during a dev readout. A `runMicBatch()` admin harness drives 15 measurements and logs native + JS results + the full tick stream to `measurement_batch_runs`. Everything gates on the `tg_quality_v2` feature flag; non-flag users are unaffected.

**Tech Stack:** Vanilla JS (no frameworks), Vitest (unit), Playwright (e2e mocked), Supabase (Postgres + RLS). The pure function lives in `wrotate_test.js` (exported, unit-tested) with a byte-identical inline copy in `index.html` for runtime — the codebase's established pattern.

---

## File Structure

- `wrotate_test.js` — add exported `computeRobustRate(samples, bph, opts)` pure function (testable copy). *Modify.*
- `tests/timegrapher.test.js` — add a `describe('computeRobustRate')` block. *Modify.*
- `index.html` — add `tg_quality_v2` flag; inline-copy `computeRobustRate`; dev readout in `_tgNativeCallback`; `runMicBatch()` + `#mic-batch-btn` + visibility wiring; bump nothing here except via hook. *Modify.*
- `sw.js` — bump cache version `wristlog-vNN`. *Modify.*
- Supabase (via `npx supabase db query --linked`) — create `measurement_batch_runs` table + RLS. *Create (DB).*

**Key constant:** `ADMIN_USER_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'` (index.html:4834) — used for RLS and admin gating.

**Pre-commit hook note:** `.git/hooks/pre-commit` auto-bumps `APP_VERSION` in `index.html` and stages it on every commit. With a clean working tree this only adds a 1-line version bump. Keep the tree clean (no unrelated WIP) before committing so the hook doesn't sweep in other files.

---

## `computeRobustRate` contract (defined once, referenced by all tasks)

```js
/**
 * Robust, stability-gated rate estimate from a cumulative-deviation tick stream.
 * @param {{t:number, cd:number}[]} samples - t = seconds since start, cd = cumulative deviation (ms).
 *        (Accepts the app's _msrScatterData entries, which also carry `d`; only t and cd are used.)
 * @param {number} bph - beats per hour (used only for the BPH-suspect heuristic).
 * @param {object} [opts] - tunables; each falls back to a localStorage knob then a default.
 * @returns {{
 *   rate:number|null, quality:number, label:'solid'|'fair'|'weak',
 *   nTicks:number, durationSec:number, residualSd:number,
 *   subWindowDelta:number, bphSuspect:boolean, converged:boolean
 * }}
 */
```

Defaults (first-guess, all tunable later): `minTicks=60`, `convergeSday=3`, `maxResidualMs=2.0`, `madMult=4`, `suspectSday=60`, `suspectResidualMs=3`, `residualRefMs=3`.

Algorithm (deterministic, no time/duration floor — stability drives convergence):
1. `nTicks = samples.length`. If `nTicks < minTicks` → return `{rate:null, quality:0, label:'weak', nTicks, durationSec, residualSd:Infinity→0, subWindowDelta:Infinity→0, bphSuspect:false, converged:false}` (see Task 2 tests for exact shape).
2. `durationSec = lastT - firstT`.
3. Theil-Sen slope of `cd` vs `t` over all pairs → `intercept = median(cd_i - slope*t_i)` → `rate = slope * 86.4` (ms/s → s/day).
4. Residuals `r_i = cd_i - (slope*t_i + intercept)`; `MAD = median(|r_i - median(r)|)`; drop points with `|r_i| > madMult * 1.4826 * MAD`; recompute Theil-Sen on inliers → final `rate`.
5. `residualSd` = population std of inlier residuals (ms).
6. `subWindowDelta` = `|rate - rateLastHalf|` where `rateLastHalf` = Theil-Sen rate over samples with `t >= firstT + durationSec/2`.
7. `bphSuspect = Math.abs(rate) > suspectSday && residualSd > suspectResidualMs`.
8. `quality = clamp(0.6*(1 - subWindowDelta/convergeSday) + 0.4*(1 - residualSd/residualRefMs), 0, 1)`.
9. `label = quality >= 0.7 ? 'solid' : quality >= 0.4 ? 'fair' : 'weak'`.
10. `converged = nTicks >= minTicks && subWindowDelta <= convergeSday && residualSd <= maxResidualMs`.

> Note: in `wrotate_test.js` the function uses **plain defaults only** (no `localStorage`, since that file runs under Vitest/node). The **inline copy in index.html** reads `localStorage.getItem('q2_*')` overrides before falling back to the same defaults. The numeric algorithm is otherwise byte-identical.

---

## Task 1: Add the `tg_quality_v2` feature flag

**Files:**
- Modify: `index.html:4836-4842` (the `FEATURE_FLAGS` object)

- [ ] **Step 1: Add the flag**

In `index.html`, inside the `FEATURE_FLAGS` object (currently ends after the `tg_piezo` line at ~4841), add a second entry:

```js
const FEATURE_FLAGS = {
  tg_piezo: { label: 'Timegrapher: piezo input source (admin)', default: false },
  tg_quality_v2: { label: 'Timegrapher: measurement quality v2 (admin)', default: false },
};
```

(Keep the existing `tg_piezo` comment block above it untouched.)

- [ ] **Step 2: Verify the admin toggle renders**

`renderDevFlags()` (index.html:12244) auto-renders every key in `FEATURE_FLAGS`, so no other code is needed. Confirm by grep:

Run: `grep -n "tg_quality_v2" index.html`
Expected: one match in the `FEATURE_FLAGS` object.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(tg): add tg_quality_v2 admin feature flag"
```

(The pre-commit hook will also stage the APP_VERSION bump — that's expected.)

---

## Task 2: `computeRobustRate` pure function (TDD)

**Files:**
- Modify: `wrotate_test.js` (add after `computeMedianRate`, ~line 1230)
- Test: `tests/timegrapher.test.js` (add a new `describe` block at end of file)

- [ ] **Step 1: Write the failing tests**

Append to `tests/timegrapher.test.js`:

```js
import { computeRobustRate } from '../wrotate_test.js';

// Helper: build a cumulative-deviation stream for a watch running at `sday` s/day.
// At rate s/day, cumulative deviation grows sday/86.4 ms per second.
function streamFor(sday, durationSec, bph = 28800, noiseMs = 0, seed = 1) {
  const perTick = 3600 / bph;            // seconds between ticks
  const slopeMsPerSec = sday / 86.4;     // ms cumulative dev per second
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 2 - 1; };
  const out = [];
  for (let t = 0; t <= durationSec; t += perTick) {
    out.push({ t, cd: slopeMsPerSec * t + (noiseMs ? rnd() * noiseMs : 0) });
  }
  return out;
}

describe('computeRobustRate', () => {
  it('returns weak/not-converged below the tick floor', () => {
    const r = computeRobustRate(streamFor(0, 2), 28800); // ~16 ticks
    expect(r.converged).toBe(false);
    expect(r.label).toBe('weak');
    expect(r.rate).toBeNull();
  });

  it('recovers a clean +10 s/day rate and converges solid', () => {
    const r = computeRobustRate(streamFor(10, 60), 28800);
    expect(r.rate).toBeCloseTo(10, 0);
    expect(r.converged).toBe(true);
    expect(r.label).toBe('solid');
    expect(r.residualSd).toBeLessThan(1);
  });

  it('converges solid on a clean but short stream (duration must not penalize)', () => {
    const r = computeRobustRate(streamFor(-5, 12), 28800); // ~96 ticks, above floor
    expect(r.rate).toBeCloseTo(-5, 0);
    expect(r.converged).toBe(true);
    expect(r.label).toBe('solid');
  });

  it('rejects outliers and still recovers the rate', () => {
    const s = streamFor(8, 60);
    s[20].cd += 40; s[55].cd -= 35; s[90].cd += 50; // inject spikes
    const r = computeRobustRate(s, 28800);
    expect(r.rate).toBeCloseTo(8, 0);
  });

  it('does not converge while the rate is still drifting', () => {
    // First half ~ +30 s/day, second half ~ 0 → large subWindowDelta
    const a = streamFor(30, 30);
    const lastA = a[a.length - 1];
    const b = [];
    const perTick = 3600 / 28800;
    for (let t = perTick; t <= 30; t += perTick) b.push({ t: lastA.t + t, cd: lastA.cd + 0 });
    const r = computeRobustRate(a.concat(b), 28800);
    expect(r.subWindowDelta).toBeGreaterThan(3);
    expect(r.converged).toBe(false);
  });

  it('flags bphSuspect on a large-rate, high-residual stream', () => {
    const r = computeRobustRate(streamFor(120, 60, 28800, 6), 28800);
    expect(r.bphSuspect).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- timegrapher`
Expected: FAIL — `computeRobustRate is not exported` / `is not a function`.

- [ ] **Step 3: Implement `computeRobustRate` in `wrotate_test.js`**

Add after `computeMedianRate` (~line 1230):

```js
// ══════════════════════════════════════════
//  ROBUST RATE (quality v2) — stability-gated rate from cumulative-dev stream
// ══════════════════════════════════════════

function _median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Theil-Sen slope+intercept of y vs x. Caps pair count for large N (deterministic stride).
function _theilSen(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0 };
  const slopes = [];
  const maxPairs = 200000;
  const total = (n * (n - 1)) / 2;
  const stride = total > maxPairs ? Math.ceil(total / maxPairs) : 1;
  let k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (stride === 1 || (k++ % stride === 0)) {
        const dx = xs[j] - xs[i];
        if (dx !== 0) slopes.push((ys[j] - ys[i]) / dx);
      }
    }
  }
  const slope = _median(slopes);
  const intercept = _median(xs.map((x, i) => ys[i] - slope * x));
  return { slope, intercept };
}

export function computeRobustRate(samples, bph, opts = {}) {
  const o = {
    minTicks: 60, convergeSday: 3, maxResidualMs: 2.0, madMult: 4,
    suspectSday: 60, suspectResidualMs: 3, residualRefMs: 3, ...opts,
  };
  const pts = (samples || []).filter(p => p && isFinite(p.t) && isFinite(p.cd));
  const nTicks = pts.length;
  const durationSec = nTicks ? pts[nTicks - 1].t - pts[0].t : 0;
  const weak = {
    rate: null, quality: 0, label: 'weak', nTicks, durationSec,
    residualSd: 0, subWindowDelta: 0, bphSuspect: false, converged: false,
  };
  if (nTicks < o.minTicks) return weak;

  const xs = pts.map(p => p.t), ys = pts.map(p => p.cd);
  let { slope, intercept } = _theilSen(xs, ys);

  // MAD outlier rejection on residuals, then refit.
  let res = ys.map((y, i) => y - (slope * xs[i] + intercept));
  const medRes = _median(res);
  const mad = _median(res.map(r => Math.abs(r - medRes)));
  const cutoff = o.madMult * 1.4826 * (mad || 0);
  let ix = xs, iy = ys;
  if (cutoff > 0) {
    const keep = res.map(r => Math.abs(r) <= cutoff);
    ix = xs.filter((_, i) => keep[i]);
    iy = ys.filter((_, i) => keep[i]);
    if (ix.length >= 2) ({ slope, intercept } = _theilSen(ix, iy));
  }

  const rate = slope * 86.4;
  const inRes = iy.map((y, i) => y - (slope * ix[i] + intercept));
  const meanRes = inRes.reduce((a, b) => a + b, 0) / (inRes.length || 1);
  const residualSd = Math.sqrt(inRes.reduce((a, b) => a + (b - meanRes) ** 2, 0) / (inRes.length || 1));

  // Sub-window agreement: rate over the last half of the (time) window.
  const halfT = pts[0].t + durationSec / 2;
  const lhx = [], lhy = [];
  for (let i = 0; i < nTicks; i++) if (xs[i] >= halfT) { lhx.push(xs[i]); lhy.push(ys[i]); }
  const rateLastHalf = lhx.length >= 2 ? _theilSen(lhx, lhy).slope * 86.4 : rate;
  const subWindowDelta = Math.abs(rate - rateLastHalf);

  const bphSuspect = Math.abs(rate) > o.suspectSday && residualSd > o.suspectResidualMs;
  const quality = Math.max(0, Math.min(1,
    0.6 * (1 - subWindowDelta / o.convergeSday) + 0.4 * (1 - residualSd / o.residualRefMs)));
  const label = quality >= 0.7 ? 'solid' : quality >= 0.4 ? 'fair' : 'weak';
  const converged = nTicks >= o.minTicks && subWindowDelta <= o.convergeSday && residualSd <= o.maxResidualMs;

  return {
    rate: Math.round(rate * 10) / 10, quality: Math.round(quality * 100) / 100, label,
    nTicks, durationSec: Math.round(durationSec * 10) / 10,
    residualSd: Math.round(residualSd * 1000) / 1000,
    subWindowDelta: Math.round(subWindowDelta * 10) / 10, bphSuspect, converged,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- timegrapher`
Expected: PASS, all `computeRobustRate` cases green (existing `computeTgResults` tests still pass).

- [ ] **Step 5: Commit**

```bash
git add wrotate_test.js tests/timegrapher.test.js
git commit -m "feat(tg): computeRobustRate stability-gated rate estimator + tests"
```

---

## Task 3: Create the `measurement_batch_runs` table

**Files:**
- DB only (run via `npx supabase db query --linked`).

- [ ] **Step 1: Create the table + RLS**

Run (single command):

```bash
npx supabase db query --linked "
CREATE TABLE IF NOT EXISTS public.measurement_batch_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  run_idx int NOT NULL,
  user_id uuid NOT NULL,
  watch_id text,
  position text,
  bph int,
  native_rate numeric,
  native_beat_error numeric,
  js_rate numeric,
  js_quality numeric,
  js_label text,
  n_ticks int,
  duration_sec numeric,
  residual_sd numeric,
  sub_window_delta numeric,
  bph_suspect boolean,
  tick_stream jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.measurement_batch_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mbr_admin_all ON public.measurement_batch_runs;
CREATE POLICY mbr_admin_all ON public.measurement_batch_runs
  FOR ALL TO authenticated
  USING (auth.uid() = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'::uuid)
  WITH CHECK (auth.uid() = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'::uuid);
"
```

Expected: success (no rows / empty result, no error).

- [ ] **Step 2: Verify the table exists with the right columns**

Run:

```bash
npx supabase db query --linked "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='measurement_batch_runs' ORDER BY ordinal_position;"
```

Expected: 18 columns matching the CREATE above.

- [ ] **Step 3: Verify admin RLS round-trips (simulated JWT)**

Run:

```bash
npx supabase db query --linked "
SELECT set_config('request.jwt.claims', '{\"sub\":\"d70b1a85-4f31-4431-b3b7-db76543daaf5\",\"role\":\"authenticated\"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.measurement_batch_runs (batch_id, run_idx, user_id, bph, js_rate) VALUES (gen_random_uuid(), 0, 'd70b1a85-4f31-4431-b3b7-db76543daaf5', 28800, 1.2);
SELECT count(*) FROM public.measurement_batch_runs;
"
```

Expected: insert succeeds, count ≥ 1. (No code commit for this DB task; note completion in the plan.)

- [ ] **Step 4: Clean up the test row**

Run:

```bash
npx supabase db query --linked "DELETE FROM public.measurement_batch_runs WHERE js_rate = 1.2 AND run_idx = 0;"
```

Expected: success.

---

## Task 4: Inline `computeRobustRate` into index.html + dev readout

**Files:**
- Modify: `index.html` — add inline copy near the other inline tg helpers; add dev readout logic inside `_tgNativeCallback`.

- [ ] **Step 1: Add the inline copy of `computeRobustRate` (localStorage-aware) to index.html**

Place this just above `function addMsrTickDots(newTicks)` (index.html:22867). It is the byte-identical algorithm from Task 2, except `opts` defaults read `localStorage` knobs first. Include `_median` and `_theilSen` with `_q2` prefixes to avoid any global collision:

```js
// quality v2 — robust rate (mirror of wrotate_test.js computeRobustRate; knobs via localStorage q2_*)
function _q2Median(arr){ if(!arr.length) return 0; const s=[...arr].sort((a,b)=>a-b); const m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function _q2TheilSen(xs,ys){ const n=xs.length; if(n<2) return {slope:0,intercept:ys[0]||0}; const slopes=[]; const maxPairs=200000; const total=(n*(n-1))/2; const stride=total>maxPairs?Math.ceil(total/maxPairs):1; let k=0; for(let i=0;i<n;i++){ for(let j=i+1;j<n;j++){ if(stride===1||(k++%stride===0)){ const dx=xs[j]-xs[i]; if(dx!==0) slopes.push((ys[j]-ys[i])/dx); } } } const slope=_q2Median(slopes); const intercept=_q2Median(xs.map((x,i)=>ys[i]-slope*x)); return {slope,intercept}; }
function _q2Num(key, def){ const v=parseFloat(localStorage.getItem(key)); return isFinite(v)?v:def; }
function computeRobustRate(samples, bph, opts={}){
  const o={ minTicks:_q2Num('q2_min_ticks',60), convergeSday:_q2Num('q2_converge_sday',3), maxResidualMs:_q2Num('q2_max_residual_ms',2.0), madMult:_q2Num('q2_mad_mult',4), suspectSday:_q2Num('q2_suspect_sday',60), suspectResidualMs:_q2Num('q2_suspect_residual_ms',3), residualRefMs:_q2Num('q2_residual_ref_ms',3), ...opts };
  const pts=(samples||[]).filter(p=>p&&isFinite(p.t)&&isFinite(p.cd));
  const nTicks=pts.length; const durationSec=nTicks?pts[nTicks-1].t-pts[0].t:0;
  const weak={ rate:null, quality:0, label:'weak', nTicks, durationSec, residualSd:0, subWindowDelta:0, bphSuspect:false, converged:false };
  if(nTicks<o.minTicks) return weak;
  const xs=pts.map(p=>p.t), ys=pts.map(p=>p.cd);
  let {slope,intercept}=_q2TheilSen(xs,ys);
  let res=ys.map((y,i)=>y-(slope*xs[i]+intercept));
  const medRes=_q2Median(res); const mad=_q2Median(res.map(r=>Math.abs(r-medRes))); const cutoff=o.madMult*1.4826*(mad||0);
  let ix=xs, iy=ys;
  if(cutoff>0){ const keep=res.map(r=>Math.abs(r)<=cutoff); ix=xs.filter((_,i)=>keep[i]); iy=ys.filter((_,i)=>keep[i]); if(ix.length>=2)({slope,intercept}=_q2TheilSen(ix,iy)); }
  const rate=slope*86.4;
  const inRes=iy.map((y,i)=>y-(slope*ix[i]+intercept));
  const meanRes=inRes.reduce((a,b)=>a+b,0)/(inRes.length||1);
  const residualSd=Math.sqrt(inRes.reduce((a,b)=>a+(b-meanRes)**2,0)/(inRes.length||1));
  const halfT=pts[0].t+durationSec/2; const lhx=[],lhy=[];
  for(let i=0;i<nTicks;i++) if(xs[i]>=halfT){ lhx.push(xs[i]); lhy.push(ys[i]); }
  const rateLastHalf=lhx.length>=2?_q2TheilSen(lhx,lhy).slope*86.4:rate;
  const subWindowDelta=Math.abs(rate-rateLastHalf);
  const bphSuspect=Math.abs(rate)>o.suspectSday&&residualSd>o.suspectResidualMs;
  const quality=Math.max(0,Math.min(1, 0.6*(1-subWindowDelta/o.convergeSday)+0.4*(1-residualSd/o.residualRefMs)));
  const label=quality>=0.7?'solid':quality>=0.4?'fair':'weak';
  const converged=nTicks>=o.minTicks&&subWindowDelta<=o.convergeSday&&residualSd<=o.maxResidualMs;
  return { rate:Math.round(rate*10)/10, quality:Math.round(quality*100)/100, label, nTicks, durationSec:Math.round(durationSec*10)/10, residualSd:Math.round(residualSd*1000)/1000, subWindowDelta:Math.round(subWindowDelta*10)/10, bphSuspect, converged };
}
```

- [ ] **Step 2: Add a throttled dev readout inside `_tgNativeCallback`**

Find the live-rate update block in `_tgNativeCallback` (around index.html:22105, right after `if (isMsr && data.newTicks) addMsrTickDots(data.newTicks);`). Immediately after that line, insert:

```js
    if (isMsr && featureFlag('tg_quality_v2')) _q2DevReadout();
```

Then add this helper next to `addMsrTickDots` (it creates its own DOM node so no HTML edit is needed):

```js
let _q2LastReadout = 0;
function _q2DevReadout() {
  const now = Date.now();
  if (now - _q2LastReadout < 1000) return;   // throttle to 1 Hz
  _q2LastReadout = now;
  const host = document.getElementById('msr-scatter-plot')?.parentElement;
  if (!host) return;
  let el = document.getElementById('msr-q2-readout');
  if (!el) {
    el = document.createElement('div');
    el.id = 'msr-q2-readout';
    el.style.cssText = 'font-family:monospace;font-size:.66rem;color:#9aa;padding:.25rem .4rem;line-height:1.35;';
    host.appendChild(el);
  }
  const bph = _msrLastBph || parseInt(document.getElementById('msr-bph-select')?.value) || 28800;
  const q = computeRobustRate(_msrScatterData, bph);
  const nat = _msrLastRate != null ? _msrLastRate.toFixed(1) : '—';
  const js = q.rate != null ? q.rate.toFixed(1) : '—';
  el.textContent = `native ${nat} | js ${js} s/d · ${q.label} q=${q.quality} · res ${q.residualSd}ms · Δhalf ${q.subWindowDelta} · n${q.nTicks}${q.bphSuspect ? ' · BPH?' : ''}${q.converged ? ' · LOCK' : ''}`;
}
```

- [ ] **Step 3: Verify it’s wired without breaking non-flag users**

Run: `grep -n "computeRobustRate\|_q2DevReadout\|msr-q2-readout" index.html`
Expected: the inline def, the `_q2DevReadout()` call gated by `featureFlag('tg_quality_v2')`, the helper, and the dynamic element id. No readout code runs when the flag is off.

- [ ] **Step 4: Run the full unit + e2e suite (guards against syntax errors in index.html)**

Run: `npm test && npm run test:e2e`
Expected: all green. (The e2e mocked suite loads index.html; a syntax error there would fail it.)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(tg): inline computeRobustRate + flag-gated dev readout"
```

---

## Task 5: `runMicBatch()` harness + button + logging

**Files:**
- Modify: `index.html` — add `#mic-batch-btn` HTML near the piezo batch button (index.html:3436); add `runMicBatch()` near `runPiezoBatch()` (index.html:21767); show the button when the flag is on inside `initTgSourceSelector()` (index.html:21747).

- [ ] **Step 1: Add the button + optional position input (HTML)**

Immediately after the `pz-batch-btn` button (index.html:3436), add:

```html
          <input id="mic-batch-position" placeholder="position label (optional)" style="display:none;width:100%;margin-bottom:.4rem;padding:.4rem;border-radius:8px;border:1px solid rgba(96,165,250,.4);background:#0a1220;color:#93c5fd;font-size:.72rem;">
          <button id="mic-batch-btn" onclick="runMicBatch()" style="display:none;width:100%;margin-bottom:.75rem;padding:.45rem;border-radius:8px;border:1px solid rgba(96,165,250,.4);background:#0a1220;color:#93c5fd;font-size:.72rem;cursor:pointer;">Mic Batch ×15 (90s each, same watch &amp; position)</button>
```

- [ ] **Step 2: Show the button + input when the flag is on**

Inside `initTgSourceSelector()` (index.html:21747) — which already runs on init (called at index.html:13199) — add near its end, before its closing brace:

```js
  const mbOn = featureFlag('tg_quality_v2');
  const mb = document.getElementById('mic-batch-btn'); if (mb) mb.style.display = mbOn ? '' : 'none';
  const mp = document.getElementById('mic-batch-position'); if (mp) mp.style.display = mbOn ? '' : 'none';
```

- [ ] **Step 3: Add `runMicBatch()` next to `runPiezoBatch()`**

After `runPiezoBatch()` (ends index.html:21798), add:

```js
// Admin batch (quality v2): run N mic measurements on the SAME watch/position, back to back,
// and log native + JS-robust results + the full tick stream to measurement_batch_runs for
// offline iteration. Mic source only (never touches piezo). Click again to cancel.
let _micBatchActive = false;
const _MIC_BATCH_LABEL = 'Mic Batch ×15 (90s each, same watch & position)';
async function runMicBatch() {
  const btn = document.getElementById('mic-batch-btn');
  if (_micBatchActive) { _micBatchActive = false; if (btn) btn.textContent = 'Cancelling…'; return; }
  if (!_tgHasNative()) { toast('Batch needs the native app'); return; }
  const sel = document.getElementById('msr-bph-select');
  const bph = sel ? (parseInt(sel.value) || 0) : 0;
  if (bph === 0) { toast('Pick the watch’s BPH first'); return; }
  if (localStorage.getItem('tg_input_source') === 'piezo') localStorage.setItem('tg_input_source', 'mic'); // force mic
  const position = (document.getElementById('mic-batch-position')?.value || '').trim() || null;
  const watchId = document.getElementById('msr-watch-select')?.value || null;
  const batchId = crypto.randomUUID();
  const RUNS = 15, RUN_MS = 90000, GAP_MS = 4000, RESET_MS = 1200;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  _micBatchActive = true;
  for (let i = 0; i < RUNS && _micBatchActive; i++) {
    if (_msrListening) { stopMsrListen('batch_reset'); await sleep(RESET_MS); }
    if (!_micBatchActive) break;
    if (btn) btn.textContent = `Mic Batch ${i + 1}/${RUNS} …`;
    console.log(`[MICBATCH] run ${i + 1}/${RUNS} bph=${bph} pos=${position || '-'}`);
    toggleMsrListen();
    await sleep(RUN_MS);
    if (_msrListening) stopMsrListen('batch');
    // Snapshot AFTER stop (stopMsrListen leaves _msrScatterData / _msrLastRate intact until next start).
    const stream = _msrScatterData.map(d => ({ t: Math.round(d.t * 100) / 100, cd: Math.round(d.cd * 1000) / 1000 }));
    const q = computeRobustRate(_msrScatterData, bph);
    if (currentUser) {
      db.from('measurement_batch_runs').insert({
        batch_id: batchId, run_idx: i, user_id: currentUser.id, watch_id: watchId, position, bph,
        native_rate: _msrLastRate, native_beat_error: (typeof _msrLastBe !== 'undefined' ? _msrLastBe : null),
        js_rate: q.rate, js_quality: q.quality, js_label: q.label, n_ticks: q.nTicks,
        duration_sec: q.durationSec, residual_sd: q.residualSd, sub_window_delta: q.subWindowDelta,
        bph_suspect: q.bphSuspect, tick_stream: stream.length ? stream : null,
      }).then(({ error }) => { if (error) console.warn('[MICBATCH] insert failed', error.message); });
    }
    await sleep(GAP_MS);
  }
  const done = _micBatchActive;
  _micBatchActive = false;
  if (btn) btn.textContent = _MIC_BATCH_LABEL;
  toast(done ? `Mic batch done — batch ${batchId.slice(0, 8)}` : 'Mic batch cancelled');
}
```

> `_msrLastBe` may not exist as a global. Before relying on it, grep: `grep -n "_msrLastBe" index.html`. If absent, the `typeof` guard already returns `null` — leave it; native beat error is non-critical for v1. (Do NOT invent a new global.)

- [ ] **Step 4: Verify wiring**

Run: `grep -n "runMicBatch\|mic-batch-btn\|mic-batch-position\|_micBatchActive" index.html`
Expected: button HTML, the `onclick`, the visibility lines in `initTgSourceSelector`, and the function — all present.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run test:e2e`
Expected: all green (no syntax errors introduced into index.html).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(tg): runMicBatch 15x90s harness + measurement_batch_runs logging"
```

---

## Task 6: SW cache bump + final verification

**Files:**
- Modify: `sw.js` (cache version)

- [ ] **Step 1: Bump the SW cache version**

Run: `grep -n "wristlog-v" sw.js`
Then edit `sw.js` to increment the cache name (e.g. `wristlog-v<NN>` → `wristlog-v<NN+1>`). Use the exact current value from the grep.

- [ ] **Step 2: Run the full pre-push suite**

Run: `npm test && npm run test:e2e`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "chore(sw): bump cache version for tg quality v2"
```

- [ ] **Step 4: Manual UAT checklist (record results, do not auto-push)**

On the dev server (http://192.168.1.246:3000), signed in as the admin account, native app:
1. Admin → Dev tab → toggle **Timegrapher: measurement quality v2** ON.
2. Reload measurement page; confirm the **Mic Batch ×15** button + position input appear, and the dev readout (`native … | js …`) shows during a normal mic measurement.
3. Toggle the flag OFF; confirm button, input, and readout all disappear and a normal measurement is visually unchanged.
4. With the flag ON, pick a watch + BPH, enter a position label, run a short batch (cancel after 2 runs is fine) and confirm rows land:
   `npx supabase db query --linked "SELECT run_idx, native_rate, js_rate, js_label, n_ticks, residual_sd, sub_window_delta FROM measurement_batch_runs ORDER BY created_at DESC LIMIT 5;"`
5. Report the per-run spread; do not `git push` until the user approves the UAT results.

---

## Self-Review

**Spec coverage:**
- `tg_quality_v2` flag → Task 1. ✓
- Robust JS estimator (Theil-Sen + MAD + sub-window + quality + bphSuspect) → Task 2 (tested) + Task 4 (inline). ✓
- Stability-driven convergence, no duration floor → Task 2 algorithm (`converged` uses subWindowDelta/residualSd; `minTicks` is a validity floor only) + tests assert clean-short converges. ✓
- Dev display native vs JS + quality → Task 4. ✓
- 15×90s batch harness, mic only, optional position → Task 5. ✓
- `measurement_batch_runs` table, admin RLS, full tick stream logged → Task 3 + Task 5. ✓
- Keep early preliminary untouched / non-flag users unaffected → all new behavior gated on `featureFlag('tg_quality_v2')`; no changes to the native preliminary path. ✓
- Tests + SW bump + run suite before push → Tasks 2/4/5/6. ✓
- Out of scope (amplitude, piezo, native, raw capture, offline sweep) → not present in any task. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; the one conditional (`_msrLastBe`) has an explicit `typeof` guard + grep instruction, not a placeholder.

**Type consistency:** `computeRobustRate` returns the same keys in `wrotate_test.js` and the inline copy and they match the `measurement_batch_runs` columns (`js_rate`←rate, `js_quality`←quality, `js_label`←label, `n_ticks`←nTicks, `duration_sec`←durationSec, `residual_sd`←residualSd, `sub_window_delta`←subWindowDelta, `bph_suspect`←bphSuspect). Helper names `_q2Median`/`_q2TheilSen` (inline) vs `_median`/`_theilSen` (module) are intentionally distinct to avoid global collisions in index.html; same math. ✓
