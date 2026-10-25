# Standard engine selector — retired 2026-10-25

The Standard (original) detection engine's user-facing selector was removed from the app.
Every native 2.1+ build now runs **Pro V2** unconditionally; `_tgAlgo()` returns `'original'`
only for pre-2.1 binaries, which don't contain Pro V2 at all (field adoption at retirement:
100% of sessions on 2.5+). The Standard engine CODE is untouched: it lives on inside
`TimegrapherEngine.swift` / `TimegrapherCore.kt` (its tick detector and regression feed
shared internals, and it is all a pre-2.1 binary has), and the Standard-only settings
sections (`msr-std-preset-section` / `msr-std-tuning-section`) remain in `index.html` as the
pre-2.1 fallback UI, toggled by `_msrSettingsApplyEngine()`.

Retirement timeline:
- 2026-08-02: engine pick demoted from localStorage to session-only (`_tgAlgoSel`).
- 2026-08-23: selector moved off the Measure page to Advanced Settings.
- 2026-10-25: selector + per-session choice removed (this file).

## Removed from index.html (Advanced Settings page markup)

```html
<!-- Detection core selector. Pro V2 is the default; Standard is the session-only opt-out.
     Shown only on native 2.1+ builds (both engines live in the native app). -->
<div id="msr-engine-section" class="u-mb-5" style="display:none;">
  <div class="text-meta u-fw-semibold u-mb-2 u-ls-tight">ENGINE</div>
  <select id="tg-algo-sel" onchange="onTgAlgo(this.value)" class="text-default u-w-100pct u-mb-1-5 u-pt-2 u-pr-2 u-pb-2 u-pl-2 u-r-btn u-bd-1px-solid-border u-bg-surface">
    <option value="tg">Pro V2 ⚡ (recommended)</option>
    <option value="original">Standard</option>
  </select>
  <div id="tg-algo-hint" class="text-caption u-mt-calc-1-0-5 u-mr-0 u-mb-2-5 u-ml-0-5 u-lh-snug">Pro V2 measures amplitude (°) and holds steadier between runs. Picking Standard lasts until the app is next relaunched.</div>
</div>
```

## Removed from index.html (choice plumbing)

```js
// Engine choice for THIS app session only — deliberately not persisted. Pro V2 is the
// better engine and gains accuracy with every release, so a user who tried Standard once
// must not be silently frozen on the older path forever; before 2026-08-02 the pick lived in
// localStorage and did exactly that. Holds until the WebView reloads or the app relaunches,
// then falls back to Pro V2. Standard stays one tap away for anyone who wants it now.
let _tgAlgoSel = null;   // 'original' | 'tg' | null = default (Pro V2)
function _tgAlgo() {
  if (!_proV2Available()) return 'original';   // engine not in this build
  return _tgAlgoSel === 'original' ? 'original' : 'tg';
}
function onTgAlgo(v) {
  _tgAlgoSel = v;
  _msrSettingsApplyEngine();   // selector lives on the Advanced Settings page — swap its sections live
}
```

Also removed: `openMsrSettings()`'s selector show/hide + value-mirror lines
(`msr-engine-section` display gate on `_proV2Available()`, `algoSel.value = _tgAlgo()`).

## To resurrect

Restore the markup + plumbing above, point `openMsrSettings()` back at the section, and
revert `_tgAlgo()` to read `_tgAlgoSel`. Session logs and the weekly scripts never keyed on
the selector — they read the engine from each session's `algo:`/`[TGSTART] useTg=` truth, so
historical data is unaffected either way.
