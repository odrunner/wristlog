// Stamps the stylesheet's content hash into every URL that loads it:
//   <link rel="stylesheet" href="/design-system.css?v=HASH"> in each page, and the PRECACHE entry in sw.js.
// Same for the shared model-page renderer: <script src="/model-page.js?v=HASH"> in index.html + w/, and sw.js.
//
//   node scripts/ds-stamp.mjs            write
//   node scripts/ds-stamp.mjs --check    exit 1 if anything is out of date
//
// Why: sw.js serves pages network-first but every other asset cache-first. With one fixed URL, a returning
// visitor's first load after a deploy paired the NEW page with the PREVIOUS stylesheet (2026-09-20: a rule
// moved from the page into the stylesheet was in neither for that load). A URL that changes with the file
// cannot match the old cache entry, so the page and its stylesheet always arrive as a pair.
// tests/design-system-tokens.test.js fails when a stamp is stale — run this after editing design-system.css
// or model-page.js. The renderer had the same trap on 2026-09-26: new page + old model-page.js drew the old
// tabbed layout from the new model_stats shape ("±undefined s/d") until a hard refresh.
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STAMPED = ['index.html', 'p/index.html', 'profile/index.html', 'w/index.html', 'privacy.html', 'terms.html', 'open.html', 'sw.js'];
export const dsHash = () => createHash('sha256').update(readFileSync(join(root, 'design-system.css'))).digest('hex').slice(0, 8);
// Only real URLs: a quote before the path keeps prose like "live in /design-system.css." untouched.
const URL_RE = /(["'])\/design-system\.css(?:\?v=[0-9a-f]*)?\1/g;
export const stamp = (src, hash) => src.replace(URL_RE, (_, q) => `${q}/design-system.css?v=${hash}${q}`);

export const MP_STAMPED = ['index.html', 'w/index.html', 'sw.js'];
export const mpHash = () => createHash('sha256').update(readFileSync(join(root, 'model-page.js'))).digest('hex').slice(0, 8);
const MP_RE = /(["'])\/model-page\.js(?:\?v=[0-9a-f]*)?\1/g;
export const stampMp = (src, hash) => src.replace(MP_RE, (_, q) => `${q}/model-page.js?v=${hash}${q}`);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check'); const hash = dsHash(), mh = mpHash(); let stale = 0;
  for (const f of new Set([...STAMPED, ...MP_STAMPED])) {
    const src = readFileSync(join(root, f), 'utf8'); const out = stampMp(stamp(src, hash), mh);
    if (out === src) continue;
    stale++;
    if (check) console.log('stale: ' + f); else { writeFileSync(join(root, f), out); console.log('stamped: ' + f); }
  }
  console.log(`design-system.css?v=${hash} · model-page.js?v=${mh}` + (stale ? '' : ' — all up to date'));
  if (check && stale) process.exit(1);
}
