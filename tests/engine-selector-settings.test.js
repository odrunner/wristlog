import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// The engine dropdown (Pro V2 / Standard) moved from the Measure page to the
// Advanced Settings page on 2026-08-23 — first step of retiring the Standard
// engine. These guard the move: the selector must live on the settings page
// only, be synced when the page opens, and swap the Pro V2 / Standard settings
// sections live when changed. Engine-choice SEMANTICS (session-only, Pro V2
// default) are covered in tests/tg-engine-default.test.js and must not change.

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Slice a top-level `function name(` body out of index.html.
function fnBody(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start === -1) return '';
  return html.slice(start, html.indexOf('\n}', start));
}

describe('engine selector lives on the Advanced Settings page', () => {
  it('renders exactly one selector, inside page-msr-settings', () => {
    expect(html.split('id="tg-algo-sel"').length - 1).toBe(1);
    const page = html.indexOf('id="page-msr-settings"');
    const sel = html.indexOf('id="tg-algo-sel"');
    const proV2Section = html.indexOf('id="msr-prov2-settings"');
    expect(page).toBeGreaterThan(-1);
    expect(sel).toBeGreaterThan(page);
    expect(sel).toBeLessThan(proV2Section);
  });

  it('openMsrSettings gates the section by build and mirrors the running engine', () => {
    const body = fnBody('openMsrSettings');
    expect(body).toContain('msr-engine-section');
    expect(body).toContain('_proV2Available()');
    expect(body).toMatch(/algoSel\.value = _tgAlgo\(\)/);
  });

  it('changing the engine swaps the settings sections live', () => {
    // Without this, picking Standard on the settings page would keep showing
    // Pro V2's precision cards until the page was closed and reopened.
    expect(fnBody('onTgAlgo')).toContain('_msrSettingsApplyEngine()');
    const apply = fnBody('_msrSettingsApplyEngine');
    for (const id of ['msr-prov2-settings', 'msr-std-preset-section', 'msr-std-tuning-section']) {
      expect(apply).toContain(id);
    }
  });

  it('the Measure page init no longer touches the selector', () => {
    // The old measure-page block set the selector's style/value from Measure
    // init; left behind, it would fight the settings page's availability gate.
    expect(fnBody('initTgSourceSelector')).not.toContain('tg-algo-sel');
  });
});
