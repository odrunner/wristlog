# Mic Detection-Threshold Sweep (`tickDetectMult`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-live-tunable `tickDetectMult` settable for an experiment — driven remotely via the `timegrapher_tuning` poll table (operator) and locally via an on-phone input (user) — so we can sweep the mic energy-detection threshold and measure its effect on detection% and repeatability. All flag-gated; no Swift change.

**Architecture:** `sendMsrTuning()` already pushes `tickDetectMult` (from hidden input `#msr-tune-tick-detect-mult`) to native `setTuning()` live. We add (a) a `tick_detect_mult` column to the `timegrapher_tuning` poll table, (b) flag-gated logic that resolves the effective value (local override > table > default) into that hidden input, and (c) an on-phone input to set the local override. A tiny pure `resolveTdm()` encodes the precedence and is unit-tested.

**Tech Stack:** Vanilla JS, Vitest, Playwright (mocked), Supabase. Pure logic in `wrotate_test.js` mirrored inline in `index.html` (guarded by `tests/mirror-drift.test.js`).

---

## File Structure

- `wrotate_test.js` — add exported `resolveTdm(override, table, def)`. *Modify.*
- `tests/timegrapher.test.js` — add `describe('resolveTdm')`. *Modify.*
- `tests/mirror-drift.test.js` — register `resolveTdm` in VERBATIM. *Modify.*
- `index.html` — inline `resolveTdm`; poll applies table value (flag-on, override-aware); `_q2ApplyTdm()` on start; on-phone `#msr-tdm-input` + `onTdmChange()` + visibility; dev readout `tdm=`. *Modify.*
- `sw.js` — bump cache. *Modify.*
- Supabase — add `tick_detect_mult` column (via `supabase db query --linked`). *DB.*

**Pre-commit hook:** `.git/hooks/pre-commit` auto-bumps `APP_VERSION` in `index.html` on every commit (1-line, expected). Keep the tree clean of unrelated WIP.

**Precedence contract (used everywhere):** `resolveTdm(override, table, def)` → the local override if it parses to a finite number > 0; else the table value if finite > 0; else `def`.

---

## Task 1: `resolveTdm` pure function (TDD)

**Files:**
- Modify: `wrotate_test.js` (add after `incrSettle`)
- Test: `tests/timegrapher.test.js` (new `describe` at end)

- [ ] **Step 1: Write the failing tests** — append to `tests/timegrapher.test.js`:

```js
import { resolveTdm } from '../wrotate_test.js';

describe('resolveTdm', () => {
  it('uses the local override when it is a positive number', () => {
    expect(resolveTdm('0.22', 0.3, 0.3)).toBe(0.22);
    expect(resolveTdm('0.22', null, 0.3)).toBe(0.22);
  });
  it('falls back to the table value when no valid override', () => {
    expect(resolveTdm('', 0.25, 0.3)).toBe(0.25);
    expect(resolveTdm(null, 0.25, 0.3)).toBe(0.25);
  });
  it('falls back to the default when neither is valid', () => {
    expect(resolveTdm(null, null, 0.3)).toBe(0.3);
    expect(resolveTdm('', null, 0.3)).toBe(0.3);
  });
  it('ignores non-positive / non-numeric values', () => {
    expect(resolveTdm('0', 0.25, 0.3)).toBe(0.25);    // 0 override ignored -> table
    expect(resolveTdm('-1', null, 0.3)).toBe(0.3);    // negative override ignored -> def
    expect(resolveTdm('abc', null, 0.3)).toBe(0.3);   // non-numeric -> def
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- timegrapher`
Expected: FAIL — `resolveTdm is not a function`.

- [ ] **Step 3: Implement in `wrotate_test.js`** — add after the `incrSettle` function:

```js
// Effective tickDetectMult: local override (>0) wins, else table value (>0), else default.
export function resolveTdm(override, table, def) {
  const o = parseFloat(override);
  if (isFinite(o) && o > 0) return o;
  const t = parseFloat(table);
  if (isFinite(t) && t > 0) return t;
  return def;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- timegrapher`
Expected: PASS (all `resolveTdm` cases; existing tests still pass).

- [ ] **Step 5: Commit**

```bash
git add wrotate_test.js tests/timegrapher.test.js
git commit -m "feat(tg): resolveTdm precedence helper + tests"
```

---

## Task 2: Add `tick_detect_mult` column to `timegrapher_tuning`

**Files:** DB only (`npx supabase db query --linked`).

- [ ] **Step 1: Add the column**

Run:
```bash
npx supabase db query --linked "ALTER TABLE public.timegrapher_tuning ADD COLUMN IF NOT EXISTS tick_detect_mult double precision;"
```
Expected: success (no error).

- [ ] **Step 2: Verify the column exists**

Run:
```bash
npx supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='timegrapher_tuning' AND column_name='tick_detect_mult';"
```
Expected: one row, `tick_detect_mult`.

- [ ] **Step 3: Round-trip the id=1 row (set, read, clear)**

Run:
```bash
npx supabase db query --linked "UPDATE public.timegrapher_tuning SET tick_detect_mult=0.3, updated_at=now() WHERE id=1; SELECT tick_detect_mult FROM public.timegrapher_tuning WHERE id=1;"
```
Expected: `tick_detect_mult = 0.3`. Then clear it so the column starts null (default behavior unaffected):
```bash
npx supabase db query --linked "UPDATE public.timegrapher_tuning SET tick_detect_mult=NULL, updated_at=now() WHERE id=1;"
```
Expected: success. (No code commit for this DB task.)

---

## Task 3: Inline `resolveTdm`, poll application, start-override apply

**Files:**
- Modify: `index.html` (inline `resolveTdm`; `startTuningPoll`; `_q2ApplyTdm()` + call on start)
- Modify: `tests/mirror-drift.test.js` (register `resolveTdm` VERBATIM)

- [ ] **Step 1: Add the inline copy of `resolveTdm`.** Find the inline `incrSettle` in `index.html` (search `function incrSettle(samples, params`). Immediately ABOVE its preceding comment block (i.e., just before the line `// quality v2 — incremental-stability settle test`), insert:

```js
// Effective tickDetectMult: local override (>0) wins, else table value (>0), else default.
function resolveTdm(override, table, def) {
  const o = parseFloat(override);
  if (isFinite(o) && o > 0) return o;
  const t = parseFloat(table);
  if (isFinite(t) && t > 0) return t;
  return def;
}
```

- [ ] **Step 2: Register in mirror-drift (VERBATIM).** In `tests/mirror-drift.test.js`, add `'resolveTdm'` to the `VERBATIM` array (the two copies are byte-identical).

- [ ] **Step 3: Apply the table value in the poll (flag-on, override-aware).** In `index.html`, find in `startTuningPoll`:

```js
      if (data.buffer_seconds != null) _remoteBufferSeconds = data.buffer_seconds;
```
Immediately AFTER it, add:

```js
      if (featureFlag('tg_quality_v2')) {
        const _tdmEl = document.getElementById('msr-tune-tick-detect-mult');
        if (_tdmEl) _tdmEl.value = resolveTdm(localStorage.getItem('q2_tick_detect_mult'), data.tick_detect_mult, 0.3);
      }
```

- [ ] **Step 4: Add `_q2ApplyTdm()` and call it on measurement start.** Add this function just above `function sendMsrTuning() {` (search `function sendMsrTuning`):

```js
// Apply a local tickDetectMult override (if set) to the hidden tuning input before tuning is sent.
function _q2ApplyTdm() {
  if (!featureFlag('tg_quality_v2')) return;
  const ov = localStorage.getItem('q2_tick_detect_mult');
  if (ov == null || ov === '') return;            // no override; let poll/default stand
  const v = resolveTdm(ov, null, null);
  const el = document.getElementById('msr-tune-tick-detect-mult');
  if (el && v != null) el.value = v;
}
```

Then find the start path line (it appears with `startTuningPoll();` right after two `setTimeout(... sendMsrTuning ...)` lines):
```js
    setTimeout(() => sendMsrTuning(), 200);
    setTimeout(() => sendPiezoTuning(), 200);
    startTuningPoll();
```
Replace it with (add the `_q2ApplyTdm()` call first):
```js
    _q2ApplyTdm();
    setTimeout(() => sendMsrTuning(), 200);
    setTimeout(() => sendPiezoTuning(), 200);
    startTuningPoll();
```

- [ ] **Step 5: Verify wiring + mirror guard**

Run: `grep -n "function resolveTdm\|_q2ApplyTdm\|q2_tick_detect_mult\|data.tick_detect_mult" index.html` and `npm test -- mirror-drift`
Expected: inline `resolveTdm`, `_q2ApplyTdm` def + call, the poll application, and the start-apply; mirror-drift passes (resolveTdm byte-identical in both files).

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run test:e2e`
Expected: all green. (E2E mocked may show 1–2 flaky timeouts unrelated to this change; re-run once — only a consistent, measurement-related failure is real.)

- [ ] **Step 7: Commit**

```bash
git add index.html tests/mirror-drift.test.js
git commit -m "feat(tg): tickDetectMult from table poll + local override (flag-gated)"
```

---

## Task 4: On-phone override input + dev readout

**Files:**
- Modify: `index.html` (visible `#msr-tdm-input`; `onTdmChange()`; visibility in `initTgSourceSelector`; dev readout `tdm=`)

- [ ] **Step 1: Add the visible input.** Find the mode select line (search `id="msr-mode-select"`). Immediately AFTER that `</select>`'s line (the select is a multi-line element ending in `</select>`), insert:

```html
          <input id="msr-tdm-input" type="number" step="0.01" min="0" placeholder="tickDetectMult (blank = default 0.3)" oninput="onTdmChange()" style="display:none;width:100%;margin-bottom:.4rem;padding:.4rem;border-radius:8px;border:1px solid rgba(96,165,250,.4);background:#0a1220;color:#93c5fd;font-size:.72rem;">
```

- [ ] **Step 2: Add the change handler.** Add immediately before `function onMsrModeChange() {` (search it):

```js
function onTdmChange() {
  const raw = (document.getElementById('msr-tdm-input')?.value || '').trim();
  if (raw === '') localStorage.removeItem('q2_tick_detect_mult');
  else localStorage.setItem('q2_tick_detect_mult', raw);
  const el = document.getElementById('msr-tune-tick-detect-mult');
  if (el) el.value = resolveTdm(localStorage.getItem('q2_tick_detect_mult'), null, 0.3);
  if (typeof sendMsrTuning === 'function') sendMsrTuning();
}
```

- [ ] **Step 3: Show the input when the flag is on.** In `initTgSourceSelector`, find:
```js
  const ms = document.getElementById('msr-mode-select');
  if (ms) { ms.style.display = mbOn ? '' : 'none'; ms.value = (localStorage.getItem('msr_mode') === 'quick') ? 'quick' : 'accurate'; }
```
Immediately AFTER it, add:
```js
  const td = document.getElementById('msr-tdm-input');
  if (td) { td.style.display = mbOn ? '' : 'none'; const _ov = localStorage.getItem('q2_tick_detect_mult'); if (_ov != null) td.value = _ov; }
```

- [ ] **Step 4: Show the active tickDetectMult in the dev readout.** In `_q2RenderReadout`, find:
```js
  el.textContent = `[${params.mode}] native ${natStr} | js ${js} s/d · band ±${band} · n${s.nTicks}${s.settled ? ' · SETTLED' : ''}`;
```
Replace with:
```js
  const tdm = document.getElementById('msr-tune-tick-detect-mult')?.value;
  el.textContent = `[${params.mode}] native ${natStr} | js ${js} s/d · band ±${band} · n${s.nTicks} · tdm=${tdm}${s.settled ? ' · SETTLED' : ''}`;
```

- [ ] **Step 5: Verify wiring**

Run: `grep -n "msr-tdm-input\|onTdmChange\|tdm=" index.html`
Expected: the input HTML + `oninput`, the handler, the visibility line, and the readout `tdm=`.

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run test:e2e`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(tg): on-phone tickDetectMult override input + dev readout tdm"
```

---

## Task 5: SW bump + verification + sweep procedure

**Files:** Modify `sw.js`.

- [ ] **Step 1: Bump SW cache.** Run `grep -n "wristlog-v" sw.js`, then increment the cache name by one (use the exact current value).

- [ ] **Step 2: Full suite**

Run: `npm test && npm run test:e2e`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "chore(sw): bump cache version for tickDetectMult sweep"
```

- [ ] **Step 4: Verification on device (record results; do not auto-push to prod without the user).**

After deploy + app relaunch with `tg_quality_v2` ON:
1. Operator sets a deliberately HIGH value: `npx supabase db query --linked "UPDATE public.timegrapher_tuning SET tick_detect_mult=0.6, updated_at=now() WHERE id=1;"`
2. On the phone, start a ~30s mic measurement; confirm the dev readout shows `tdm=0.6`, and detection drops (lower `n` / lower `TGDEBUG tickCount`-derived detection%).
3. Confirm the on-phone input also works: type `0.2`, confirm readout shows `tdm=0.2` and detection rises; clear it, confirm it returns to table/0.3.
4. If `tdm=` changes but detection does NOT move → the installed iOS build lacks live `tickDetectMult` support → STOP and report (needs a TestFlight build, separate spec).
5. Reset: `npx supabase db query --linked "UPDATE public.timegrapher_tuning SET tick_detect_mult=NULL, updated_at=now() WHERE id=1;"`

- [ ] **Step 5: Sweep (operating procedure, after verification passes).**

For `tickDetectMult` in 0.30, 0.25, 0.20, 0.15: operator sets it (`UPDATE ... SET tick_detect_mult=<v>, updated_at=now() WHERE id=1;`), user runs a 15×90s batch on the same watch/position, then measure detection% (`TGDEBUG tickCount`), repeatability (SD/range over `measurement_batch_runs`), and accuracy (vs Weishi). Record per value; pick the lowest threshold that raises detection% and tightens SD without beat-error/SD degradation. Repeat on a clean (Hamilton) and noisy (JLC) watch. Reset the column to NULL when done.

---

## Self-Review

**Spec coverage:**
- DB `tick_detect_mult` column → Task 2. ✓
- Table-driven sweep (operator), flag-gated, override-aware → Task 3 (poll application). ✓
- On-phone override, local-wins, persisted, clear-to-default → Task 4 (input + `onTdmChange`) + Task 3 (`_q2ApplyTdm` on start, poll precedence). ✓
- Dev readout `tdm=` → Task 4. ✓
- Precedence helper unit-tested → Task 1 (`resolveTdm`) + mirror guard Task 3. ✓
- Verification-first rollout → Task 5 Step 4. ✓
- Sweep + measurement procedure → Task 5 Step 5 (reuses existing tooling). ✓
- Flag-off unchanged → all new logic gated on `featureFlag('tg_quality_v2')`; the hidden input default stays 0.3 and the poll only touches it when flag-on. ✓
- Out of scope (Swift, other knobs, flag removal) → not present. ✓

**Placeholder scan:** No TBD/TODO; all code/commands complete.

**Type consistency:** `resolveTdm(override, table, def)` identical in `wrotate_test.js` and inline (VERBATIM); poll calls `resolveTdm(localStorage.getItem('q2_tick_detect_mult'), data.tick_detect_mult, 0.3)`; `onTdmChange`/`_q2ApplyTdm` use the same `q2_tick_detect_mult` key and `#msr-tune-tick-detect-mult` hidden input; readout reads that same hidden input. Consistent throughout. ✓
