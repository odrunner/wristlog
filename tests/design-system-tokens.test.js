import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { EMAIL_RANGES } from '../scripts/ds-count.mjs';
import { STAMPED, dsHash, stamp } from '../scripts/ds-stamp.mjs';

// The design tokens used to be copy-pasted into index.html, p/index.html and
// profile/index.html, plus a fourth inline copy under #auth-screen. r.html had
// already drifted on every one of them. design-system.css is now the only place
// these are declared; these tests are the guard that keeps it that way.
//
// Spec: docs/superpowers/specs/2026-08-08-design-system-tokens-design.md

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const css = readFileSync(join(root, 'design-system.css'), 'utf8');
// The stylesheet is always loaded by a URL carrying its content hash — see scripts/ds-stamp.mjs.
const DS_URL = `/design-system.css?v=${dsHash()}`;
const DS_LINK = `<link rel="stylesheet" href="${DS_URL}">`;

// Tokens design-system.css owns. Nothing else may declare these.
export const SHARED_LIGHT = {
  '--bg': '#f5f5f8',
  '--surface': '#ffffff',
  '--surface2': '#eeeff5',
  '--border': '#d8d9e8',
  '--gold': '#9a7628',
  // Gold as TEXT needs to be darker than gold as a surface: #9a7628 measures 3.66
  // on --surface2, below the 4.5:1 AA floor. Darkening --gold itself would have
  // fixed 113 text rules and broken 47 background ones (buttons 4.70 -> 3.81),
  // so the two uses carry two values. Audit U5.
  '--gold-text': '#8b6719',
  '--gold-lt': '#c9a84c',
  '--gold-dim': 'rgba(154,118,40,.12)',
  '--text': '#16161e',
  // Darkened from #70708a on 2026-08-14 (audit U5): the old value measured 4.41:1
  // on --bg and 4.18:1 on --surface2, under the 4.5:1 WCAG AA floor for body text.
  '--muted': '#6a6a84',
  '--danger': '#e05555',
  '--success': '#4caf7d',
  // Danger/success as TEXT, same split as --gold-text: the base values measure
  // 3.27–3.75 and 2.37–2.71 on the light surfaces. #b03636 / #27714b clear
  // 4.5:1 on all three. Audit 2026-09-01 A3.
  '--danger-text': '#b03636',
  '--success-text': '#27714b',
  '--radius': '10px',
  '--overlay-bg': 'rgba(245,245,248,.96)',
  '--space-1': '.25rem',
  '--space-2': '.5rem',
  '--space-3': '.75rem',
  '--space-4': '1rem',
  '--space-5': '1.25rem',
  '--space-6': '1.5rem',
  '--space-8': '2rem',
  '--space-0-5': '.125rem',
  '--space-1-5': '.375rem',
  '--space-2-5': '.625rem',
  '--space-3-5': '.875rem',
  '--radius-xs': '4px',
  '--radius-sm': '6px',
  '--radius-lg': '16px',
  '--radius-round': '50%',
  '--lh-none': '1',
  '--ls-tight': '.04em',
  '--fs-input': '1rem',
  '--fs-3xs': '.56rem',
  '--radius-btn': '8px',
  '--radius-pill': '999px',
  '--fs-body': '.9375rem',
  '--fs-2xs': '.62rem',
  '--fs-xs': '.68rem',
  '--fs-sm': '.75rem',
  '--fs-base': '.82rem',
  '--fs-md': '.88rem',
  '--fs-lg': '.95rem',
  '--fs-xl': '1.1rem',
  '--fs-2xl': '1.3rem',
  '--fs-3xl': '1.6rem',
  '--fs-4xl': '2.5rem',
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
  // Added 2026-09-20 (audit-results/2026-09-20-design-system-audit.md, phase 1):
  // the categories that had no token at all, each at the value the app was
  // already typing by hand, so declaring them changed nothing on screen.
  '--fw-heavy': '800',
  '--font-sans': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  '--font-mono': "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  '--dur-fast': '.15s',
  '--dur-base': '.2s',
  '--dur-slow': '.3s',
  '--shadow-1': '0 1px 4px rgba(0,0,0,.18)',
  '--shadow-2': '0 2px 12px rgba(0,0,0,.18)',
  '--shadow-3': '0 4px 16px rgba(0,0,0,.25)',
  '--shadow-4': '0 8px 32px rgba(0,0,0,.4)',
  '--scrim': 'rgba(0,0,0,.55)',
  '--z-fab': '90',
  '--z-header': '100',
  '--z-float': '200',
  '--z-modal': '200',
  '--z-modal-top': '210',
  '--z-nav': '300',
  '--z-modal-high': '300',
  '--z-toast': '400',
  '--z-toast-top': '410',
  '--z-auth': '500',
  '--z-menu': '999',
  '--z-skip': '4000',
  '--z-popover-backdrop': '9998',
  '--z-popover': '9999',
  '--z-top': '10000',
  '--white': '#fff',
  '--black': '#000',
  '--tag-type': '#818cf8',
  '--status-good': '#22c55e',
  '--status-warn': '#eab308',
  '--status-bad': '#ef4444',
  '--tg-ink': '#4ade80',
  '--tg-bg': '#0a1a12',
  // Moved out of index.html 2026-09-20 — values unchanged.
  '--vis-friends': '#a78bfa',
  '--warn': '#d9a441',
  '--badge-text': '#3D2A14',
  '--badge-accent': '#854F0B',
  '--badge-bg': '#FAEEDA',
  '--badge-bg2': '#FBF6E8',
  '--badge-border': '#BA7517',
  '--badge-close': '#6B5618',
  '--badge-tier': '#B8952A',
  '--badge-deep': '#633806',
  '--badge-ink': '#3D2A14',
  // Aliases of the tokens above. Declared 2026-08-08 after index.html was found
  // referencing them without ever declaring them. The indirection is deliberate:
  // it carries the dark values without a second declaration.
  '--hover': 'var(--surface2)',
  '--surface1': 'var(--surface2)',
  '--error': 'var(--danger)',
  '--fg': 'var(--text)',
  '--accent': 'var(--gold)',
  // An alias of --gold, so like the five above it is declared in both themes.
  '--ring': '0 0 0 1px var(--gold)',
};

export const SHARED_DARK = {
  '--bg': '#0b0b10',
  '--surface': '#141419',
  '--surface2': '#1c1c25',
  '--border': '#272734',
  '--gold': '#c9a84c',
  // Dark gold measures 7.40–8.65 on every dark surface, so text and surface share
  // one value. Declared, not inherited — an alias written only in :root resolves
  // against the light value (see the aliases note below).
  '--gold-text': 'var(--gold)',
  // Dark danger/success already pass as text (4.51+ / 6.23+), so text and
  // surface share one value each. Audit 2026-09-01 A3.
  '--danger-text': 'var(--danger)',
  '--success-text': 'var(--success)',
  '--gold-lt': '#dbbe72',
  '--gold-dim': 'color-mix(in srgb, var(--gold) 12%, transparent)',
  '--text': '#e6e6f0',
  // Raised from #7a7a95 on 2026-08-14 (audit U5). The old value measured 4.41:1
  // on --surface and 4.06:1 on --surface2, under the 4.5:1 WCAG AA floor for body
  // text; 25 muted labels in the feed failed it. #82829d clears 4.5 on --bg,
  // --surface and --surface2. Light --muted already passed and is unchanged.
  '--muted': '#82829d',
  '--overlay-bg': 'rgba(11,11,16,.94)',
  // Badge warm theme, dark variants. --badge-ink is deliberately absent: the
  // medallion disc is cream in both themes, so its glyph ink stays dark.
  '--badge-text': '#e7d9bd',
  '--badge-accent': '#dbbe72',
  '--badge-bg': '#221a0e',
  '--badge-bg2': '#1c160d',
  '--badge-border': 'rgba(219,190,114,.35)',
  '--badge-close': '#c9a84c',
  '--badge-tier': '#dbbe72',
  '--badge-deep': '#d8b96a',
  // The aliases are repeated here on purpose, not duplicated by accident: a
  // var() inside a custom property is substituted where it is DECLARED, so an
  // alias written only in :root freezes the light value and inherits it into
  // dark. Each theme must resolve its own.
  '--hover': 'var(--surface2)',
  '--surface1': 'var(--surface2)',
  '--error': 'var(--danger)',
  '--fg': 'var(--text)',
  '--accent': 'var(--gold)',
  // An alias of --gold, so like the five above it is declared in both themes.
  '--ring': '0 0 0 1px var(--gold)',
};

// Declared in design-system.css outside the two theme blocks: the --header-h
// seed (plain :root, see the note in the file) and the promo component tokens
// (scoped to the promo variants).
export const SHARED_OTHER = [
  '--header-h',
  '--promo-gold', '--promo-gold-deep', '--promo-gold-bright', '--promo-gold-light',
  '--promo-parchment', '--promo-line', '--promo-sand', '--promo-band-body',
  '--promo-ink', '--promo-ink-2', '--promo-quiet', '--promo-cta-fg', '--promo-mono',
];
const owned = t => t in SHARED_LIGHT || SHARED_OTHER.includes(t);

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
  // scripts/design-system/name_styles.py appends helper classes; twice it appended one that was already there.
  it('declares each helper class once', () => {
    const block = css.split('/* ══ Text styles and layout helpers')[1] || '';
    const sels = [...block.matchAll(/^([^{}\n/]+)\{/gm)].map(m => m[1].trim());
    expect(sels.filter((x, i) => sels.indexOf(x) !== i)).toEqual([]);
  });

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

  it('declares nothing outside SHARED_LIGHT and SHARED_OTHER', () => {
    const stray = [...declaredIn(css)].filter(t => !owned(t));
    expect(stray).toEqual([]);
    for (const t of SHARED_OTHER) expect(declaredIn(css).has(t), `missing ${t}`).toBe(true);
  });

  it('keeps the --header-h seed out of the [data-theme="light"] block', () => {
    expect(blockFor(css, ':root, [data-theme="light"]')).not.toContain('--header-h');
  });

  it('pairs :root with [data-theme="light"] so the forced-light landing screen works', () => {
    expect(css).toContain(':root, [data-theme="light"]');
  });
});

const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

// --bg2, --bg-secondary and --tertiary were referenced for months with only a
// fixed-colour fallback (a near-white skeleton bar in dark mode). Replaced with
// real tokens 2026-09-20; nothing is exempt any more.

describe('index.html', () => {
  it('links design-system.css before its inline style block', () => {
    const link = indexHtml.indexOf(DS_LINK);
    const style = indexHtml.indexOf('<style>');
    expect(link).toBeGreaterThan(-1);
    expect(link).toBeLessThan(style);
  });

  it('re-declares none of the tokens design-system.css owns', () => {
    const dupes = [...declaredIn(indexHtml)].filter(owned);
    expect(dupes).toEqual([]);
  });

  // Inline styles keep turning into classes (scripts/design-system/name_styles.py). Code that FINDS an
  // element through `[style*="…"]` silently stops matching when that happens — on 2026-09-21 demo mode
  // stopped hiding the manual accuracy form this way. Use an id or a class.
  it('never selects an element by its inline style', () => {
    const hits = [...indexHtml.matchAll(/\[style[*^~$|]?=/g)].map(m => indexHtml.slice(0, m.index).split('\n').length);
    expect(hits, `[style…] selector at line(s) ${hits.join(', ')}`).toEqual([]);
  });

  it('links only design-system.css as a stylesheet', () => {
    const hrefs = [...new Set(stylesheetHrefs(indexHtml))];
    expect(hrefs, `unexpected stylesheet link(s): ${hrefs.join(', ') || '(none)'}`).toEqual([DS_URL]);
  });

  // --page-gutter is layout state, not a design value: `main` sets it per
  // breakpoint so full-bleed children can cancel the gutter. Everything else
  // moved to design-system.css on 2026-09-20.
  it('declares no custom property of its own except --page-gutter', () => {
    expect([...declaredIn(indexHtml)]).toEqual(['--page-gutter']);
  });

  it('references no token that nothing declares', () => {
    const declared = declaredIn(indexHtml);
    const orphans = [...referencedIn(indexHtml)]
      .filter(t => !owned(t) && !declared.has(t));
    expect(orphans).toEqual([]);
  });
});

// The admin Broadcast / Campaign builders produce HTML that is SENT AS EMAIL.
// Mail clients do not support CSS custom properties and the message never loads
// design-system.css, so a token there renders as nothing. These ranges stay on
// literal values on purpose; the token swap of 2026-09-20 skipped them.
describe('email HTML builders in index.html', () => {
  const RANGES = EMAIL_RANGES;
  it.each(RANGES)('%s … uses no design token', (from, to) => {
    const a = indexHtml.indexOf('\n' + from);
    const b = indexHtml.indexOf('\n' + to, a);
    expect(a, `marker not found: ${from}`).toBeGreaterThan(-1);
    expect(b, `marker not found: ${to}`).toBeGreaterThan(a);
    expect(indexHtml.slice(a, b)).not.toContain('var(--');
  });
});

describe.each([
  ['p/index.html'],
  ['profile/index.html'],
])('%s', (relPath) => {
  const src = readFileSync(join(root, relPath), 'utf8');

  it('links design-system.css before its inline style block', () => {
    const link = src.indexOf(DS_LINK);
    expect(link).toBeGreaterThan(-1);
    expect(link).toBeLessThan(src.indexOf('<style>'));
  });

  it('declares no custom properties of its own', () => {
    expect([...declaredIn(src)]).toEqual([]);
  });

  it('links only design-system.css as a stylesheet', () => {
    const hrefs = [...new Set(stylesheetHrefs(src))];
    expect(hrefs, `unexpected stylesheet link(s): ${hrefs.join(', ') || '(none)'}`).toEqual([DS_URL]);
  });

  it('references only tokens that design-system.css owns', () => {
    const unowned = [...referencedIn(src)].filter(t => !owned(t));
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
    expect(match[1]).toContain(`'${DS_URL}'`);
  });

  // sw.js serves pages network-first and assets cache-first. Under one fixed URL a returning visitor's
  // first load after a deploy got the NEW page with the PREVIOUS stylesheet (2026-09-20). The hash in
  // the URL is what keeps them a pair, so a stale stamp is a release blocker.
  it.each(STAMPED)('%s loads the stylesheet by its current content hash (else: node scripts/ds-stamp.mjs)', (file) => {
    const src = readFileSync(join(root, file), 'utf8');
    expect(src).toContain(DS_URL);
    expect(stamp(src, dsHash())).toBe(src);
  });

  // The branch started at v1042. A bump is what makes activate() purge the old
  // cache, so clients fetch the new design-system.css instead of a stale copy.
  it('has had its cache version bumped past the branch base', () => {
    const match = sw.match(/const CACHE = 'wristlog-v(\d+)';/);
    expect(match, "couldn't find \"const CACHE = 'wristlog-vNN'\" in sw.js").not.toBeNull();
    expect(Number(match[1])).toBeGreaterThan(1043);
  });
});
