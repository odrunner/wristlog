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
};

// Returns the text between a selector's braces.
function blockFor(src, selector) {
  const at = src.indexOf(selector);
  if (at === -1) return null;
  const open = src.indexOf('{', at);
  const close = src.indexOf('}', open);
  return src.slice(open + 1, close);
}

// Custom properties declared in a chunk of CSS or HTML.
export function declaredIn(src) {
  const out = new Set();
  for (const m of src.matchAll(/(?:^|[;{])\s*(--[A-Za-z0-9_-]+)\s*:/g)) out.add(m[1]);
  return out;
}

// Custom properties referenced via var(), including the var(--x, fallback) form.
export function referencedIn(src) {
  const out = new Set();
  for (const m of src.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) out.add(m[1]);
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

  it('overrides only the tokens that actually differ between themes', () => {
    const dark = declaredIn(blockFor(css, '[data-theme="dark"]'));
    expect([...dark].sort()).toEqual(Object.keys(SHARED_DARK).sort());
  });

  it('pairs :root with [data-theme="light"] so the forced-light landing screen works', () => {
    expect(css).toContain(':root, [data-theme="light"]');
  });
});
