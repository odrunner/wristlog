# Generalized Native-Knob Sweep (B1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize `runMicSweep` to sweep any live-tunable native knob (not just `tickDetectMult`), record the swept knob/value per run, and survive the measurement-start settings-apply — so we can sweep `maxPairThresh` on JLC with no Swift build.

**Architecture:** Two pure helpers (`resolveSweepKnob` name→input-id, `parseSweepValues`) in `wrotate_test.js` (tested) + inline mirror in `index.html`. `runMicSweep` becomes knob-driven via `localStorage` (`q2_sweep_knob`/`q2_sweep_values`/`q2_sweep_runs`/`q2_sweep_secs`); it sets a generic `q2_sweep_active` marker per value that the generalized start hook `_q2ApplyOverrides` re-applies after `tgApplySettingsToInputs`. Each run logs `sweep_param`/`sweep_value` to `measurement_batch_runs`.

**Tech Stack:** Vanilla JS, Vitest, Playwright (mocked), Supabase. Pure logic mirrored inline (mirror-drift guard).

---

## File Structure
- `wrotate_test.js` — add `resolveSweepKnob`, `parseSweepValues`. *Modify.*
- `tests/timegrapher.test.js` — add `describe('sweep knob helpers')`. *Modify.*
- `tests/mirror-drift.test.js` — register both in VERBATIM. *Modify.*
- `index.html` — inline both helpers; generalize `_q2ApplyTdm`→`_q2ApplyOverrides` (+ call site); add `sweep_param`/`sweep_value` to `_micRunBatchLoop` insert; generalize `runMicSweep`. *Modify.*
- `sw.js` — bump cache. *Modify.*
- Supabase — add `sweep_param`/`sweep_value` columns. *DB.*

**Pre-commit hook** auto-bumps `APP_VERSION` in index.html on every commit (1 line, expected).

---

## Task 1: Pure helpers `resolveSweepKnob` + `parseSweepValues` (TDD)

**Files:** Modify `wrotate_test.js` (after `resolveTdm`); Test `tests/timegrapher.test.js` (new describe at end).

- [ ] **Step 1: Write the failing tests** — append to `tests/timegrapher.test.js`:

```js
import { resolveSweepKnob, parseSweepValues } from '../wrotate_test.js';

describe('sweep knob helpers', () => {
  it('resolveSweepKnob maps known knobs to their input id', () => {
    expect(resolveSweepKnob('tickDetectMult')).toBe('msr-tune-tick-detect-mult');
    expect(resolveSweepKnob('maxPairThresh')).toBe('msr-tune-max-pair-thresh');
    expect(resolveSweepKnob('pairMadMult')).toBe('msr-tune-pair-mad-mult');
  });
  it('resolveSweepKnob returns null for unknown knobs', () => {
    expect(resolveSweepKnob('bogus')).toBeNull();
    expect(resolveSweepKnob('')).toBeNull();
    expect(resolveSweepKnob(undefined)).toBeNull();
  });
  it('parseSweepValues parses a comma list of positive numbers', () => {
    expect(parseSweepValues('1.5, 2.5,3.5')).toEqual([1.5, 2.5, 3.5]);
  });
  it('parseSweepValues drops junk, negatives, zero, and blanks', () => {
    expect(parseSweepValues('0.3,abc,-1,0,0.2')).toEqual([0.3, 0.2]);
    expect(parseSweepValues('')).toEqual([]);
    expect(parseSweepValues(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run `npm test -- timegrapher`** — Expected: FAIL (`resolveSweepKnob is not a function`).

- [ ] **Step 3: Implement in `wrotate_test.js`** — add after the `resolveTdm` function:

```js
// Maps a friendly sweep-knob name to its hidden tuning input id (or null if unknown).
export function resolveSweepKnob(name) {
  const map = {
    tickDetectMult: 'msr-tune-tick-detect-mult',
    maxPairThresh: 'msr-tune-max-pair-thresh',
    pairMadMult: 'msr-tune-pair-mad-mult',
    maxTickDevMs: 'msr-tune-max-tick-dev',
    coldStartThresh: 'msr-tune-cold-start',
    calibMultiplier: 'msr-tune-calib-multiplier',
    noiseFloorMult: 'msr-tune-noise-floor-mult',
  };
  return map[name] || null;
}

// Parses a comma-separated list into positive finite numbers (drops junk/zero/negatives).
export function parseSweepValues(str) {
  return String(str || '').split(',').map(s => parseFloat(s.trim())).filter(v => isFinite(v) && v > 0);
}
```

- [ ] **Step 4: Run `npm test -- timegrapher`** — Expected: PASS (all green).

- [ ] **Step 5: Commit**

```bash
git add wrotate_test.js tests/timegrapher.test.js
git commit -m "feat(tg): resolveSweepKnob + parseSweepValues helpers + tests"
```

---

## Task 2: Add `sweep_param` / `sweep_value` columns

**Files:** DB only.

- [ ] **Step 1: Add columns**

```bash
npx supabase db query --linked "ALTER TABLE public.measurement_batch_runs ADD COLUMN IF NOT EXISTS sweep_param text; ALTER TABLE public.measurement_batch_runs ADD COLUMN IF NOT EXISTS sweep_value double precision;"
```
Expected: success.

- [ ] **Step 2: Verify**

```bash
npx supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='measurement_batch_runs' AND column_name IN ('sweep_param','sweep_value') ORDER BY column_name;"
```
Expected: two rows (`sweep_param`, `sweep_value`).

---

## Task 3: Inline helpers + mirror; generalize start hook; log sweep columns

**Files:** Modify `index.html`, `tests/mirror-drift.test.js`.

- [ ] **Step 1: Inline the two helpers.** In `index.html`, find `function resolveTdm(override, table, def) {`. Immediately ABOVE its preceding comment line (`// Effective tickDetectMult: ...`), insert:

```js
// Maps a friendly sweep-knob name to its hidden tuning input id (or null if unknown).
function resolveSweepKnob(name) {
  const map = {
    tickDetectMult: 'msr-tune-tick-detect-mult',
    maxPairThresh: 'msr-tune-max-pair-thresh',
    pairMadMult: 'msr-tune-pair-mad-mult',
    maxTickDevMs: 'msr-tune-max-tick-dev',
    coldStartThresh: 'msr-tune-cold-start',
    calibMultiplier: 'msr-tune-calib-multiplier',
    noiseFloorMult: 'msr-tune-noise-floor-mult',
  };
  return map[name] || null;
}

// Parses a comma-separated list into positive finite numbers (drops junk/zero/negatives).
function parseSweepValues(str) {
  return String(str || '').split(',').map(s => parseFloat(s.trim())).filter(v => isFinite(v) && v > 0);
}
```

- [ ] **Step 2: Register in mirror-drift VERBATIM.** In `tests/mirror-drift.test.js`, add `'resolveSweepKnob'` and `'parseSweepValues'` to the `VERBATIM` array.

- [ ] **Step 3: Generalize the start hook.** Find `function _q2ApplyTdm() {` and replace the ENTIRE function with:

```js
// Re-apply flag-on overrides AFTER tgApplySettingsToInputs so they survive measurement start:
// (a) a manual tickDetectMult override, (b) the active sweep knob (any knob).
function _q2ApplyOverrides() {
  if (!featureFlag('tg_quality_v2')) return;
  const ov = localStorage.getItem('q2_tick_detect_mult');
  if (ov != null && ov !== '') {
    const v = resolveTdm(ov, null, null);
    const el = document.getElementById('msr-tune-tick-detect-mult');
    if (el && v != null) el.value = v;
  }
  const sw = localStorage.getItem('q2_sweep_active');
  if (sw) {
    try {
      const a = JSON.parse(sw);
      const el = document.getElementById(a.inputId);
      if (el && a.value != null) el.value = a.value;
    } catch (e) {}
  }
}
```

- [ ] **Step 4: Update the start-path call.** Find the line `    _q2ApplyTdm();` (in the measurement-start sequence) and change it to:

```js
    _q2ApplyOverrides();
```
Verify there are no other references: `grep -n "_q2ApplyTdm" index.html` must return ZERO after this step.

- [ ] **Step 5: Log sweep columns in the batch loop.** In `_micRunBatchLoop`, change the function signature destructure to include `sweepParam` and `sweepValue`. Find:
```js
async function _micRunBatchLoop({ batchId, bph, watchId, position, runs, runMs, tdm, btn, label }) {
```
Replace with:
```js
async function _micRunBatchLoop({ batchId, bph, watchId, position, runs, runMs, tdm, sweepParam, sweepValue, btn, label }) {
```
Then find the insert object's last data line:
```js
        bph_suspect: q.bphSuspect, tick_stream: stream.length ? stream : null, tick_detect_mult: tdm,
```
Replace with:
```js
        bph_suspect: q.bphSuspect, tick_stream: stream.length ? stream : null, tick_detect_mult: tdm,
        sweep_param: sweepParam ?? null, sweep_value: sweepValue ?? null,
```

- [ ] **Step 6: Verify wiring + mirror + suite**

Run: `grep -n "function resolveSweepKnob\|function parseSweepValues\|function _q2ApplyOverrides\|_q2ApplyTdm\|sweep_param: sweepParam" index.html` (expect the two helpers, `_q2ApplyOverrides`, ZERO `_q2ApplyTdm`, and the insert line) and `npm test -- mirror-drift`.
Then `npm test && npm run test:e2e` — all green. (E2E may have 1-2 flaky timeouts unrelated; re-run once.)

- [ ] **Step 7: Commit**

```bash
git add index.html tests/mirror-drift.test.js
git commit -m "feat(tg): generalized override hook + sweep_param/value logging + inline helpers"
```

---

## Task 4: Generalize `runMicSweep` to any knob

**Files:** Modify `index.html`.

- [ ] **Step 1: Replace `runMicSweep`.** Find `async function runMicSweep() {` and replace the ENTIRE function (through its closing `}`) with:

```js
async function runMicSweep() {
  const btn = document.getElementById('mic-sweep-btn');
  if (_micBatchActive) { _micBatchActive = false; if (btn) btn.textContent = 'Cancelling…'; return; }
  if (!_tgHasNative()) { toast('Sweep needs the native app'); return; }
  const sel = document.getElementById('msr-bph-select');
  const bph = sel ? (parseInt(sel.value) || 0) : 0;
  if (bph === 0) { toast('Pick the watch’s BPH first'); return; }
  if (localStorage.getItem('tg_input_source') === 'piezo') localStorage.setItem('tg_input_source', 'mic');
  const position = (document.getElementById('mic-batch-position')?.value || '').trim() || null;
  const watchId = document.getElementById('msr-watch-select')?.value || null;
  const knob = localStorage.getItem('q2_sweep_knob') || 'tickDetectMult';
  const inputId = resolveSweepKnob(knob);
  if (!inputId) { toast('Unknown sweep knob: ' + knob); return; }
  const inputEl = document.getElementById(inputId);
  if (!inputEl) { toast('Sweep input missing: ' + inputId); return; }
  const values = parseSweepValues(localStorage.getItem('q2_sweep_values') || '0.3,0.25,0.2,0.15');
  if (!values.length) { toast('No sweep values'); return; }
  const runs = parseInt(localStorage.getItem('q2_sweep_runs')) || 12;
  const runMs = (parseInt(localStorage.getItem('q2_sweep_secs')) || 90) * 1000;
  const prevInputValue = inputEl.value;   // restore the knob afterwards
  _micBatchActive = true;
  let completed = true;
  try {
    for (let vi = 0; vi < values.length && _micBatchActive; vi++) {
      const value = values[vi];
      localStorage.setItem('q2_sweep_active', JSON.stringify({ knob, inputId, value }));  // re-applied each run start
      inputEl.value = value;
      if (typeof sendMsrTuning === 'function') sendMsrTuning();
      const batchId = crypto.randomUUID();
      console.log(`[MICSWEEP] ${knob} value ${vi + 1}/${values.length} = ${value} runs=${runs} batch=${batchId}`);
      completed = await _micRunBatchLoop({
        batchId, bph, watchId, position, runs, runMs,
        tdm: knob === 'tickDetectMult' ? value : null,
        sweepParam: knob, sweepValue: value, btn,
        label: `Sweep ${vi + 1}/${values.length} ${knob}=${value}`,
      });
      if (!completed) break;
    }
  } finally {
    _micBatchActive = false;
    localStorage.removeItem('q2_sweep_active');
    if (inputEl) inputEl.value = prevInputValue;     // restore the knob to its pre-sweep value
    if (typeof sendMsrTuning === 'function') sendMsrTuning();
  }
  if (btn) btn.textContent = _MIC_SWEEP_LABEL;
  toast(completed ? `Mic sweep done (${knob}) — check data` : 'Mic sweep cancelled');
}
```

- [ ] **Step 2: Verify wiring**

Run: `grep -n "q2_sweep_knob\|resolveSweepKnob(knob)\|q2_sweep_active\|sweepParam: knob" index.html`
Expected: the knob read, resolution, active marker, and the loop passing `sweepParam`.

- [ ] **Step 3: Run the full suite**

Run: `npm test && npm run test:e2e`
Expected: all green. (E2E mocked may have 1-2 flaky timeouts unrelated; re-run once.)

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(tg): runMicSweep sweeps any native knob (q2_sweep_knob)"
```

---

## Task 5: SW bump + verification + sweep procedure

**Files:** Modify `sw.js`.

- [ ] **Step 1: Bump SW cache.** `grep -n "wristlog-v" sw.js`, increment by one.

- [ ] **Step 2: Full suite.** `npm test && npm run test:e2e` — all green.

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "chore(sw): bump cache version for generalized knob sweep"
```

- [ ] **Step 4: Regression check (default path unchanged).** With `tg_quality_v2` ON and NO `q2_sweep_knob` set, confirm the Mic Sweep still defaults to a `tickDetectMult` sweep (knob defaults to `tickDetectMult`, values default `0.3,0.25,0.2,0.15`) and logs `sweep_param=tickDetectMult`. Quick on-device check or reasoning from the defaults.

- [ ] **Step 5: maxPairThresh sweep on JLC (operating procedure — do not auto-run).**

On the relaunched app (flag on), set the knobs and run once:
```js
localStorage.setItem('q2_sweep_knob','maxPairThresh');
localStorage.setItem('q2_sweep_values','1.5,2.5,3.5,4.5');
// optional: localStorage.setItem('q2_sweep_runs','10'); localStorage.setItem('q2_sweep_secs','90');
```
Couple JLC, fixed position, note Weishi. Tap **Mic Sweep**. Then analyze per `sweep_value`:
```bash
npx supabase db query --linked "SELECT sweep_value, count(*) n, round(avg(n_ticks)) avg_n, round(stddev_samp(native_rate)::numeric,2) sd, round(avg(native_rate)::numeric,2) mean FROM public.measurement_batch_runs WHERE sweep_param='maxPairThresh' GROUP BY sweep_value ORDER BY sweep_value;"
```
plus PAIR_REJECT/PHASE_REJECT tally per value-window from `timegrapher_tick_logs`. **When done, set `localStorage.removeItem('q2_sweep_knob')` to return to the default tickDetectMult sweep.**

---

## Self-Review

**Spec coverage:**
- `sweep_param`/`sweep_value` columns → Task 2 + Task 3 Step 5. ✓
- `resolveSweepKnob` + `parseSweepValues` pure + tested + mirrored → Task 1 + Task 3 Steps 1-2. ✓
- Generalized `runMicSweep` (q2_sweep_knob/values/runs/secs; default tickDetectMult preserves behavior) → Task 4. ✓
- Start hook survives `tgApplySettingsToInputs` for any knob → Task 3 Step 3-4 (`_q2ApplyOverrides` applies `q2_sweep_active`, called after settings-apply). ✓
- try/finally restore (clear `q2_sweep_active`, restore input) → Task 4. ✓
- maxPairThresh-on-JLC experiment → Task 5 Step 5. ✓
- Flag-gated; default path unchanged → Task 5 Step 4 regression check; `_q2ApplyOverrides` early-returns when flag off. ✓
- Out of scope (B2 Swift, native defaults) → not present. ✓

**Placeholder scan:** No TBD/TODO; all steps have full code/commands.

**Type consistency:** `resolveSweepKnob`/`parseSweepValues` identical in `wrotate_test.js` and inline (VERBATIM). `q2_sweep_active` JSON shape `{knob, inputId, value}` written in `runMicSweep` (Task 4) and read in `_q2ApplyOverrides` (Task 3) — fields match (`inputId`, `value`). `_micRunBatchLoop` opts `sweepParam`/`sweepValue` (Task 3 Step 5) match the call in `runMicSweep` (Task 4). `_q2ApplyTdm` fully replaced by `_q2ApplyOverrides` (no dangling refs). ✓
