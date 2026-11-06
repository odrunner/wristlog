import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Every .overlay carrying role="dialog" must be in _overlayCloseMap, or Escape
// and background-click silently do nothing and the dialog reads as frozen to a
// keyboard user. This bug class recurred twice (audit U2 2026-08-13: four
// dialogs; audit U1 2026-11-06: dm-send-modal, push-ask-modal,
// follow-sugg-modal) — this test ends the pattern: a new dialog either gets a
// map entry or a documented exclusion here.

// Deliberately not closeable via Escape/background-click:
const EXCLUDED = [
  'eula-modal', // consent gate — the map's own comment excludes it
];

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('_overlayCloseMap covers every overlay dialog', () => {
  const mapStart = html.indexOf('const _overlayCloseMap');
  const mapSrc = html.slice(mapStart, html.indexOf('};', mapStart));
  const keys = [...mapSrc.matchAll(/^\s*'([\w-]+)':/gm)].map(m => m[1]);

  const dialogs = [...html.matchAll(/<div[^>]*class="[^"]*\boverlay\b[^"]*"[^>]*>/g)]
    .filter(m => /role="dialog"/.test(m[0]))
    .map(m => (m[0].match(/id="([^"]+)"/) || [])[1])
    .filter(Boolean);

  it('found the map and a realistic number of dialogs', () => {
    expect(mapStart).toBeGreaterThan(-1);
    expect(keys.length).toBeGreaterThan(30);
    expect(dialogs.length).toBeGreaterThan(30);
  });

  for (const id of [...new Set(dialogs)]) {
    if (EXCLUDED.includes(id)) continue;
    it(`${id} closes on Escape and background click`, () => {
      expect(keys).toContain(id);
    });
  }

  it('excluded dialogs actually exist (stale exclusions get deleted)', () => {
    for (const id of EXCLUDED) expect(dialogs).toContain(id);
  });
});
