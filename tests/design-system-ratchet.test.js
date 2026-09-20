import { describe, it, expect } from 'vitest';
import { countAll, countHardcoded, readBudget, PAGES } from '../scripts/ds-count.mjs';

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

  it('ignores HTML entities, fragment links and 4-letter ids that look like hex', () => {
    const c = countHardcoded(`<a href="#feed">&#128512; &#169;</a><a href="/x#abc">`);
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
});
