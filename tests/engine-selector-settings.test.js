import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// The Standard engine selector was RETIRED 2026-10-25 (it had moved from the Measure page
// to Advanced Settings on 2026-08-23 as the first step). These guard the retirement: no
// selector markup or choice plumbing may come back. The Standard-only settings sections
// and the pre-2.1 'original' fallback went on 2026-11-15 (field 100% on 2.5+).
// Engine semantics live in tests/tg-engine-default.test.js.
// The removed code is archived in docs/archive/standard-engine-selector-retired-2026-10-25.md.

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Slice a top-level `function name(` body out of index.html.
function fnBody(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start === -1) return '';
  return html.slice(start, html.indexOf('\n}', start));
}

describe('the Standard engine selector is retired', () => {
  it('no selector markup or choice plumbing remains', () => {
    for (const marker of ['id="tg-algo-sel"', 'id="msr-engine-section"', 'id="tg-algo-hint"',
                          'function onTgAlgo(', '_tgAlgoSel']) {
      expect(html).not.toContain(marker);
    }
  });

  it('_tgAlgo is Pro V2, with no build fallback', () => {
    expect(html).toContain("function _tgAlgo() { return 'tg'; }");
    expect(html).not.toContain('_proV2Available');
  });

  it('the Standard-only settings sections and their handlers are gone', () => {
    for (const marker of ['msr-std-preset-section', 'msr-std-tuning-section', 'msr-adv-', 'tgSelectPreset(', 'tgSliderChanged(',
                          'function tgLoadSettingsToUI(']) {
      expect(html).not.toContain(marker);
    }
  });

  it('the settings page shows the Pro V2 settings without a script un-hiding them', () => {
    expect(fnBody('openMsrSettings')).toContain('_msrSettingsApplyEngine()');
    expect(html).toMatch(/<div id="msr-prov2-settings" class="[^"]*">/);
    expect(fnBody('_msrSettingsApplyEngine')).toContain('msr-prov2-precision');
  });

  it('Restore Defaults still resets the stored tuning the tick detector reads', () => {
    expect(fnBody('tgResetDefaults')).toContain("tgSaveSettings('default', { ...TG_PRESETS.default })");
  });

  it('help and news no longer offer the Standard engine', () => {
    expect(html).not.toMatch(/[Pp]ick <strong>Standard<\/strong>/);
    expect(html).not.toContain('from the engine selector');
  });
});
