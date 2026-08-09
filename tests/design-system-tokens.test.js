import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// The design tokens used to be copy-pasted into index.html, p/index.html and
// profile/index.html, plus a fourth inline copy under #auth-screen. r.html had
// already drifted on every one of them. design-system.css is now the only place
// these are declared; these tests are the guard that keeps it that way.
//
// Spec: docs/superpowers/specs/2026-08-08-design-system-tokens-design.md

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const css = readFileSync(join(root, 'design-system.css'), 'utf8');

// Tokens design-system.css owns. Nothing else may declare these.
export const SHARED_LIGHT = {
  '--bg': '#f5f5f8',
  '--surface': '#ffffff',
  '--surface2': '#eeeff5',
  '--border': '#d8d9e8',
  '--gold': '#9a7628',
  '--gold-lt': '#c9a84c',
  '--gold-dim': 'rgba(154,118,40,.12)',
  '--text': '#16161e',
  '--muted': '#70708a',
  '--danger': '#e05555',
  '--success': '#4caf7d',
  '--radius': '10px',
  '--overlay-bg': 'rgba(245,245,248,.96)',
  '--space-1': '4px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-5': '20px',
  '--space-6': '24px',
  '--space-8': '32px',
  '--radius-sm': '6px',
  '--radius-btn': '8px',
  '--radius-pill': '999px',
  '--fs-2xs': '.62rem',
  '--fs-xs': '.68rem',
  '--fs-sm': '.75rem',
  '--fs-base': '.82rem',
  '--fs-md': '.95rem',
  '--fs-lg': '1.1rem',
  '--fs-xl': '1.3rem',
  '--fs-2xl': '1.6rem',
  '--fs-3xl': '2.5rem',
  '--fw-normal': '400',
  '--fw-medium': '500',
  '--fw-semibold': '600',
  '--fw-bold': '700',
  '--lh-tight': '1.2',
  '--lh-snug': '1.4',
  '--lh-body': '1.55',
  '--icon-sm': '14px',
  '--icon-md': '16px',
  '--icon-lg': '20px',
  '--icon-xl': '24px',
  '--ls-eyebrow': '.08em',
  // Aliases of the tokens above. Declared 2026-08-08 after index.html was found
  // referencing them without ever declaring them. The indirection is deliberate:
  // it carries the dark values without a second declaration.
  '--hover': 'var(--surface2)',
  '--surface1': 'var(--surface2)',
  '--error': 'var(--danger)',
  '--fg': 'var(--text)',
  '--accent': 'var(--gold)',
};

export const SHARED_DARK = {
  '--bg': '#0b0b10',
  '--surface': '#141419',
  '--surface2': '#1c1c25',
  '--border': '#272734',
  '--gold': '#c9a84c',
  '--gold-lt': '#dbbe72',
  '--gold-dim': 'color-mix(in srgb, var(--gold) 12%, transparent)',
  '--text': '#e6e6f0',
  '--muted': '#7a7a95',
  '--overlay-bg': 'rgba(11,11,16,.94)',
  // The aliases are repeated here on purpose, not duplicated by accident: a
  // var() inside a custom property is substituted where it is DECLARED, so an
  // alias written only in :root freezes the light value and inherits it into
  // dark. Each theme must resolve its own.
  '--hover': 'var(--surface2)',
  '--surface1': 'var(--surface2)',
  '--error': 'var(--danger)',
  '--fg': 'var(--text)',
  '--accent': 'var(--gold)',
};

// Returns the text between a selector's braces. Takes the first '}' after the
// selector's '{', so this assumes the block isn't nested inside an @media or
// @supports wrapper — if it ever is, this silently returns a truncated block
// instead of the real one.
function blockFor(src, selector) {
  const at = src.indexOf(selector);
  if (at === -1) return null;
  const open = src.indexOf('{', at);
  const close = src.indexOf('}', open);
  return src.slice(open + 1, close);
}

// CSS custom properties declared in a stylesheet, or in an HTML file's <style>
// blocks. HTML is narrowed to <style> content first: a CSP meta tag contains
// "https://*.supabase.co", whose "/*" would otherwise open a bogus comment that
// swallows the real declarations. Block comments are then stripped, so a
// declaration preceded by a /* comment */ still counts and a commented-out one
// does not.
export function declaredIn(src) {
  const styles = [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  const css = styles.length ? styles.join('\n') : src;
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set();
  for (const m of withoutComments.matchAll(/(?:^|[;{])\s*(--[A-Za-z0-9_-]+)\s*:/g)) out.add(m[1]);
  return out;
}

// Custom properties referenced via var(), including the var(--x, fallback) form.
export function referencedIn(src) {
  const out = new Set();
  for (const m of src.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) out.add(m[1]);
  return out;
}

// href of every <link rel="stylesheet"> tag, regardless of attribute order.
// A page that links a second stylesheet — e.g. one that redeclares a token
// like --gold under a different file — would pass every other test in this
// suite; this is the one check that would catch it.
export function stylesheetHrefs(src) {
  const out = [];
  for (const m of src.matchAll(/<link\b[^>]*>/g)) {
    const tag = m[0];
    if (!/rel=["']stylesheet["']/.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/);
    if (href) out.push(href[1]);
  }
  return out;
}

describe('design-system.css', () => {
  it('declares every shared light token with the expected value', () => {
    const block = blockFor(css, ':root, [data-theme="light"]');
    expect(block).not.toBeNull();
    for (const [name, value] of Object.entries(SHARED_LIGHT)) {
      expect(block, `missing ${name}`).toContain(`${name}: ${value};`);
    }
  });

  it('declares every dark override with the expected value', () => {
    const block = blockFor(css, '[data-theme="dark"]');
    expect(block).not.toBeNull();
    for (const [name, value] of Object.entries(SHARED_DARK)) {
      expect(block, `missing ${name}`).toContain(`${name}: ${value};`);
    }
  });

  it('declares in dark exactly the overrides plus the re-resolved aliases', () => {
    const dark = declaredIn(blockFor(css, '[data-theme="dark"]'));
    expect([...dark].sort()).toEqual(Object.keys(SHARED_DARK).sort());
  });

  it('pairs :root with [data-theme="light"] so the forced-light landing screen works', () => {
    expect(css).toContain(':root, [data-theme="light"]');
  });
});

const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

// Referenced in index.html but declared nowhere. These three always carry a
// var() fallback, so they resolve to something sensible rather than resetting
// the property — which is why they were left alone when --accent, --error,
// --fg, --hover and --surface1 were declared as aliases on 2026-08-08.
// See audit-results/2026-08-08-design-system-tokens-review.md.
const KNOWN_UNDECLARED = ['--bg-secondary', '--bg2', '--tertiary'];

describe('index.html', () => {
  it('links design-system.css before its inline style block', () => {
    const link = indexHtml.indexOf('<link rel="stylesheet" href="/design-system.css">');
    const style = indexHtml.indexOf('<style>');
    expect(link).toBeGreaterThan(-1);
    expect(link).toBeLessThan(style);
  });

  it('re-declares none of the tokens design-system.css owns', () => {
    const dupes = [...declaredIn(indexHtml)].filter(t => t in SHARED_LIGHT);
    expect(dupes).toEqual([]);
  });

  it('links only design-system.css as a stylesheet', () => {
    const hrefs = [...new Set(stylesheetHrefs(indexHtml))];
    expect(hrefs, `unexpected stylesheet link(s): ${hrefs.join(', ') || '(none)'}`).toEqual(['/design-system.css']);
  });

  it('still declares its page-local tokens', () => {
    const declared = declaredIn(indexHtml);
    for (const t of ['--vis-friends', '--warn', '--badge-text', '--badge-ink', '--promo-gold']) {
      expect(declared.has(t), `${t} should stay in index.html`).toBe(true);
    }
  });

  it('references no token that nothing declares', () => {
    const declared = declaredIn(indexHtml);
    const orphans = [...referencedIn(indexHtml)]
      .filter(t => !(t in SHARED_LIGHT) && !declared.has(t) && !KNOWN_UNDECLARED.includes(t));
    expect(orphans).toEqual([]);
  });
});

describe.each([
  ['p/index.html'],
  ['profile/index.html'],
])('%s', (relPath) => {
  const src = readFileSync(join(root, relPath), 'utf8');

  it('links design-system.css before its inline style block', () => {
    const link = src.indexOf('<link rel="stylesheet" href="/design-system.css">');
    expect(link).toBeGreaterThan(-1);
    expect(link).toBeLessThan(src.indexOf('<style>'));
  });

  it('declares no custom properties of its own', () => {
    expect([...declaredIn(src)]).toEqual([]);
  });

  it('links only design-system.css as a stylesheet', () => {
    const hrefs = [...new Set(stylesheetHrefs(src))];
    expect(hrefs, `unexpected stylesheet link(s): ${hrefs.join(', ') || '(none)'}`).toEqual(['/design-system.css']);
  });

  it('references only tokens that design-system.css owns', () => {
    const unowned = [...referencedIn(src)].filter(t => !(t in SHARED_LIGHT));
    expect(unowned).toEqual([]);
  });

  it('would notice a re-added token declaration', () => {
    const withToken = src.replace('<style>', '<style>\n    :root { --bg: #fff; }');
    expect([...declaredIn(withToken)]).toEqual(['--bg']);
  });
});

describe('sw.js', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');

  // Assets are served stale-while-revalidate, so without a precache entry a
  // token change would land one page-load late, and an offline launch would
  // render untokenized.
  it('precaches design-system.css', () => {
    const match = sw.match(/const PRECACHE = \[(.*?)\];/s);
    expect(match, "couldn't find 'const PRECACHE = [...]' in sw.js").not.toBeNull();
    expect(match[1]).toContain("'/design-system.css'");
  });

  // The branch started at v1042. A bump is what makes activate() purge the old
  // cache, so clients fetch the new design-system.css instead of a stale copy.
  it('has had its cache version bumped past the branch base', () => {
    const match = sw.match(/const CACHE = 'wristlog-v(\d+)';/);
    expect(match, "couldn't find \"const CACHE = 'wristlog-vNN'\" in sw.js").not.toBeNull();
    expect(Number(match[1])).toBeGreaterThan(1043);
  });
});
