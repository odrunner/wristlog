import { describe, it, expect } from 'vitest';
import { countAll, countHardcoded, isTokenised, isDesignStyle, readBudget, PAGES } from '../scripts/ds-count.mjs';

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

describe('countHardcoded', () => {
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
