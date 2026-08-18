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
  'canDeleteComment', 'classifyDevice', 'computeMedianRate', 'decodeAuthUserId', 'eloExpected',
  'badgeRevealNames', 'escAttr', 'escHtml', 'fmtDate', 'fmtMonYear', 'guessOEMStrap', 'imgSnippet', 'iosAtLeast',
  'inlineImages', 'isVideoUrl', 'isVideoPostLog', 'marketPriceRowHTML', 'matchIdentifiedToCollection',
  'msrCardHasEnoughData', 'unsavedReadingLabel', 'logAgainCandidate', 'shouldAutoKeepReading', 'groupReadingsByDay', 'filterDaysByRange', 'accuracyTrendSvg', 'collectionValueSummary', 'neglectedWatches', 'msrCardResultText', 'msrCardShowScope', 'msrCardAmpText', 'normalizeLocation', 'onboardingChecklistState', 'parsePhotoUrl', '_q2Ls',
  'posterUrlFor', 'rankWishlistByElo', 'renderPostLocationHtml', 'rowToLog', 'rowToWatch', 'rowToWish',
  'sanitizeImageUrl', 'sanitizeSearch', 'storagePathFrom', 'tgAdvancedSummaryFields',
  'thumbPathFor', 'thumbUrlFor', 'thumbSrcAttrs',
  'tgLoadSettings', 'tgMapSliderToEngine', 'tgSaveSettings', 'uniqueWears',
  'validateUsername', 'withTimeout', 'wishlistViewFromStore', 'collViewFromStore', 'groupWishlistByBrand', 'urlDomain', 'resolveTdm', 'resolveSweepKnob', 'parseSweepValues',
  'extractCleanChunks', 'medianStd', 'buildBadgeNotificationRows', 'notifStaysUnreadOnPanelOpen',
  'mergeBadgeNotifs',
  'addDaysStr', 'computeStreaks', 'streakChipState', 'streakCalendarGrid', 'computeStreaksFrozen',
  'badgePostPlan', 'pinFeatured', 'initialsTextColor', 'pickIdentifiedWatch',
  'classifyProfileLoad', 'buildBrandList', 'brandRequestTitle',
  'campaignSubject', 'campaignGroupOf', 'periodCutoff', 'wearLeaderboard',
  'isWearEntry', 'isMeasurementCardImage', 'feedKeysetFilter', 'dedupeNewFeedLogs', 'feedPageOutcome',
  'feedSortDate', 'compareFeedLogs', 'feedCaughtUpIndex', 'feedMaxCreatedAt',
  'shouldPromptFirstWear', 'hasWornToday', 'shouldRevealBadges', 'shouldShowPushPrimer',
  'fillCampaignTokens', 'unresolvedCampaignTokens',
  'shouldShowFactModal', 'pickFactModalWatch', 'shouldAttachFactOnEdit', 'showsFunFact',
  'npIdentifyWait', 'syncedIds', 'promoAudienceMatches', 'eligiblePromoSlots',
  'promoSlotPositions', 'PROMO_AUDIENCES', 'monthRecap', 'promoSlotEpoch',
  'toggleWishSelection', 'folderSelectionState', 'toggleWishFolderSelection',
  'wishShareItems', 'wishSharePrivateCount', 'wishShareLinkLabel',
];

const ADAPTED = [
  // Plain constants (array/number/string), not {...} bodies — extractBody can't
  // read them; tests/thumbnails.test.js pins THUMB_FOLDERS' value.
  'THUMB_FOLDERS', 'THUMB_MAX', 'THUMB_QUALITY', 'THUMB_SUFFIX',
  // Array literal / plain string, not a {...} body — extractBody can't read
  // them, so the byte-identical check can't run. tests/campaign-groups.test.js
  // asserts the two copies match instead.
  'CAMPAIGN_GROUP_LABELS', 'CAMPAIGN_FUNFACT_DRIP', 'CAMPAIGN_WINBACK_FUNFACT',
  // Plain numbers, not {...} bodies — extractBody can't read them, so the
  // byte-identical check can't run. tests/promo-recap.test.js asserts the two
  // copies carry the same values instead.
  'RECAP_WINDOW_DAYS', 'RECAP_MIN_WEARS', 'RECAP_MIN_WATCHES', 'RECAP_MIN_STREAK',
  'MSR_CARD_MIN_DOTS', 'checkContent', 'computeFriendships', 'computeRobustRate', 'computeWatchRec',
  'fmtMoney', 'formatCommentTime', 'formatFeedDate', 'getMentionQuery', 'incrSettle', 'initials',
  'isBase64', 'logToRow', 'markDirty', 'monthRevNav', 'profileInitials',
  'renderCommentBody', 'todayStr', 'warrantyStatus', 'watchToRow', 'wishToRow',
  'funFactCardHTML', 'funFactRowHTML',
];

// Extract a function/const body ({...} block) by name from a source string.
//
// The body brace search must start AFTER the parameter list, not right after the
// function name — a destructured parameter like `function f({ a, b }) {` has its
// own '{...}', and naively taking the first '{' after the name grabs that param
// list instead of the real body, making two different bodies with identical
// signatures compare as "equal".
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

  // Position right after the matched declaration head. `function NAME(` patterns
  // end at the parameter list's opening '(' (depth already 1); `const NAME =`
  // patterns end at the '='.
  let p = m.index + m[0].length;
  if (m[0].endsWith('(')) {
    let depth = 1;
    while (p < src.length && depth > 0) {
      if (src[p] === '(') depth++;
      else if (src[p] === ')') depth--;
      p++;
    }
  } else {
    // `const NAME = <head> {...}` where <head> is any of: an arrow's
    // parenthesized (possibly destructured) params, an arrow's bare
    // identifier param, or a function expression — `function`, `async
    // function`, or `async`, each optionally named, in any combination —
    // followed by its own (possibly destructured) params. Rather than
    // hardcoding one keyword at a time (this is the third patch for the
    // same failure mode), skip whitespace and any run of `async`/`function`
    // keywords generically, then an optional function-expression name
    // immediately before '(', before balance-skipping the parameter list.
    while (p < src.length && /\s/.test(src[p])) p++;
    const kwRe = /^(?:async|function)\b/;
    while (kwRe.test(src.slice(p))) {
      p += kwRe.exec(src.slice(p))[0].length;
      while (p < src.length && /\s/.test(src[p])) p++;
    }
    // An identifier directly followed by '(' here is a function expression's
    // name (`function foo(...)`) — an arrow's bare param is followed by
    // '=>', not '(', so this can't misfire on `const f = x => {...}`.
    const nameMatch = /^[A-Za-z_$][A-Za-z0-9_$]*\s*(?=\()/.exec(src.slice(p));
    if (nameMatch) p += nameMatch[0].length;
    if (src[p] === '(') {
      let depth = 1; p++;
      while (p < src.length && depth > 0) {
        if (src[p] === '(') depth++;
        else if (src[p] === ')') depth--;
        p++;
      }
    }
  }
  while (p < src.length && /\s/.test(src[p])) p++;
  if (src.slice(p, p + 2) === '=>') {
    p += 2;
    while (p < src.length && /\s/.test(src[p])) p++;
  }

  const open = src.indexOf('{', p);
  // Reject if the body brace is implausibly far past the parameter list/'=' (e.g.
  // a one-line const w/o a block body at all).
  if (open === -1 || open - p > 140) return null;
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

  describe('extractBody handles every async/function-expression const shape', () => {
    // Regression tests for the same failure mode, fixed generically instead of
    // one keyword at a time: `const NAME = <async/function keywords, in any
    // combination, optionally named> (<possibly destructured params>) {...}`.
    // Each must return the real body, never the destructured param pattern.

    it('const f = async (a) => {...} (plain param, no destructuring)', () => {
      const src = `
const doThing = async (a) => {
  return a + 1;
};
`;
      expect(extractBody(src, 'doThing')).toContain('return a + 1;');
    });

    it('const f = async ({a}) => {...} (destructured arrow param)', () => {
      const src = `
const doThing = async ({ a, b }) => {
  return a + b;
};
`;
      const body = extractBody(src, 'doThing');
      expect(body).not.toBe('{ a, b }');
      expect(body).toContain('return a + b;');
    });

    it('async function f({a}) {...} (declared function, unaffected by this branch)', () => {
      const src = `
async function doThing({ a, b }) {
  return a + b;
}
`;
      const body = extractBody(src, 'doThing');
      expect(body).not.toBe('{ a, b }');
      expect(body).toContain('return a + b;');
    });

    it('const f = async function ({a}) {...} (named/anonymous function expression)', () => {
      const anon = `
const doThing = async function ({ a, b }) {
  return a + b;
};
`;
      const anonBody = extractBody(anon, 'doThing');
      expect(anonBody).not.toBe('{ a, b }');
      expect(anonBody).toContain('return a + b;');

      const named = `
const doOtherThing = async function doOtherThingImpl({ a, b }) {
  return a - b;
};
`;
      const namedBody = extractBody(named, 'doOtherThing');
      expect(namedBody).not.toBe('{ a, b }');
      expect(namedBody).toContain('return a - b;');
    });
  });
});
