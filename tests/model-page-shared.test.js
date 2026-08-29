import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// model-page.js is loaded by BOTH index.html and w/index.html; its pure
// helpers are mirrored in wrotate_test.js for unit testing. Keep them
// byte-identical (ignoring the `export` keyword and whitespace).
const NAMES = ['sparklinePath', 'valueTrendSummary', 'wearIndexPhrase', 'fmtRate', 'barPcts', 'histTone', 'featuredFactIndex'];
const shared = readFileSync('model-page.js', 'utf8');
const mirror = readFileSync('wrotate_test.js', 'utf8');

function body(src, name) {
  const m = src.match(new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`));
  if (!m) return null;
  // params may contain parens (default values like `new Date()`): walk to the
  // matching ')' then to the matching '}' of the body.
  let i = m.index + m[0].length, depth = 1;
  while (depth && i < src.length) { const c = src[i++]; if (c === '(') depth++; else if (c === ')') depth--; }
  const j = src.indexOf('{', i); i = j + 1; depth = 1;
  while (depth && i < src.length) { const c = src[i++]; if (c === '{') depth++; else if (c === '}') depth--; }
  return src.slice(m.index + m[0].length, i).replace(/\s+/g, ' ').trim();
}

describe('model-page.js helpers mirror wrotate_test.js', () => {
  for (const n of NAMES) {
    it(n, () => {
      expect(body(shared, n), `${n} missing from model-page.js`).not.toBeNull();
      expect(body(mirror, n), `${n} missing from wrotate_test.js`).not.toBeNull();
      expect(body(shared, n)).toBe(body(mirror, n));
    });
  }
  it('index.html loads the shared renderer and no longer carries its own copy', () => {
    const idx = readFileSync('index.html', 'utf8');
    expect(idx).toContain('<script src="/model-page.js"></script>');
    expect(idx.includes('function renderModelPage(el, ctx, h)')).toBe(false);
    expect(readFileSync('sw.js', 'utf8')).toContain("'/model-page.js'");
  });
});
