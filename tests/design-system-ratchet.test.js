import { describe, it, expect } from 'vitest';
import { countAll, countHardcoded, isTokenised, isDesignStyle, readBudget, withoutEmailRanges, PAGES } from '../scripts/ds-count.mjs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The ratchet. Every page that links design-system.css has a budget of
// hardcoded design values per category (tests/design-system-budget.json). New
// code may not add to it: style with a token or a shared class instead. After
// removing hardcoded values, lock the gain in with
// `node scripts/ds-count.mjs --write` — it refuses to raise a number.
//
// Audit + plan: audit-results/2026-09-20-design-system-audit.md

describe('design-system ratchet', () => {
  const budget = readBudget();
  const now = countAll();

  it.each(PAGES)('%s adds no hardcoded design values', (page) => {
    const over = Object.entries(now[page])
      .filter(([cat, n]) => n > budget[page][cat])
      .map(([cat, n]) => `${cat}: ${n} > budget ${budget[page][cat]}`);
    expect(over, `${page} went over its budget — use a design-system.css token or a shared class`).toEqual([]);
  });

  it('budgets every page and category the counter reports', () => {
    for (const page of PAGES) {
      expect(Object.keys(budget[page] || {}).sort()).toEqual(Object.keys(now[page]).sort());
    }
  });
});

// Every style="" left in the app builds its value or its attributes at runtime (a watch's colour, a progress
// width, a conditional attribute). A style that could have been a class must be one: scripts/design-system/
// inline_to_classes.py converts them, and design-system.css carries the roles and single-purpose classes.
// The generated classes replace inline styles, so they have to win wherever an inline style did. Their
// selector repeats the class name; that repeat must stay above the heaviest class-based selector anyone writes.
describe('generated classes outweigh hand-written selectors', () => {
  const MARK = '/* ── Generated: roles and single-purpose classes ── */';
  const css = readFileSync(join(root, 'design-system.css'), 'utf8');
  const [before, generated] = css.split(MARK);
  const weigh = (sel) => (sel.match(/\.[\w-]+/g) || []).length + (sel.match(/\[[^\]]*\]/g) || []).length + (sel.match(/:(?!:)(?!not\b)[\w-]+/g) || []).length;
  it('repeats the class name more than the heaviest selector in the codebase', () => {
    const hand = [before, ...['index.html', 'p/index.html', 'profile/index.html', 'w/index.html', 'open.html']
      .map(f => readFileSync(join(root, f), 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/g)?.join('\n') || '')].join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    let heaviest = 0;
    for (const [, sel] of hand.matchAll(/([^{}]+)\{/g))
      for (const one of sel.split(','))
        if (!one.trim().startsWith('@') && !one.includes('#')) heaviest = Math.max(heaviest, weigh(one));
    const repeats = Math.min(...[...generated.matchAll(/^(\.[\w-]+)+(?=\s*\{)/gm)].map(m => (m[0].match(/\./g) || []).length));
    expect(repeats, `generated classes repeat ${repeats}x but a hand-written selector weighs ${heaviest}`).toBeGreaterThan(heaviest);
  });
});

// A generated class must not quietly redefine a class the app already has: .text-danger is colour only, and a
// role of the same name once added a font size to every existing use of it.
describe('generated classes do not redefine hand-written ones', () => {
  it('any name shared with hand-written CSS carries the same declarations', () => {
    const MARK = '/* ── Generated: roles and single-purpose classes ── */';
    const css = readFileSync(join(root, 'design-system.css'), 'utf8');
    const [hand, generated] = css.split(MARK);
    const pageCss = ['index.html', 'p/index.html', 'profile/index.html', 'w/index.html', 'open.html']
      .map(f => (readFileSync(join(root, f), 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).join('\n')).join('\n');
    const norm = (b) => b.split(';').map(d => d.trim().replace(/\s+/g, ' ')).filter(Boolean).sort().join('; ');
    const handRules = new Map();
    for (const m of (hand + pageCss).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(^|\})\s*\.([\w-]+)\s*\{([^}]*)\}/g))
      if (!handRules.has(m[2])) handRules.set(m[2], norm(m[3]));
    const clashes = [];
    for (const m of generated.matchAll(/^\.([\w-]+)(?:\.[\w-]+)*\s*\{([^}]*)\}/gm))
      if (handRules.has(m[1]) && handRules.get(m[1]) !== norm(m[2])) clashes.push(`${m[1]}: app has "${handRules.get(m[1])}", generated has "${norm(m[2])}"`);
    expect(clashes, 'rename the role, or reuse the existing class as it is').toEqual([]);
  });
});

describe('no static inline styles', () => {
  it.each(['index.html', 'model-page.js'])('%s styles only what it computes at runtime', (f) => {
    const src = withoutEmailRanges(readFileSync(join(root, f), 'utf8'));
    const BEHAVIOUR = new Set(['display', 'visibility', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'overflow', 'overflow-x', 'overflow-y', 'pointer-events', 'transform', 'clip', 'z-index']);
    const stuck = [];
    for (const m of src.matchAll(/<[a-zA-Z][^<>]*style=(\\?["'])((?:(?!\1).)*)\1[^<>]*>/g)) {
      const [tag, , body] = m;
      if (/\$\{/.test(tag) || /['"`]/.test(body)) continue;                  // built at runtime
      const design = body.split(';').map(d => d.trim()).filter(d => d.includes(':'))
        .filter(d => !BEHAVIOUR.has(d.split(':')[0].trim().toLowerCase()));
      if (design.length) stuck.push(tag.slice(0, 120));
    }
    expect(stuck, 'give these a class (scripts/design-system/inline_to_classes.py)').toEqual([]);
  });
});

describe('countHardcoded', () => {
  it('counts opacity literals; 0, 1 and tokens are not design values', () => {
    expect(countHardcoded('.a { opacity: .6; } .b { opacity: 0; } .c { opacity: 1; } .d { opacity: var(--opacity-soft); }').opacity).toBe(1);
    expect(countHardcoded("el.style.cssText = 'opacity:.4;'").opacity).toBe(1);
  });

  it('counts px/rem sizes and positions not read from a token; %, em and 0 are not figures', () => {
    const c = countHardcoded('.a { width: 32px; } .b { max-width: var(--size-120); } .c { top: calc(-1 * var(--size-1)); } .d { width: 100%; height: 1.75em; left: 0; } .e { right: calc(50vw - 235px); }');
    expect(c.size).toBe(2);
  });

  it('skips only the listed exceptions: first-paint colour, favicon data URL, Google logo colours', () => {
    expect(countHardcoded('<meta name="theme-color" content="#f5f5f8">').color).toBe(0);
    expect(countHardcoded('const svg = `<svg><rect fill="#0b0b10"/><circle fill="#c9a84c"/></svg>`;').color).toBe(0);
    expect(countHardcoded('<path fill="#4285F4"/><path fill="#34A853"/><path fill="#FBBC05"/><path fill="#EA4335"/>').color).toBe(0);
    // anything else next to them still counts
    expect(countHardcoded('<path fill="#4285F5"/><meta name="description" content="#f5f5f8"> <rect fill="#0b0b10"/>').color).toBe(3);
  });

  it('counts literals and skips tokens, neutrals and template holes', () => {
    const c = countHardcoded(`<style>
      .a { color: #fff; background: rgba(0,0,0,.5); font-size: .8rem; padding: 0; margin: 0 auto; }
      .b { color: var(--text); font-size: var(--fs-sm); border-radius: var(--radius-btn); gap: \${g}px; }
      :root { --local: #123456; }
    </style>`);
    expect(c.color).toBe(2);
    expect(c['font-size']).toBe(1);
    expect(c.padding).toBe(0);
    expect(c.margin).toBe(0);
    expect(c['border-radius']).toBe(0);
    expect(c.gap).toBe(0);
  });

  it('counts a half-swapped shorthand as still hardcoded', () => {
    expect(isTokenised('var(--space-2)')).toBe(true);
    expect(isTokenised('0 var(--space-4)')).toBe(true);
    expect(isTokenised('color var(--dur-fast), opacity var(--dur-fast)')).toBe(true);
    expect(isTokenised('.4rem var(--space-2)')).toBe(false);
    expect(isTokenised('calc(var(--header-h) + .6rem)')).toBe(false);
    expect(isTokenised('.5rem')).toBe(false);
  });

  it('ignores HTML entities, fragment links and 4-letter ids that look like hex', () => {
    const c = countHardcoded(`<a href="#feed">&#128512; &#169;</a><a href="/x#abc"><style>#af2-sheet, #abc-list { }</style>`);
    expect(c.color).toBe(0);
  });

  it('counts inline style attributes and design-property assignments in JS', () => {
    const c = countHardcoded(`<div style="x"></div><script>
      el.style.color = '#f00'; el.style.display = 'none'; el.style.color = 'var(--muted)'; el.style.fontSize = '12px';
      h = '<b style=\\"y\\">';
    </script>`);
    expect(c['inline-style-attr']).toBe(2);
    expect(c['js-style-assign']).toBe(2);
  });

  // Phase 4 step 5: behaviour and data are not design decisions. `display:none` is state JS toggles;
  // `width:${pct}%` is a value from the data. Neither would change in a redesign, so neither counts.
  it('does not count device insets, JS-quoted neutral values or runtime token reads', () => {
    expect(isTokenised('env(safe-area-inset-top, 0)')).toBe(true);
    expect(isTokenised('max(var(--space-3), env(safe-area-inset-top, 0))')).toBe(true);
    expect(isTokenised('max(.8rem, env(safe-area-inset-top, 0))')).toBe(false);   // the .8rem is still a figure
    const c = countHardcoded("<script>Object.assign(s, { margin: '0', transition: 'none' }); x = { padding: dsPx('--space-2') };</script>");
    expect(c['margin'] + c['transition'] + c['padding']).toBe(0);
  });

  it('treats a negated token as tokenised, but not a negated figure', () => {
    expect(isTokenised('calc(-1 * var(--space-7))')).toBe(true);
    expect(isTokenised('calc(-1 * var(--space-2)) var(--space-4)')).toBe(true);
    expect(isTokenised('calc(-1 * 28px)')).toBe(false);
    expect(isTokenised('calc(-2 * var(--space-2))')).toBe(false);          // a multiplier other than -1 is a figure
  });

  it('does not count behaviour-only or data-driven inline styles', () => {
    expect(isDesignStyle('display:none')).toBe(false);
    expect(isDesignStyle('display:none;position:absolute;top:0')).toBe(false);
    expect(isDesignStyle('width:${pct}%;background:${w.color}')).toBe(false);
    expect(isDesignStyle('display:none;margin-bottom:var(--space-3)')).toBe(true);   // the margin is a decision
    expect(isDesignStyle('color:var(--muted)')).toBe(true);
    expect(isDesignStyle('width:${pct}%;color:var(--muted)')).toBe(true);
    const c = countHardcoded('<div style="display:none"></div><div style="color:red"></div><i style="width:${w}%"></i>');
    expect(c['inline-style-attr']).toBe(1);
  });
});
