// Counts hardcoded design values — ones that do not go through a design-system
// token — in the pages that link design-system.css. Used by
// tests/design-system-ratchet.test.js (the guard) and as a CLI:
//
//   node scripts/ds-count.mjs            print current counts vs. the budget
//   node scripts/ds-count.mjs --write    lower the budget to the current counts
//
// The budget (tests/design-system-budget.json) only ever goes down. It is the
// to-do list of audit-results/2026-09-20-design-system-audit.md in number form.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BUDGET_PATH = join(root, 'tests', 'design-system-budget.json');
// design-system.css is counted too: its token DECLARATIONS are stripped (see withoutDeclarations), so what is
// left is the component rules — a literal value there is as much a hardcoded value as one in a page.
export const PAGES = ['index.html', 'p/index.html', 'profile/index.html', 'design-system.css'];

// HTML built in index.html that is SENT AS EMAIL (admin Broadcast / Campaign).
// Mail clients have no CSS custom properties and never load design-system.css,
// so these ranges keep literal values on purpose: they are outside the design
// system, are not counted here, and tests/design-system-tokens.test.js asserts
// no var(-- ever lands in them. [start-of-line marker, end-of-line marker).
export const EMAIL_RANGES = [
  ['const FUNFACT_CARD_HTML', 'function renderDevFlags'],
  ['function imgSnippet', 'function updateBroadcastPreview'],
  ['function buildFinalBroadcastHtml', 'const BROADCAST_DRAFTS_KEY'],
  ['function buildCampaignEmailHtml', 'async function createCampaign'],
];

export function withoutEmailRanges(src) {
  for (const [from, to] of EMAIL_RANGES) {
    const a = src.indexOf('\n' + from);
    if (a === -1) continue;
    const b = src.indexOf('\n' + to, a);
    if (b > a) src = src.slice(0, a) + src.slice(b);
  }
  return src;
}

// Values that are not a design decision, so are not counted.
const NEUTRAL = new Set(['inherit', 'initial', 'unset', 'none', 'auto', 'normal', '0', '0 auto', 'currentcolor', 'transparent']);

const PROPS = {
  'font-size': /font-size\s*:\s*([^;"'}<]+)/g,
  'font-weight': /font-weight\s*:\s*([^;"'}<]+)/g,
  'font-family': /font-family\s*:\s*([^;"}<]+)/g,
  'line-height': /line-height\s*:\s*([^;"'}<]+)/g,
  'letter-spacing': /letter-spacing\s*:\s*([^;"'}<]+)/g,
  'border-radius': /border-radius\s*:\s*([^;"'}<]+)/g,
  'padding': /(?<![-\w])padding(?:-(?:top|right|bottom|left))?\s*:\s*([^;"'}<]+)/g,
  'margin': /(?<![-\w])margin(?:-(?:top|right|bottom|left))?\s*:\s*([^;"'}<]+)/g,
  'gap': /(?<![-\w])gap\s*:\s*([^;"'}<]+)/g,
  'box-shadow': /box-shadow\s*:\s*([^;"'}<]+)/g,
  'transition': /(?<![-\w])transition\s*:\s*([^;"'}<]+)/g,
  'z-index': /z-index\s*:\s*([^;"'}<]+)/g,
};

// 3/6/8-digit hex not preceded by '&' (HTML entity) or a word char (URL
// fragment, id). 4-digit is skipped: in this codebase it is "#feed", not #rgba.
const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB = /rgba?\([^)]*\)/g;

// el.style.<design prop> = <literal>. Behavioural props (display, transform,
// width…) are state, not design, and are left out.
const JS_STYLE = /\.style\.(?:color|background|backgroundColor|border\w*|fontSize|fontWeight|lineHeight|letterSpacing|padding\w*|margin\w*|gap|boxShadow|opacity)\s*=\s*(['"`])((?:(?!\1).)*)\1/g;

// Strips the token declarations themselves (a page may still own a few local
// ones) so that `--x: #abc` is not counted as a hardcoded use.
function withoutDeclarations(src) {
  return src.replace(/(^|[;{\s])--[A-Za-z0-9_-]+\s*:[^;}]*/g, '$1');
}

// True when every number in the value comes from a token. `var(--space-2)` and
// `0 var(--space-4)` are tokenised; `.4rem var(--space-2)` is not — a half-swapped
// shorthand still counts, so the budget cannot be gamed by partial edits.
export function isTokenised(v) {
  if (!v.includes('var(')) return false;
  const rest = v.replace(/var\([^()]*\)/g, '').replace(/(?<![\d.])0(?![\d.])/g, '');
  return !/\d/.test(rest);
}

export function countHardcoded(src) {
  const text = withoutDeclarations(withoutEmailRanges(src));
  const out = {};
  out['color'] = (text.match(HEX) || []).length + (text.match(RGB) || []).filter(v => !v.includes('var(')).length;
  for (const [name, rx] of Object.entries(PROPS)) {
    let n = 0;
    for (const m of text.matchAll(rx)) {
      const v = m[1].trim().replace(/\s*!important$/, '').toLowerCase();
      if (v.includes('${') || NEUTRAL.has(v)) continue;
      if (isTokenised(v)) continue;
      n++;
    }
    out[name] = n;
  }
  let js = 0;
  for (const m of text.matchAll(JS_STYLE)) {
    const v = m[2].trim().toLowerCase();
    if (v === '' || v.includes('var(') || v.includes('${') || NEUTRAL.has(v)) continue;
    js++;
  }
  out['js-style-assign'] = js;
  out['inline-style-attr'] = (text.match(/style=\\?["']/g) || []).length;
  return out;
}

export function countAll() {
  const out = {};
  for (const p of PAGES) {
    let src = readFileSync(join(root, p), 'utf8');
    // A stylesheet's comments quote hex values in prose ("#9a7628 measures 4.20…"); they are not uses.
    // Only for .css: in the HTML pages a CSP meta tag contains "/*" and would open a bogus comment.
    if (p.endsWith('.css')) src = src.replace(/\/\*[\s\S]*?\*\//g, '');
    out[p] = countHardcoded(src);
  }
  return out;
}

export function readBudget() {
  return JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = countAll();
  if (process.argv.includes('--write')) {
    let prev = {};
    try { prev = readBudget(); } catch { /* first run */ }
    for (const [page, cats] of Object.entries(now)) {
      for (const [cat, n] of Object.entries(cats)) {
        const old = prev[page]?.[cat];
        if (old !== undefined && n > old) {
          console.error(`refusing to RAISE ${page} ${cat}: ${old} -> ${n}. Use a token instead.`);
          process.exit(1);
        }
      }
    }
    writeFileSync(BUDGET_PATH, JSON.stringify(now, null, 2) + '\n');
    console.log('budget written');
  }
  let budget = {};
  try { budget = readBudget(); } catch { /* none yet */ }
  for (const [page, cats] of Object.entries(now)) {
    console.log(`\n${page}`);
    for (const [cat, n] of Object.entries(cats)) {
      const b = budget[page]?.[cat];
      console.log(`  ${cat.padEnd(18)} ${String(n).padStart(5)}${b === undefined ? '' : `  (budget ${b})`}`);
    }
  }
}
