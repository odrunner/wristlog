// Returning-visitor proof — the case no other harness covers, because they all load matching files.
//   compare.sh skew [ref]      (no dev server needed; it starts its own on a free port)
// Visit 1 = the deploy at <ref> (its service worker installs and caches the stylesheet). Then the working
// tree is "deployed" with a probe token added to the stylesheet, and the FIRST load after it is inspected.
// Runs twice: a control with the fixed URL (must say NO — proves the harness can see the bug) and the
// working tree as stamped (must say YES). Exits 1 if either is not as expected.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { join } from 'path';
const REPO = process.cwd(); const S = process.argv[2]; const OLD_REF = process.argv[3] || 'HEAD';
const FILES = ['index.html', 'sw.js', 'design-system.css', 'model-page.js', 'manifest.json', 'icon.svg', 'p/index.html', 'profile/index.html'];
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml' };
const site = join(S, 'site');
function deploy(kind, versioned) {
  rmSync(site, { recursive: true, force: true });
  for (const f of FILES) { mkdirSync(join(site, f, '..'), { recursive: true });
    const buf = kind === 'old' ? execSync(`git show ${OLD_REF}:${f}`, { cwd: REPO, maxBuffer: 1e9 }) : readFileSync(join(REPO, f)); writeFileSync(join(site, f), buf); }
  if (kind === 'new') {
    const cssP = join(site, 'design-system.css'); writeFileSync(cssP, readFileSync(cssP, 'utf8') + '\n:root { --ds-probe: new; }\n');
    const h = createHash('sha256').update(readFileSync(cssP)).digest('hex').slice(0, 8);
    for (const f of ['index.html', 'p/index.html', 'profile/index.html', 'sw.js']) { const p = join(site, f); let s = readFileSync(p, 'utf8');
      s = versioned ? s.replace(/\/design-system\.css\?v=[0-9a-f]+/g, '/design-system.css?v=' + h) : s.replace(/\/design-system\.css\?v=[0-9a-f]+/g, '/design-system.css');
      writeFileSync(p, s); }
  }
}
const log = []; let failed = false;
const srv = createServer((req, res) => { const u = new URL(req.url, 'http://x'); let p = u.pathname; if (p.endsWith('/')) p += 'index.html';
  const f = join(site, p); if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  if (p.endsWith('.css')) log.push(u.pathname + u.search);
  res.writeHead(200, { 'content-type': TYPES[p.split('.').pop()] || 'application/octet-stream', 'cache-control': 'max-age=600' }); res.end(readFileSync(f)); });
await new Promise(r => srv.listen(0, r)); const base = 'http://localhost:' + srv.address().port;
const b = await chromium.launch();
// The control only means something when <ref> still used the fixed URL (its cache then holds that key).
const refVersioned = /design-system\.css\?v=/.test(execSync(`git show ${OLD_REF}:sw.js`, { cwd: REPO }).toString());
if (refVersioned) console.log(`(${OLD_REF} already loads the stylesheet by hash — control skipped)`);
for (const versioned of refVersioned ? [true] : [false, true]) {
  const ctx = await b.newContext(); const p = await ctx.newPage();
  await p.route(u => !u.href.startsWith(base), r => r.abort());
  deploy('old'); await p.goto(base + '/', { waitUntil: 'load' });
  await p.waitForFunction(async () => (await navigator.serviceWorker.ready) && !!navigator.serviceWorker.controller, null, { timeout: 20000 });
  await p.waitForFunction(async () => { for (const k of await caches.keys()) if (await (await caches.open(k)).match('/design-system.css')) return true; return false; }, null, { timeout: 20000 });
  const oldCache = await p.evaluate(() => caches.keys());
  deploy('new', versioned); log.length = 0;
  await p.goto(base + '/', { waitUntil: 'load' });
  const first = await p.evaluate(() => ({ probe: getComputedStyle(document.documentElement).getPropertyValue('--ds-probe').trim(),
    href: document.querySelector('link[rel=stylesheet]').getAttribute('href'),
    // the 2026-09-20 symptom: `.hidden` defined in neither file, so everything hidden shows at once
    hiddenTotal: document.querySelectorAll('.hidden').length,
    hiddenShowing: [...document.querySelectorAll('.hidden')].filter(e => getComputedStyle(e).display !== 'none').length }));
  console.log(`\n${versioned ? 'WITH versioned URL (the fix)' : 'CONTROL: fixed URL (today)'}  — visitor had ${oldCache}`);
  console.log(`  first load after deploy: page asks for ${first.href}`);
  console.log(`  new stylesheet applied on that load: ${first.probe === 'new' ? 'YES' : 'NO  <- new page + old stylesheet'}`);
  if ((first.probe === 'new') !== versioned) failed = true;
  if (versioned && first.hiddenShowing) failed = true;
  console.log(`  elements with class "hidden" that are SHOWING on that load: ${first.hiddenShowing} of ${first.hiddenTotal}`);
  console.log(`  stylesheet requests that reached the server: ${JSON.stringify(log)}`);
  await p.waitForTimeout(1500); await p.goto(base + '/', { waitUntil: 'load' });
  // offline: the new SW must serve the versioned stylesheet from its precache
  await p.waitForFunction(async old => { const k = await caches.keys(); return k.length === 1 && !old.includes(k[0]); }, oldCache, { timeout: 20000 }).catch(() => {});
  await ctx.setOffline(true); srv.unref();
  const off = await p.goto(base + '/', { waitUntil: 'load' }).then(() => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ds-probe').trim())).catch(e => 'ERR ' + e.message.slice(0, 60));
  if (off !== 'new') failed = true;
  console.log(`  offline launch afterwards, stylesheet present: ${off === 'new' ? 'YES' : 'NO (' + off + ')'}   caches: ${await p.evaluate(() => caches.keys()).catch(() => '?')}`);
  await ctx.close();
}
await b.close(); srv.close();
console.log(failed ? '\nFAIL' : '\nOK — new page and new stylesheet arrive as a pair for a returning visitor; offline launch works');
process.exit(failed ? 1 : 0);
