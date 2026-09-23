// Builds _site/ — the only files GitHub Pages publishes to wrotate.com.
//
// Until 2026-09-23 Pages served the repo root, so every committed file had a
// public URL: audit reports, sql/, scripts/, TODO.md. The deploy now uploads
// this allowlist instead (.github/workflows/pages.yml). A new page or asset the
// site loads must be added here; tests/site-build.test.js fails when a page,
// the manifest or the service-worker precache points at something missing.
//
// usage: node scripts/build-site.mjs [outDir]   (default _site)
import { cpSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Paths relative to the repo root; a trailing slash copies the whole folder.
export const SITE_FILES = [
  'index.html',
  'open.html',
  'privacy.html',
  'terms.html',
  'p/',
  'profile/',
  'w/',
  'design-system.css',
  'model-page.js',
  'sw.js',
  'manifest.json',
  'icon.svg',
  'robots.txt',
  'sitemap.xml',
  'CNAME',
  '.nojekyll',
  '.well-known/',   // apple-app-site-association: universal links
  'email-assets/',  // images referenced by sent broadcast emails
];

export function buildSite(outDir = join(root, '_site')) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const f of SITE_FILES) {
    const src = join(root, f);
    if (!existsSync(src)) throw new Error(`build-site: ${f} is in SITE_FILES but missing`);
    cpSync(src, join(outDir, f), { recursive: true });
  }
  return outDir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = buildSite(process.argv[2] ? join(process.cwd(), process.argv[2]) : undefined);
  console.log(`built ${out} (${SITE_FILES.length} entries)`);
}
