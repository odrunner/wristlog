import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { isWearEntry } from '../wrotate_test.js';

// Guards for fixes from the 2026-07-19 audit that had no coverage. Each of these
// regressed silently once already, or would if reverted — the numbers just go
// quietly wrong rather than anything throwing.

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const autoAddBrand = readFileSync(
  join(root, 'supabase/functions/auto-add-brand/index.ts'), 'utf8');

// Slice a top-level `function name(` body out of index.html.
function fnBody(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start === -1) return '';
  return html.slice(start, html.indexOf('\n}', start));
}

// ── High #5/#6: measurement shares are not wears ───────────────────────────
// isWearEntry was introduced as "the single definition of a wear" and four call
// sites were routed through it — three were missed (By Day of Week, Year in
// Review, Monthly Review), so those kept counting measurement shares as wears.
// 4 of the 5 measurement logs in production are the only log for that watch on
// that date, so each produced a genuine phantom wear.
describe('Stats consumers honour the measurement rule', () => {
  it('renderDowReport takes the filtered set instead of reading raw logs', () => {
    const fn = fnBody('renderDowReport');
    expect(fn).toMatch(/function renderDowReport\(\s*fl\s*\)/);
    expect(fn).not.toMatch(/const fLogs = logs;/);
  });

  it('renderStats passes the filtered set to renderDowReport', () => {
    expect(fnBody('renderStats')).toContain('renderDowReport(fl)');
  });

  it('Year in Review filters through isWearEntry', () => {
    expect(html).toMatch(/const yLogs = logs\.filter\(l => isWearEntry\(l\)/);
  });

  it('Monthly Review filters through isWearEntry', () => {
    expect(html).toMatch(/const mLogs = logs\.filter\(l => isWearEntry\(l\)/);
  });

  it('streaks still read raw logs — measurement counts as engagement there', () => {
    // Deliberate asymmetry: a measurement share is not a wear, but it IS
    // activity. Excluding it from streaks would have cut a real user's best
    // streak from 4 days to 3.
    expect(html).toMatch(/displayStreak\(logs,/);
  });

  it('the predicate itself excludes measurement and requires a watch', () => {
    expect(isWearEntry({ watchId: 'w', date: '2026-07-01', useCase: 'work' })).toBe(true);
    expect(isWearEntry({ watchId: 'w', date: '2026-07-01', useCase: 'measurement' })).toBe(false);
    expect(isWearEntry({ date: '2026-07-01', useCase: 'work' })).toBe(false);
  });
});

// ── Med #9: brand names must never be inlined into a JS string ─────────────
// escHtml does not escape apostrophes, so "Beda'a" terminated the literal and
// threw. Two of three sites were fixed first; this is the third.
describe('brand pickers never inline a name into an onmousedown JS string', () => {
  it('no picker interpolates a brand into a quoted handler argument', () => {
    expect(html).not.toMatch(/onmousedown="[^"]*\('\$\{escHtml\(b\)\}'/);
    expect(html).not.toMatch(/onmousedown="(selectBrand|selectWlBrand|requestBrand)\('\$\{/);
  });

  it('the Add-from-Photo row uses data-brand + a named handler', () => {
    expect(html).toContain('af2PickBrand(');
    expect(html).toMatch(/data-brand="\$\{escAttr\(b\)\}"[^>]*af2PickBrand/);
  });

  it('all three pickers pass the name via a data attribute', () => {
    expect((html.match(/data-brand="\$\{escAttr\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

// ── Med #10/#11: auto-add-brand ────────────────────────────────────────────
describe('auto-add-brand hardening', () => {
  it('re-validates the model-supplied canonical name before storing it', () => {
    const after = autoAddBrand.slice(autoAddBrand.indexOf('const finalName'));
    const validateIdx = after.indexOf('isValidBrandName(finalName)');
    const insertIdx = after.indexOf('.insert(');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(insertIdx);   // validated BEFORE the write
  });

  it('requires the shared secret before spending an Anthropic call', () => {
    expect(autoAddBrand).toContain('CAMPAIGN_TRIGGER_SECRET');
    expect(autoAddBrand.indexOf('x-campaign-secret'))
      .toBeLessThan(autoAddBrand.indexOf('api.anthropic.com'));
  });

  it('short-circuits an already-resolved feedback row', () => {
    expect(autoAddBrand.indexOf('status === "resolved"'))
      .toBeLessThan(autoAddBrand.indexOf('api.anthropic.com'));
  });
});

// ── Low B-8: image viewer must follow the displayed thumbnail ──────────────
describe('feed image viewer opens the image on screen', () => {
  it('the hero carries a data-idx the viewer reads', () => {
    // [^>]* not [^)]* — the inlined JSON.stringify(_urls) contains parentheses.
    expect(html).toMatch(/data-idx="0"[^>]*openImageViewer\([^>]*this\.dataset\.idx/);
  });

  it('feedThumbTap updates data-idx when it swaps the image', () => {
    expect(fnBody('feedThumbTap')).toContain('dataset.idx');
  });
});

// ── Low B-9: the brand-rebuild sentinel must follow a successful fetch ─────
describe('brand rebuild sentinel', () => {
  it('is not set in the parse-time purge block', () => {
    const i = html.indexOf('buildBrandList([], watches, wishlist)');
    expect(i).toBeGreaterThan(-1);
    // Nothing may set the sentinel in the ~10 lines of the purge block.
    expect(html.slice(i, i + 400)).not.toContain("safeLS.set('wristlog_brands_rebuilt_v1'");
  });

  it('is set only after the canonical list arrives', () => {
    const i = html.indexOf('brands = buildBrandList(brRes.data.map');
    expect(i).toBeGreaterThan(-1);
    expect(html.slice(i, i + 400)).toContain("safeLS.set('wristlog_brands_rebuilt_v1'");
  });
});

// ── Med #18: recommendation baseline must use the same unit it compares to ─
describe('recommendation neglected-score baseline', () => {
  it('is built from wear days, not raw log rows', () => {
    // _wWears is unique wear days excluding measurement; comparing it against
    // logs.length (raw rows) inflated every score ~7.5% for real users.
    expect(html).not.toMatch(/const totalLogs = logs\.length;/);
    expect(html).toMatch(/const totalLogs = watches\.reduce\(\(sum, w\) => sum \+ wearsForWatch\(w\.id\), 0\);/);
  });
});

// ── Low B-7: loadMyProfile must not dereference a null profile ─────────────
describe('loadMyProfile null guard', () => {
  it('bails before using data when both inserts failed', () => {
    const fn = fnBody('loadMyProfile');
    const guard = fn.indexOf('if (!data) {');
    const assign = fn.indexOf('myProfile = data;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(assign);
  });
});
