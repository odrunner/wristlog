import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { shouldNudgeEnhance } from '../wrotate_test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const BARE = { id: 'w1', brand: 'Seiko', name: 'SKX007' };
const CTX = { seen: {}, lastNudgeDay: '2026-08-27', today: '2026-08-29' };

describe('shouldNudgeEnhance', () => {
  it('nudges a watch with none of the three enhance anchors', () => {
    expect(shouldNudgeEnhance(BARE, CTX)).toBe(true);
  });

  it('is false when there is no watch at all', () => {
    expect(shouldNudgeEnhance(null, CTX)).toBe(false);
    expect(shouldNudgeEnhance(undefined, CTX)).toBe(false);
  });

  it('is false when the watch already has any enhance-filled field', () => {
    expect(shouldNudgeEnhance({ ...BARE, caseDiameter: '42mm' }, CTX)).toBe(false);
    expect(shouldNudgeEnhance({ ...BARE, caliber: '7S26' }, CTX)).toBe(false);
    expect(shouldNudgeEnhance({ ...BARE, background: 'A dive icon.' }, CTX)).toBe(false);
  });

  it('is false once this watch has been nudged before', () => {
    expect(shouldNudgeEnhance(BARE, { ...CTX, seen: { w1: 1 } })).toBe(false);
  });

  it('ignores a seen map that holds only other watches', () => {
    expect(shouldNudgeEnhance(BARE, { ...CTX, seen: { w2: 1 } })).toBe(true);
  });

  it('is false when a nudge already fired today', () => {
    expect(shouldNudgeEnhance(BARE, { ...CTX, lastNudgeDay: '2026-08-29' })).toBe(false);
  });

  it('handles a missing seen map and a missing options object', () => {
    expect(shouldNudgeEnhance(BARE, { lastNudgeDay: null, today: '2026-08-29' })).toBe(true);
    expect(shouldNudgeEnhance(BARE, { seen: undefined, today: '2026-08-29' })).toBe(true);
    // No options at all: lastNudgeDay and today are both undefined → equal → no nudge.
    expect(shouldNudgeEnhance(BARE)).toBe(false);
    expect(shouldNudgeEnhance(null)).toBe(false);
  });
});

describe('enhance_nudge wiring in index.html', () => {
  it('gates every treatment surface behind experiment("enhance_nudge")', () => {
    expect(html).toContain("if (!watch || !experiment('enhance_nudge')) return false;");
    expect(html).toContain("if (!enhanceNudgeWouldShow(watch)) return;");
    expect(html).toContain("if (!experiment('enhance_nudge') || !needsEnhance(w)) return '';");
    expect(html).toContain("const enhN = experiment('enhance_nudge') ? watches.filter(needsEnhance).length : 0;");
  });

  it('logs an enhance_run feature_event from every Enhance entry point', () => {
    expect(html).toMatch(/function logEnhanceRun\(surface\) \{[\s\S]*?db\.from\('feature_events'\)\.insert\(\{ user_id: currentUser\.id, event: 'enhance_run', meta: \{ surface \} \}\)/);
    expect(html).toContain("logEnhanceRun('edit');");
    expect(html).toContain("logEnhanceRun('af2');");
    expect(html).toContain("logEnhanceRun(_enhanceSurface || 'enhance_all');");
    expect(html).toContain("function enhanceFromGrid(watchId) { enhanceScoped(watchId, 'grid'); }");
  });

  it('exposes an admin Dev-tab reset for the nudge gates', () => {
    expect(html).toMatch(/function resetEnhanceNudgeState\(\) \{[\s\S]*?safeLS\.remove\(seenKey\); safeLS\.remove\(dayKey\);/);
    expect(html).toContain('onclick="resetEnhanceNudgeState()"');
  });

  it('never writes the metric in demo mode', () => {
    expect(html).toMatch(/function logEnhanceRun\(surface\) \{\s*(?:\/\/[^\n]*\n\s*)*if \(!currentUser \|\| _isDemoMode\) return;/);
  });

  it('scopes both gating keys to the signed-in user', () => {
    expect(html).toContain("function enhNudgeSeenKey() { return currentUser ? 'enhnudge_seen_' + currentUser.id : null; }");
    expect(html).toContain("function enhNudgeDayKey()  { return currentUser ? 'enhnudge_day_'  + currentUser.id : null; }");
    // No un-scoped key survives anywhere in the app.
    expect(html).not.toMatch(/'enhnudge_seen'|'enhnudge_day'/);
  });

  it('re-checks the predicate before spending a scoped Enhance run', () => {
    expect(html).toMatch(/function enhanceScoped\(watchId, surface\) \{[\s\S]*?if \(!needsEnhance\(w\)\) \{ renderCollection\(true\); toast\('Already enhanced', 'info'\); return; \}[\s\S]*?enhanceAllWatches\(\[watchId\]\);/);
    expect(html).toContain("function enhanceFromNudge(watchId, surface) { enhNudgeMarkSeen(watchId); enhanceScoped(watchId, surface || 'nudge'); }");
  });

  it('uses the single needsEnhance() predicate inside enhanceAllWatches', () => {
    expect(html).toContain('const candidates = watches.filter(needsEnhance);');
    // The old local shadowed the global predicate.
    expect(html).not.toContain('const needsEnhance = watches.filter(');
  });

  it('renders the nudge card into the active page and wires both buttons', () => {
    expect(html).toContain("document.querySelector('.page.active .enhance-nudge-slot')");
    expect((html.match(/class="enhance-nudge-slot"/g) || []).length).toBe(3); // feed, track, collection
    expect(html).toContain('is missing its details');
    expect(html).toContain('Movement, case size, production years and the story behind it.');
    expect(html).toContain('>Enhance</button>');
    expect(html).not.toContain('enh-nudge-title">&#11088;'); // no emoji in product copy
    expect(html).toContain('Not now');
  });

  it('calls the nudge from the add and wear surfaces', () => {
    expect(html).toContain("maybeShowEnhanceNudge(watches.find(x => x.id === _addedWatchId) || null, 'add')");
    expect(html).toContain("setTimeout(() => maybeShowEnhanceNudge(_factWatch, 'wear'), 1500);");
    expect(html).toContain("setTimeout(() => maybeShowEnhanceNudge(watches.find(x => x.id === watchId) || null, 'wear'), 1500);");
    expect(html).toContain("const nudging = isWear && enhanceNudgeWouldShow(postedWatch);");
    expect(html).toContain("if (nudging) setTimeout(() => maybeShowEnhanceNudge(postedWatch, 'wear'), 1500);");
    // The review prompt yields to a nudge so the two never compete for the same moment.
    expect(html).toContain("if (!nudging) maybeShowReviewPrompt('post');");
    expect(html).toContain("if (!isUpdate && !enhanceNudgeWouldShow(_factWatch)) maybeShowReviewPrompt('wear_log');");
  });

  it('registers the enhance_run metric in the experiment_metrics seed', () => {
    const sql = readFileSync(join(__dirname, '..', 'sql', '2026-08-29-enhance-nudge-metric.sql'), 'utf8');
    expect(sql).toContain("'enhance_run', 'Ran Enhance', 'rate', 'feature_events:enhance_run', 35");
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
  });
});
