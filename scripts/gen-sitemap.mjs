#!/usr/bin/env node
// Regenerates sitemap.xml: the four static pages plus one /w/?m=<slug> entry
// per content-bearing canonical watch model (description + hero image — thin
// stubs stay out of Google on purpose). Re-run after enriching models, then
// commit the diff; sitemap.xml is in SITE_FILES so the deploy picks it up.
//
//   node scripts/gen-sitemap.mjs
//
// Reads the production DB via `supabase db query --linked` (needs
// SUPABASE_ACCESS_TOKEN, loaded by .zshrc from ~/.config/supabase/env).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SQL = `SELECT slug FROM watch_models
  WHERE merged_into IS NULL AND description IS NOT NULL AND hero_image IS NOT NULL
  ORDER BY slug`;

const raw = execFileSync('npx', ['supabase', 'db', 'query', '--linked', SQL], {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
});
const rows = JSON.parse(raw.slice(raw.indexOf('{'))).rows || [];
const slugs = rows.map(r => r.slug).filter(s => /^[a-z0-9-]+$/.test(s || ''));
if (slugs.length < 50) {
  throw new Error(`only ${slugs.length} model slugs came back — refusing to shrink the sitemap (expected 100+)`);
}

const url = (loc, changefreq, priority) =>
  `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  url('https://wrotate.com/', 'weekly', '1.0'),
  url('https://wrotate.com/privacy.html', 'yearly', '0.3'),
  url('https://wrotate.com/terms.html', 'yearly', '0.3'),
  url('https://wrotate.com/profile/', 'daily', '0.7'),
  ...slugs.map(s => url(`https://wrotate.com/w/?m=${s}`, 'monthly', '0.6')),
  '</urlset>',
  '',
].join('\n');

writeFileSync(join(root, 'sitemap.xml'), xml);
console.log(`sitemap.xml written: 4 static pages + ${slugs.length} model pages`);
