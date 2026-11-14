import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// The public share pages and the unsubscribe page are rendered by edge functions on
// another origin, so they cannot load design-system.css and carry a copy of its palette.
// This test is what keeps the copy equal to the source: change a colour in the
// stylesheet and it fails until the pages are updated (and redeployed).

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const css = read('design-system.css');

// `--name: #hex` pairs of the first block starting at `from`.
const tokens = (src, from) => {
  const body = src.slice(from, src.indexOf('}', from));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)].map((m) => [m[1], m[2].toLowerCase()]));
};
const light = tokens(css, css.indexOf(':root'));
const darkAt = css.search(/\[data-theme="dark"\]|prefers-color-scheme:\s*dark/);
const dark = tokens(css, css.indexOf('{', darkAt));

const PAGES = ['share-post', 'share-collection', 'share-wishlist', 'share-recap'];

describe('share pages carry the design system palette', () => {
  it('reads both themes from design-system.css', () => {
    expect(light['--bg']).toMatch(/^#/);
    expect(dark['--bg']).toMatch(/^#/);
    expect(dark['--bg']).not.toBe(light['--bg']);
  });
  for (const fn of PAGES) {
    it(`${fn}: every colour token equals the stylesheet's, light and dark`, () => {
      const src = read(`supabase/functions/${fn}/lib.ts`);
      const darkStart = src.indexOf('prefers-color-scheme: dark');
      expect(darkStart).toBeGreaterThan(0);
      const pageLight = tokens(src, src.lastIndexOf(':root', darkStart));
      const pageDark = tokens(src, src.indexOf(':root', darkStart));
      expect(Object.keys(pageLight).length).toBeGreaterThanOrEqual(7);
      expect(Object.keys(pageDark).length).toBeGreaterThanOrEqual(7);
      for (const [k, v] of Object.entries(pageLight)) expect(`${k}: ${v}`).toBe(`${k}: ${light[k]}`);
      for (const [k, v] of Object.entries(pageDark)) expect(`${k}: ${v}`).toBe(`${k}: ${dark[k]}`);
    });
  }
  it('the unsubscribe page uses only light palette colours (and white)', () => {
    const src = read('supabase/functions/email-unsubscribe/lib.ts');
    const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
    const used = new Set([...style.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()));
    const allowed = new Set([...Object.values(light), '#fff']);
    expect(used.size).toBeGreaterThan(2);
    for (const c of used) expect(allowed.has(c) ? 'ok' : c).toBe('ok');
  });
});
