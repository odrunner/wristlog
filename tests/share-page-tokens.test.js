import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { render } from '../scripts/design-system/export_page_tokens.mjs';

// The public share pages and the unsubscribe page are rendered by edge functions on
// another origin, so they cannot load design-system.css. They carry a generated copy
// of the tokens they use (supabase/functions/_shared/page-tokens.ts) and read every
// colour, size, spacing, radius and weight from it. This test keeps both halves true:
// the copy equals the stylesheet, and no page types a value by hand.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const css = read('design-system.css');
const tokensFile = read('supabase/functions/_shared/page-tokens.ts');
const declared = new Set([...tokensFile.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

const PAGES = [
  ['share-post/lib.ts', 'PAGE_TOKENS_CSS'],
  ['share-collection/lib.ts', 'PAGE_TOKENS_CSS'],
  ['share-wishlist/lib.ts', 'PAGE_TOKENS_CSS'],
  ['share-recap/lib.ts', 'PAGE_TOKENS_CSS'],
  ['email-unsubscribe/lib.ts', 'TOKENS_LIGHT'],   // light only: the page has no dark theme
  ['_shared/share-comments-lib.ts', null],        // the comments block rides inside a share page
];
const styles = (src) => [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

describe('share pages carry the design system tokens', () => {
  it('page-tokens.ts is what the export script generates from design-system.css', () => {
    // Stale? Run: node scripts/design-system/export_page_tokens.mjs  (then redeploy the functions)
    expect(tokensFile).toBe(render(css));
    expect(declared.size).toBeGreaterThan(40);
  });
  for (const [file, tokenExport] of PAGES) {
    const src = read(`supabase/functions/${file}`);
    const style = styles(src);
    it(`${file}: no hand-typed value in its styles`, () => {
      expect(style.length).toBeGreaterThan(200);
      if (tokenExport) expect(style).toContain('${' + tokenExport + '}');
      const literals = style.match(/#[0-9a-fA-F]{3,8}\b|\d*\.?\d+(?:px|rem|s)\b|rgba?\(/g) || [];
      expect(literals).toEqual([]);
      for (const prop of ['font-weight', 'line-height', 'letter-spacing', 'opacity', 'z-index']) {
        const raw = [...style.matchAll(new RegExp(`${prop}:\\s*([^;}]+)`, 'g'))].map((m) => m[1]).filter((v) => !v.startsWith('var('));
        expect(`${prop}: ${raw.join(', ')}`).toBe(`${prop}: `);
      }
    });
    it(`${file}: every token it reads is in the copy`, () => {
      const used = new Set([...src.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
      expect(used.size).toBeGreaterThan(5);
      for (const name of used) expect(declared.has(name) ? 'ok' : name).toBe('ok');
    });
  }
});
