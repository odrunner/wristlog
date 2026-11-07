// Guards the two P4/CLIENT-6 page-weight wins (audit 2026-11-06):
//
// 1. The supabase-js UMD (165 KB) lives in its own file instead of inline in
//    index.html. The shell re-downloads on every deploy (network-first pages),
//    but the library only changes on upgrades — split out and precached, it
//    drops out of the per-deploy transfer entirely. The version is in the
//    FILENAME so the browser can cache it forever; upgrading the library means
//    a new filename everywhere this test checks.
//
// 2. Chart.js + its date adapter (287 KB raw) load lazily when Stats first
//    renders, not at boot — two chart sites, one page, zero boot cost.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SITE_FILES } from '../scripts/build-site.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const idx = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

const VENDOR = 'supabase-js-2.98.0.min.js';

describe('supabase-js UMD split (P4)', () => {
  it('index.html loads the library from its own file, not inline', () => {
    expect(idx).toContain(`<script src="/${VENDOR}"></script>`);
    expect(idx).not.toContain('var supabase=function');
  });
  it('the vendor file exists and is the UMD build', () => {
    const p = join(root, VENDOR);
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toContain('var supabase=function');
  });
  it('is published (SITE_FILES) and precached (sw.js), so it survives offline and deploys', () => {
    expect(SITE_FILES).toContain(VENDOR);
    expect(sw).toContain(`'/${VENDOR}'`);
  });
});

describe('Chart.js lazy load (CLIENT-6)', () => {
  it('no chart script is fetched at boot', () => {
    expect(idx).not.toMatch(/<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js/);
    expect(idx).not.toMatch(/<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/chartjs-adapter/);
  });
  it('loadChartJs injects both scripts with their SRI hashes intact', () => {
    expect(idx).toMatch(/function loadChartJs\(/);
    expect(idx).toContain('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js');
    expect(idx).toContain('https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js');
    // SRI must survive the move from <script> tags to injection.
    expect(idx).toContain('sha384-e6nUZLBkQ86NJ6TVVKAeSaK8jWa3NhkYWZFomE39AvDbQWeie9PlQqM3pmYW5d1g');
    expect(idx).toContain('sha384-cVMg8E3QFwTvGCDuK+ET4PD341jF3W8nO1auiXfuZNQkzbUUiBGLsIQUE+b1mxws');
  });
  it('the CSP still allows exactly those two chart hosts for injection', () => {
    const csp = idx.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
    expect(csp).toContain('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/');
    expect(csp).toContain('https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/');
  });
});
