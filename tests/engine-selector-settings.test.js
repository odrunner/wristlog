import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// The Standard engine selector was RETIRED 2026-10-25 (it had moved from the Measure page
// to Advanced Settings on 2026-08-23 as the first step). These guard the retirement: no
// selector markup or choice plumbing may come back, while the Standard-only settings
// sections stay in place as the fallback UI for pre-2.1 binaries, which have no Pro V2.
// Engine semantics (_tgAlgo build fallback) live in tests/tg-engine-default.test.js.
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

  it('_tgAlgo is build-only: Pro V2 everywhere it exists', () => {
    const body = fnBody('_tgAlgo');
    expect(body).toContain("_proV2Available() ? 'tg' : 'original'");
  });

  it('the settings page still swaps sections for pre-2.1 builds', () => {
    expect(fnBody('openMsrSettings')).toContain('_msrSettingsApplyEngine()');
    const apply = fnBody('_msrSettingsApplyEngine');
    for (const id of ['msr-prov2-settings', 'msr-std-preset-section', 'msr-std-tuning-section']) {
      expect(apply).toContain(id);
    }
  });

  it('help and news no longer offer the Standard engine', () => {
    expect(html).not.toMatch(/[Pp]ick <strong>Standard<\/strong>/);
    expect(html).not.toContain('from the engine selector');
  });
});
