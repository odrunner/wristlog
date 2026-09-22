// Lists every hardcoded value ds-count.mjs counts, with its line, so the remaining work is a list, not a number.
//   node scripts/design-system/ds-list.mjs [page] [category]
import { readFileSync } from 'fs';
import { PAGES, EXEMPT, countHardcoded, withoutEmailRanges, withoutStyleComments } from '../ds-count.mjs';
const [only, cat] = process.argv.slice(2);
for (const p of PAGES) {
  if (only && p !== only) continue;
  let src = readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
  if (p.endsWith('.css')) src = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  for (const [rx] of EXEMPT) src = src.replace(rx, m => m.replace(/[^\n]/g, ' '));   // blanked, line numbers kept
  if (!p.endsWith('.css')) src = withoutStyleComments(src);
  const kept = withoutEmailRanges(src);
  const lines = src.split('\n'), keptSet = new Set(kept.split('\n'));
  lines.forEach((l, i) => {
    if (!keptSet.has(l)) return;
    const c = countHardcoded(l);
    for (const [k, n] of Object.entries(c)) if (n && k !== 'inline-style-attr' && (!cat || cat === k)) console.log(`${p}:${i + 1} [${k}] ${l.trim().slice(0, 150)}`);
  });
}
