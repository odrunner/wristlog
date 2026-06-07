# Mic Measurement Quality v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `tg_quality_v2` is on, a mic measurement finishes via an incremental-stability controller (stops when the from-start rate has stopped moving), shows an honest ± error bar, and offers a Quick/Accurate toggle — with a 90s hard cap and the native rate as the displayed number.

**Architecture:** A pure `incrSettle(samples, params)` (in `wrotate_test.js`, unit-tested, mirrored inline in `index.html`) replays the running rate over the live tick stream and reports whether it has settled (`|rate[0,t] − rate[0,t−look]| ≤ eps` held `hold` consecutive ~1s checks). A 1 Hz controller in `_tgNativeCallback` calls it; on settled or 90s cap it stops the measurement. The native converged/Max-Duration auto-stop is bypassed when the flag is on. Quick/Accurate are `(eps,look,hold)` presets selected by `localStorage.msr_mode`.

**Tech Stack:** Vanilla JS, Vitest (unit), Playwright (e2e mocked). Pure logic in `wrotate_test.js` with a mirrored inline copy in `index.html` (the codebase's pattern, guarded by `tests/mirror-drift.test.js`).

---

## File Structure

- `wrotate_test.js` — add exported `incrSettle(samples, params)` + `_q2Ls` helper. *Modify.*
- `tests/timegrapher.test.js` — add `describe('incrSettle')`. *Modify.*
- `tests/mirror-drift.test.js` — register `incrSettle` in ADAPTED. *Modify.*
- `index.html` — inline `incrSettle`/`_q2Ls`; `_q2Params`; `_q2LastBand` global + resets; `_q2Tick` controller (refactor dev readout, add stop logic); gate native auto-stop on the flag; error-bar override in `stopMsrListen`; Quick/Accurate toggle UI + visibility. *Modify.*
- `sw.js` — bump cache version. *Modify.*

**Pre-commit hook note:** `.git/hooks/pre-commit` auto-bumps `APP_VERSION` in `index.html` and stages it on every commit. With a clean tree this only adds a 1-line bump — expected; keep the tree clean of unrelated WIP before committing.

**Shared contract (used by all tasks):**

```
incrSettle(samples, params) -> { settled:boolean, rate:number|null, band:number|null, t:number, nTicks:number }
  samples: [{t, cd}]  (also accepts _msrScatterData entries with extra `d`; only t & cd are read)
  params:  { eps, look, hold, minTicks }   defaults eps:0.4, look:20, hold:8, minTicks:40
  rate  = least-squares slope of cd vs t over [start,t] × 86.4 (s/day) at the settle point (or last point)
  band  = max |rate[0,t']−rate[0,t'−look]| across the holding window (the residual uncertainty)
```

---

## Task 1: `incrSettle` pure function (TDD)

**Files:**
- Modify: `wrotate_test.js` (add after `computeRobustRate`)
- Test: `tests/timegrapher.test.js` (new `describe` at end)

- [ ] **Step 1: Write the failing tests** — append to `tests/timegrapher.test.js`:

```js
import { incrSettle } from '../wrotate_test.js';

// cd grows at (sday/86.4) ms per second; ticks every `dt` s.
function streamRate(sday, dur, dt = 0.125, startT = 0) {
  const slope = sday / 86.4; const out = [];
  for (let t = startT; t <= startT + dur + 1e-9; t += dt) out.push({ t: +t.toFixed(3), cd: slope * t });
  return out;
}

describe('incrSettle', () => {
  it('returns null/unsettled below the tick floor', () => {
    const r = incrSettle(streamRate(5, 2), { eps: 0.4, look: 20, hold: 8, minTicks: 40 });
    expect(r.settled).toBe(false);
    expect(r.rate).toBeNull();
  });

  it('settles on a clean constant-rate stream with a tight band', () => {
    const r = incrSettle(streamRate(5, 90), { eps: 0.4, look: 20, hold: 8, minTicks: 40 });
    expect(r.settled).toBe(true);
    expect(r.rate).toBeCloseTo(5, 0);
    expect(r.band).toBeLessThanOrEqual(0.4);
    expect(r.t).toBeGreaterThanOrEqual(25);
    expect(r.t).toBeLessThanOrEqual(40);
  });

  it('settles on a clean BUT short stream (duration must not penalize)', () => {
    // 33s of constant rate, ~264 ticks — above floor, enough for look+hold
    const r = incrSettle(streamRate(-3, 33), { eps: 0.4, look: 20, hold: 8, minTicks: 40 });
    expect(r.settled).toBe(true);
    expect(r.rate).toBeCloseTo(-3, 0);
  });

  it('does NOT settle while the estimate is still moving (accelerating cd)', () => {
    // cd = k*t^2 -> running LS rate keeps climbing -> |rate(t)-rate(t-look)| stays > eps
    const out = []; for (let t = 0; t <= 90; t += 0.125) out.push({ t: +t.toFixed(3), cd: 0.01 * t * t });
    const r = incrSettle(out, { eps: 0.4, look: 20, hold: 8, minTicks: 40 });
    expect(r.settled).toBe(false);
    expect(r.rate).not.toBeNull(); // still reports a fallback rate at the last point
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- timegrapher`
Expected: FAIL — `incrSettle is not a function`.

- [ ] **Step 3: Implement in `wrotate_test.js`** — add after the `computeRobustRate` function:

```js
// ══════════════════════════════════════════
//  INCREMENTAL-STABILITY SETTLE TEST (quality v2 adaptive stop)
// ══════════════════════════════════════════

// Least-squares slope of cd vs t over [t0,t1], in s/day (slope_ms_per_s * 86.4). null if <8 pts.
function _q2Ls(pts, t0, t1) {
  let sx = 0, sy = 0, n = 0;
  for (const p of pts) if (p.t >= t0 && p.t <= t1) { sx += p.t; sy += p.cd; n++; }
  if (n < 8) return null;
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0;
  for (const p of pts) if (p.t >= t0 && p.t <= t1) { const dx = p.t - mx; sxx += dx * dx; sxy += dx * (p.cd - my); }
  if (sxx === 0) return null;
  return sxy / sxx * 86.4;
}

export function incrSettle(samples, params = {}) {
  const o = { eps: 0.4, look: 20, hold: 8, minTicks: 40, ...params };
  const pts = (samples || []).filter(p => p && isFinite(p.t) && isFinite(p.cd));
  const n = pts.length;
  const lastT = n ? pts[n - 1].t : 0;
  if (n < o.minTicks) return { settled: false, rate: null, band: null, t: lastT, nTicks: n };
  const start = pts[0].t;
  let consec = 0, bandMax = 0;
  for (let t = start + o.look + 1; t <= lastT + 1e-6; t += 1) {
    const a = _q2Ls(pts, start, t);
    const b = _q2Ls(pts, start, t - o.look);
    if (a == null || b == null) { consec = 0; bandMax = 0; continue; }
    const diff = Math.abs(a - b);
    if (diff <= o.eps) {
      consec += 1; bandMax = Math.max(bandMax, diff);
      if (consec >= o.hold) {
        return { settled: true, rate: Math.round(a * 10) / 10, band: Math.round(bandMax * 1000) / 1000, t: Math.round(t * 10) / 10, nTicks: n };
      }
    } else { consec = 0; bandMax = 0; }
  }
  const last = _q2Ls(pts, start, lastT);
  return { settled: false, rate: last == null ? null : Math.round(last * 10) / 10, band: null, t: lastT, nTicks: n };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- timegrapher`
Expected: PASS (all `incrSettle` cases green; existing tests still pass).

- [ ] **Step 5: Commit**

```bash
git add wrotate_test.js tests/timegrapher.test.js
git commit -m "feat(tg): incrSettle incremental-stability settle test + tests"
```

---

## Task 2: Inline `incrSettle` into index.html + mirror-drift registration

**Files:**
- Modify: `index.html` (add the inline copy just below the inline `computeRobustRate`, which ends just above `let _q2LastReadout = 0;` near line 22958)
- Modify: `tests/mirror-drift.test.js` (add `incrSettle` to ADAPTED list)

- [ ] **Step 1: Add the inline copy.** Find the line `let _q2LastReadout = 0;` in `index.html`. Insert this block IMMEDIATELY ABOVE it (it reuses the existing inline `computeRobustRate` style; `_q2Ls` is new):

```js
// quality v2 — incremental-stability settle test (mirror of wrotate_test.js incrSettle)
function _q2Ls(pts, t0, t1) {
  let sx = 0, sy = 0, n = 0;
  for (const p of pts) if (p.t >= t0 && p.t <= t1) { sx += p.t; sy += p.cd; n++; }
  if (n < 8) return null;
  const mx = sx / n, my = sy / n; let sxx = 0, sxy = 0;
  for (const p of pts) if (p.t >= t0 && p.t <= t1) { const dx = p.t - mx; sxx += dx * dx; sxy += dx * (p.cd - my); }
  if (sxx === 0) return null;
  return sxy / sxx * 86.4;
}
function incrSettle(samples, params = {}) {
  const o = { eps: 0.4, look: 20, hold: 8, minTicks: 40, ...params };
  const pts = (samples || []).filter(p => p && isFinite(p.t) && isFinite(p.cd));
  const n = pts.length; const lastT = n ? pts[n - 1].t : 0;
  if (n < o.minTicks) return { settled: false, rate: null, band: null, t: lastT, nTicks: n };
  const start = pts[0].t; let consec = 0, bandMax = 0;
  for (let t = start + o.look + 1; t <= lastT + 1e-6; t += 1) {
    const a = _q2Ls(pts, start, t); const b = _q2Ls(pts, start, t - o.look);
    if (a == null || b == null) { consec = 0; bandMax = 0; continue; }
    const diff = Math.abs(a - b);
    if (diff <= o.eps) { consec += 1; bandMax = Math.max(bandMax, diff);
      if (consec >= o.hold) return { settled: true, rate: Math.round(a * 10) / 10, band: Math.round(bandMax * 1000) / 1000, t: Math.round(t * 10) / 10, nTicks: n };
    } else { consec = 0; bandMax = 0; }
  }
  const last = _q2Ls(pts, start, lastT);
  return { settled: false, rate: last == null ? null : Math.round(last * 10) / 10, band: null, t: lastT, nTicks: n };
}
```

- [ ] **Step 2: Register in mirror-drift.** In `tests/mirror-drift.test.js`, find the `ADAPTED` array (it currently includes `'computeRobustRate'`) and add `'incrSettle'` to it (alphabetical or end — order doesn't matter):

```js
// inside the ADAPTED = [ ... ] list, add:
  'incrSettle',
```

- [ ] **Step 3: Verify wiring + mirror guard**

Run: `grep -n "function incrSettle\|function _q2Ls" index.html` (expect one of each) and `npm test -- mirror-drift`
Expected: grep shows the inline defs; mirror-drift test passes (incrSettle exists in both files, classified ADAPTED).

- [ ] **Step 4: Run the full unit + e2e suite** (guards against an index.html syntax error)

Run: `npm test && npm run test:e2e`
Expected: all green. (E2E mocked may show 1–2 flaky timeouts unrelated to this change; re-run once if so — only a consistent, measurement-related failure is real.)

- [ ] **Step 5: Commit**

```bash
git add index.html tests/mirror-drift.test.js
git commit -m "feat(tg): inline incrSettle + mirror-drift registration"
```

---

## Task 3: Mode presets, band global, and resets

**Files:**
- Modify: `index.html` (add `_q2Params` + `_q2LastBand` near the inline helpers; add `_q2LastBand = null` to the three reset sites that already clear `#msr-q2-readout`)

- [ ] **Step 1: Add `_q2Params` and the band global.** Find `let _q2LastReadout = 0;` in `index.html`. Immediately AFTER it, add:

```js
let _q2LastBand = null;   // residual band (s/day) from the last incrSettle — drives the error bar
// Quick/Accurate -> incrSettle params; every field overridable by a q2_* localStorage knob (live tuning).
function _q2Params() {
  const mode = (localStorage.getItem('msr_mode') === 'quick') ? 'quick' : 'accurate';
  const base = mode === 'quick' ? { eps: 0.7, look: 15, hold: 5 } : { eps: 0.4, look: 20, hold: 8 };
  return {
    eps: _q2Num('q2_eps', base.eps),
    look: _q2Num('q2_look', base.look),
    hold: _q2Num('q2_hold', base.hold),
    minTicks: _q2Num('q2_settle_min_ticks', 40),
    mode,
  };
}
```

(`_q2Num` already exists inline from v1.)

- [ ] **Step 2: Reset the band where the readout is cleared.** There are exactly three sites that already contain `const _q2ro = document.getElementById('msr-q2-readout'); if (_q2ro) _q2ro.textContent = '';` (in `_resetMsrState`, `openMeasureInline`, `discardMsrReading`). In EACH, immediately after that line, add:

```js
  _q2LastBand = null;
```

- [ ] **Step 3: Verify**

Run: `grep -n "_q2LastBand\|function _q2Params" index.html`
Expected: the global declaration, the `_q2Params` def, the three resets, (and later tasks will add reads).

- [ ] **Step 4: Run unit + e2e**

Run: `npm test && npm run test:e2e`
Expected: green (no behavior change yet; just new globals/helpers).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(tg): mode presets, error-bar band global, resets"
```

---

## Task 4: Adaptive stop controller + bypass native auto-stop when flag on

**Files:**
- Modify: `index.html` — replace the dev-readout call with a `_q2Tick` controller; refactor `_q2DevReadout` to take the settle result; gate the native auto-stop block (line ~22495) on the flag.

- [ ] **Step 1: Route the callback through `_q2Tick`.** Find:

```js
    if (isMsr && featureFlag('tg_quality_v2')) _q2DevReadout(data.rate);
```
Replace it with:

```js
    if (isMsr && featureFlag('tg_quality_v2')) _q2Tick(data.rate);
```

- [ ] **Step 2: Replace `_q2DevReadout` with `_q2Tick` + a render helper.** Find the existing function `function _q2DevReadout(nativeRateNow) {` and replace the WHOLE function (from its `function _q2DevReadout(nativeRateNow) {` line through its closing `}`) with:

```js
function _q2Tick(nativeRateNow) {
  const now = Date.now();
  if (now - _q2LastReadout < 1000) return;   // throttle to 1 Hz
  _q2LastReadout = now;
  const params = _q2Params();
  const s = incrSettle(_msrScatterData, params);
  _q2LastBand = s.band;
  _q2RenderReadout(nativeRateNow, s, params);
  // Adaptive stop: when flag-on and actively measuring (not during a batch).
  if (_msrListening && !_micBatchActive && _msrListenStart) {
    const elapsed = (now - _msrListenStart) / 1000;
    const cap = _q2Num('q2_cap', 90);
    if (s.settled) { _msrPhase = 'converged'; stopMsrListen('plateau'); }
    else if (elapsed >= cap) { stopMsrListen('duration_cap'); }
  }
}
function _q2RenderReadout(nativeRateNow, s, params) {
  const host = document.getElementById('msr-scatter-plot')?.parentElement;
  if (!host) return;
  let el = document.getElementById('msr-q2-readout');
  if (!el) {
    el = document.createElement('div');
    el.id = 'msr-q2-readout';
    el.style.cssText = 'font-family:monospace;font-size:.66rem;color:#9aa;padding:.25rem .4rem;line-height:1.35;';
    host.insertAdjacentElement('afterend', el);
  }
  const nat = (nativeRateNow != null) ? nativeRateNow : _msrLastRate;
  const natStr = nat != null ? nat.toFixed(1) : '—';
  const js = s.rate != null ? s.rate.toFixed(1) : '—';
  const band = s.band != null ? s.band.toFixed(2) : '—';
  el.textContent = `[${params.mode}] native ${natStr} | js ${js} s/d · band ±${band} · n${s.nTicks}${s.settled ? ' · SETTLED' : ''}`;
}
```

- [ ] **Step 3: Bypass the native auto-stop when the flag is on.** Find:

```js
      if (!_micBatchActive && (_msrPhase === 'converged' || elapsed >= maxDur)) {  // batch controls run length; don't auto-stop mid-batch
```
Replace with:

```js
      if (!_micBatchActive && !featureFlag('tg_quality_v2') && (_msrPhase === 'converged' || elapsed >= maxDur)) {  // flag-on: the _q2Tick plateau controller owns the finish
```

- [ ] **Step 4: Verify wiring**

Run: `grep -n "_q2Tick\|_q2RenderReadout\|!featureFlag('tg_quality_v2') && (_msrPhase" index.html`
Expected: the `_q2Tick(data.rate)` call, the two functions, and the gated native auto-stop line.

- [ ] **Step 5: Run unit + e2e**

Run: `npm test && npm run test:e2e`
Expected: green (no syntax errors; e2e loads index.html).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(tg): adaptive stop controller; bypass native auto-stop when flag on"
```

---

## Task 5: Error-bar override in `stopMsrListen`

**Files:**
- Modify: `index.html` — after the existing `errorBar` computation in `stopMsrListen`, use the plateau band when the flag is on.

- [ ] **Step 1: Override the error bar.** Find this block end in `stopMsrListen` (the bucket/IQR error-bar computation), specifically the lines:

```js
      } else {
        errorBar = 5;
      }
    }
    const sign = r >= 0 ? '+' : '';
```
Replace them with (inserting the flag-on override before `const sign`):

```js
      } else {
        errorBar = 5;
      }
    }
    if (featureFlag('tg_quality_v2') && _q2LastBand != null) {
      errorBar = Math.max(0.5, Math.round(_q2LastBand * 10) / 10);  // adaptive plateau band
    }
    const sign = r >= 0 ? '+' : '';
```

- [ ] **Step 2: Verify**

Run: `grep -n "adaptive plateau band" index.html`
Expected: one match inside `stopMsrListen`.

- [ ] **Step 3: Run unit + e2e**

Run: `npm test && npm run test:e2e`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(tg): error bar uses adaptive plateau band when flag on"
```

---

## Task 6: Quick/Accurate toggle UI + visibility

**Files:**
- Modify: `index.html` — add a mode `<select>` near the batch button; show it when the flag is on (in `initTgSourceSelector`).

- [ ] **Step 1: Add the toggle HTML.** Find the line with `id="mic-batch-position"` (added in v1, just before `id="mic-batch-btn"`). Immediately BEFORE the `mic-batch-position` input line, add (match the surrounding indentation):

```html
          <select id="msr-mode-select" onchange="onMsrModeChange()" style="display:none;width:100%;margin-bottom:.4rem;padding:.4rem;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:.78rem;">
            <option value="accurate">Accurate (lower error bar, waits longer)</option>
            <option value="quick">Quick (faster, wider error bar)</option>
          </select>
```

- [ ] **Step 2: Add the change handler.** Find `async function runMicBatch()` in `index.html`. Immediately BEFORE it, add:

```js
function onMsrModeChange() {
  const v = document.getElementById('msr-mode-select')?.value === 'quick' ? 'quick' : 'accurate';
  localStorage.setItem('msr_mode', v);
}
```

- [ ] **Step 3: Show the toggle when the flag is on.** Find in `initTgSourceSelector` the line:

```js
  const mp = document.getElementById('mic-batch-position'); if (mp) mp.style.display = mbOn ? '' : 'none';
```
Immediately AFTER it, add:

```js
  const ms = document.getElementById('msr-mode-select');
  if (ms) { ms.style.display = mbOn ? '' : 'none'; ms.value = (localStorage.getItem('msr_mode') === 'quick') ? 'quick' : 'accurate'; }
```

- [ ] **Step 4: Verify wiring**

Run: `grep -n "msr-mode-select\|onMsrModeChange" index.html`
Expected: the select HTML + onchange, the handler, and the visibility line.

- [ ] **Step 5: Run unit + e2e**

Run: `npm test && npm run test:e2e`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(tg): Quick/Accurate mode toggle (flag-gated)"
```

---

## Task 7: SW cache bump + final verification

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Bump the SW cache version.** Run `grep -n "wristlog-v" sw.js`, then edit `sw.js` to increment the cache name by one (e.g. `wristlog-v759` → `wristlog-v760`; use the exact current value).

- [ ] **Step 2: Full pre-push suite**

Run: `npm test && npm run test:e2e`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "chore(sw): bump cache version for tg quality v2 adaptive stop"
```

- [ ] **Step 4: Manual UAT (record results, do not auto-push to production without the user)**

With `tg_quality_v2` ON, on the native app:
1. Confirm a Quick/Accurate dropdown appears on the measure screen; switching it persists across reloads.
2. Run a normal measurement on a clean watch in Accurate: it should keep measuring past the old ~30–45s convergence, lock when the dev readout shows `SETTLED`, and display `native X ± band`. Confirm it never runs past 90s.
3. Switch to Quick: it should lock sooner with a larger ± band.
4. Toggle the flag OFF: confirm the dropdown disappears and measurement stops via the old converged/Max-Duration path (unchanged).
5. Report observed settle times + error bars per mode/watch before pushing.

---

## Self-Review

**Spec coverage:**
- Incremental-stability settle test, no min-duration → Task 1 (`incrSettle`, scan with `look`/`hold`, validity floor `minTicks`). ✓
- Mirrored inline copy + mirror-drift → Task 2. ✓
- Quick/Accurate presets, live-tunable knobs → Task 3 (`_q2Params`, `q2_*` overrides). ✓
- Adaptive controller replaces native finish when flag on; 90s cap → Task 4 (`_q2Tick`, gated native auto-stop). ✓
- Native rate stays the number; band → error bar → Task 4 (readout shows native; `_q2LastBand`) + Task 5 (errorBar override). ✓
- Quick/Accurate toggle UI, flag-gated, default Accurate → Task 6. ✓
- Preliminary untouched / flag-off unchanged → native auto-stop only bypassed when flag on; all new code gated on `featureFlag('tg_quality_v2')`. ✓
- Tests + SW bump + suite before push → Tasks 1/2/7. ✓
- Out of scope (native, raw capture, removing JS estimator, amplitude, piezo) → not present. ✓

**Placeholder scan:** No TBD/TODO; all steps contain full code/commands.

**Type consistency:** `incrSettle` returns `{settled,rate,band,t,nTicks}` — consumed by `_q2Tick` (`s.settled`, `s.band`, `s.rate`, `s.nTicks`) and `_q2RenderReadout` identically; `_q2LastBand` set from `s.band` and read in `stopMsrListen`; `_q2Params` returns `{eps,look,hold,minTicks,mode}` matching `incrSettle` params + the readout's `params.mode`. Helper `_q2Ls` named identically in both files (logic identical; ADAPTED because the surrounding `incrSettle` shares the file with `_q2`-prefixed v1 helpers). ✓
