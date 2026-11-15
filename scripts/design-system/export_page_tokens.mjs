#!/usr/bin/env node
// Copies the design tokens the edge-function pages use (share pages, unsubscribe page)
// out of design-system.css into supabase/functions/_shared/page-tokens.ts.
//
// Those pages are served from another origin and cannot load the stylesheet, so they
// carry a copy. Run this after changing a token they use; tests/share-page-tokens.test.js
// fails while the copy is stale. The functions then need a redeploy.
//
//   node scripts/design-system/export_page_tokens.mjs          write the file
//   node scripts/design-system/export_page_tokens.mjs --print  print it instead
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(root, 'design-system.css'), 'utf8');

// Colours change with the theme; everything else is declared once.
export const COLOURS = ['--bg', '--surface', '--surface2', '--border', '--gold', '--gold-lt', '--text', '--muted', '--danger-text'];
export const SCALE = [
  '--white',
  '--radius', '--radius-sm', '--radius-btn', '--radius-pill', '--radius-round',
  '--space-px', '--space-0-5', '--space-1', '--space-1-5', '--space-2', '--space-2-5', '--space-3', '--space-3-5',
  '--space-4', '--space-5', '--space-6', '--space-8', '--space-10', '--space-12', '--space-16',
  '--fs-body', '--fs-input', '--fs-xs', '--fs-sm', '--fs-base', '--fs-md', '--fs-xl', '--fs-2xl', '--fs-3xl', '--fs-4xl', '--fs-display',
  '--fw-semibold', '--fw-bold', '--fw-heavy',
  '--lh-none', '--lh-body',
  '--ls-snug', '--ls-tight', '--ls-eyebrow', '--ls-wide', '--ls-display',
  '--size-px', '--size-6', '--size-9', '--size-10', '--size-18', '--size-20', '--size-85', '--size-105', '--size-130', '--size-max', '--opacity-dim',
  '--shadow-1', '--shadow-3', '--dur-fast', '--z-header', '--font-sans',
];

// Every `--name: value;` of the first block that opens at or after `from`.
export function blockTokens(src, from) {
  const body = src.slice(from, src.indexOf('}', from)).replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
export function stylesheetTokens(src) {
  const light = blockTokens(src, src.indexOf(':root'));
  const darkAt = src.search(/\[data-theme="dark"\]|prefers-color-scheme:\s*dark/);
  return { light, dark: blockTokens(src, src.indexOf('{', darkAt)) };
}

export function render(src) {
  const { light, dark } = stylesheetTokens(src);
  // A token that only points at another (--danger-text: var(--danger)) is written as
  // the value it points to: the pages carry just the listed names, so the pointer
  // would lead nowhere there.
  const resolve = (v, from) => {
    for (let i = 0, m; i < 5 && (m = /^var\((--[a-z0-9-]+)\)$/.exec(v)); i++) {
      if (!from[m[1]]) throw new Error(`design-system.css: ${v} points at nothing in its block`);
      v = from[m[1]];
    }
    return v;
  };
  const line = (names, from) => names.map((n) => {
    if (!from[n]) throw new Error(`design-system.css has no ${n}`);
    return `${n}: ${resolve(from[n], from)};`;
  }).join(' ');
  return `// GENERATED from design-system.css by scripts/design-system/export_page_tokens.mjs. Do not edit.
// The share pages and the unsubscribe page cannot load the stylesheet (another origin),
// so this is their copy of the tokens they use. tests/share-page-tokens.test.js fails
// when it is stale.

export const TOKENS_LIGHT = \`${line([...COLOURS, ...SCALE], light)}\`;
export const TOKENS_DARK = \`${line(COLOURS, dark)}\`;

/** Both themes, for a page that follows the reader's light/dark setting. */
export const PAGE_TOKENS_CSS = \`:root { \${TOKENS_LIGHT} }
    @media (prefers-color-scheme: dark) { :root { \${TOKENS_DARK} } }\`;
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = render(css);
  if (process.argv.includes('--print')) process.stdout.write(out);
  else writeFileSync(join(root, 'supabase/functions/_shared/page-tokens.ts'), out);
}
