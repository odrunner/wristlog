import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── Mirror-drift guard ───────────────────────────────────────────────────────
// wrotate_test.js holds pure-logic functions extracted from index.html so they
// can be unit-tested. The risk: the two copies silently diverge — the test
// mirror passes while the real app behaves differently. This guard compares the
// two and fails CI when a VERBATIM mirror drifts, or when a new mirrored
// function appears that hasn't been classified.
//
// Two registries (every function defined in BOTH files must be in one):
//  - VERBATIM: byte-identical after stripping whitespace/comments. The guard
//    asserts they stay identical — this is what catches real drift.
//  - ADAPTED: intentionally diverged (the mirror takes params like `now`,
//    `userId`, `inputValue` instead of reading globals/DOM, drops side effects,
//    or is a same-name-different-purpose collision like fmtMoney). These can't
//    be auto-compared; their behavior is covered by their own unit tests. The
//    guard only asserts they still exist in both files.
//
// When you add/extract a function and this test fails: if it's a clean copy,
// add it to VERBATIM; if it's param-ized/adapted, add it to ADAPTED.

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const idx = readFileSync(join(root, 'index.html'), 'utf8');
const tst = readFileSync(join(root, 'wrotate_test.js'), 'utf8');

const VERBATIM = [
  'TG_ALG_VERSION', 'TG_PRESETS', 'autoSuggestTags', 'buildGameQueue',
  'canDeleteComment', 'classifyDevice', 'computeMedianRate', 'eloExpected',
  'escAttr', 'escHtml', 'fmtDate', 'fmtMonYear', 'guessOEMStrap', 'imgSnippet',
  'inlineImages', 'isVideoUrl', 'isVideoPostLog', 'marketPriceRowHTML', 'matchIdentifiedToCollection',
  'msrCardHasEnoughData', 'msrCardResultText', 'normalizeLocation', 'onboardingChecklistState', 'parsePhotoUrl', '_q2Ls',
  'posterUrlFor', 'renderPostLocationHtml', 'rowToLog', 'rowToWatch', 'rowToWish',
  'sanitizeImageUrl', 'sanitizeSearch', 'storagePathFrom', 'tgAdvancedSummaryFields',
  'tgLoadSettings', 'tgMapSliderToEngine', 'tgSaveSettings', 'uniqueWears',
  'validateUsername', 'withTimeout', 'wishlistViewFromStore', 'groupWishlistByBrand', 'urlDomain', 'resolveTdm', 'resolveSweepKnob', 'parseSweepValues',
  'extractCleanChunks', 'medianStd', 'buildBadgeNotificationRows',
  'addDaysStr', 'computeStreaks', 'streakChipState', 'streakCalendarGrid', 'computeStreaksFrozen',
  'badgePostPlan', 'pinFeatured', 'initialsTextColor', 'pickIdentifiedWatch',
  'classifyProfileLoad', 'buildBrandList', 'brandRequestTitle',
  'campaignSubject', 'campaignGroupOf',
];

const ADAPTED = [
  // Array literal, not a {...} body — extractBody can't read it, so the
  // byte-identical check can't run. tests/campaign-groups.test.js asserts the
  // two copies match instead.
  'CAMPAIGN_GROUP_LABELS',
  'MSR_CARD_MIN_DOTS', 'checkContent', 'computeFriendships', 'computeRobustRate', 'computeWatchRec',
  'fmtMoney', 'formatCommentTime', 'formatFeedDate', 'getMentionQuery', 'incrSettle', 'initials',
  'isBase64', 'logToRow', 'markDirty', 'monthRevNav', 'profileInitials',
  'renderCommentBody', 'todayStr', 'warrantyStatus', 'watchToRow', 'wishToRow',
];

// Extract a function/const body ({...} block) by name from a source string.
function extractBody(src, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pats = [
    new RegExp(`export\\s+function\\s+${esc}\\s*\\(`),
    new RegExp(`export\\s+const\\s+${esc}\\s*=`),
    new RegExp(`function\\s+${esc}\\s*\\(`),
    new RegExp(`const\\s+${esc}\\s*=`),
  ];
  let m = null;
  for (const p of pats) { m = p.exec(src); if (m) break; }
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  // Reject if the next brace is implausibly far (e.g. a one-line const w/o block)
  if (open === -1 || open - m.index > 140) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}

const stripWsComments = (s) =>
  s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');

// Names defined in wrotate_test.js (exported) AND in index.html.
function mirroredNames() {
  const exported = [...tst.matchAll(/^export\s+(?:function|const)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  return exported.filter((n) =>
    new RegExp(`(function\\s+${n}\\b|const\\s+${n}\\b)`).test(idx));
}

describe('mirror-drift guard', () => {
  it('every VERBATIM mirror is byte-identical (ignoring whitespace/comments)', () => {
    const drifted = [];
    for (const name of VERBATIM) {
      const a = extractBody(idx, name);
      const b = extractBody(tst, name);
      if (a == null || b == null) { drifted.push(`${name} (could not extract)`); continue; }
      if (stripWsComments(a) !== stripWsComments(b)) drifted.push(name);
    }
    expect(drifted, `These VERBATIM mirrors drifted between index.html and wrotate_test.js — fix the mirror to match the app (the app is source of truth): ${drifted.join(', ')}`).toEqual([]);
  });

  it('every ADAPTED mirror still exists in both files', () => {
    // Existence check only (these intentionally diverge, so don't compare bodies).
    // Definition-based so it handles arrow consts (fmtMoney), plain const values
    // (MSR_CARD_MIN_DOTS), and function declarations alike.
    const defined = (src, name) => {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(function\\s+${esc}\\b|const\\s+${esc}\\b)`).test(src);
    };
    const missing = [];
    for (const name of ADAPTED) {
      if (!defined(idx, name)) missing.push(`${name} (index.html)`);
      if (!defined(tst, name)) missing.push(`${name} (wrotate_test.js)`);
    }
    expect(missing, `ADAPTED mirrors missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('no unclassified mirrored function (new mirrors must be registered)', () => {
    const known = new Set([...VERBATIM, ...ADAPTED]);
    const unclassified = mirroredNames().filter((n) => !known.has(n));
    expect(unclassified, `New mirrored function(s) not in VERBATIM/ADAPTED. Add each to tests/mirror-drift.test.js: ${unclassified.join(', ')}`).toEqual([]);
  });

  it('registries have no overlap and no dupes', () => {
    expect(VERBATIM.filter((n) => ADAPTED.includes(n))).toEqual([]);
    expect(new Set(VERBATIM).size).toBe(VERBATIM.length);
    expect(new Set(ADAPTED).size).toBe(ADAPTED.length);
  });
});
