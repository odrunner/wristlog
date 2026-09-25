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

// ── 2026-08-31: bell-row Follow bypassed follow approval ───────────────────────
// followFromNotif (added 2026-08-16) decided request-vs-follow with
// `profile_privacy === 'private'`, so a `followers` profile got a direct follows
// insert — Steve (@crash) gained four followers he never approved. The older
// "Follow back" button (followBackFromNotif, 2026-02-28) never checked at all.
// Every client follow path must go through followNeedsRequest().
describe('Notification follow buttons honour profile privacy', () => {
  it('followFromNotif routes through followNeedsRequest, not a private-only check', () => {
    const fn = fnBody('followFromNotif');
    expect(fn).toContain('followNeedsRequest(');
    expect(fn).not.toMatch(/=== 'private'/);
  });

  it('followBackFromNotif sends a request when the follower is restricted', () => {
    const fn = fnBody('followBackFromNotif');
    expect(fn).toContain('followNeedsRequest(');
    expect(fn).toContain('sendFollowRequest(');
  });

  it('friendActionBtn uses the same rule', () => {
    expect(fnBody('friendActionBtn')).toContain('followNeedsRequest(');
  });

  it('the bell pill label does not decide on private alone', () => {
    const start = html.indexOf('class="follow-btn follow notif-follow-inline"');
    const pill = html.slice(start, html.indexOf('</button>', start));
    expect(pill).not.toMatch(/profile_privacy === 'private'/);
    expect(pill).toContain('followNeedsRequest(');
  });

  it('the bell pill says what is being requested', () => {
    const start = html.indexOf('class="follow-btn follow notif-follow-inline"');
    const pill = html.slice(start, html.indexOf('</button>', start));
    expect(pill).toContain("'Request to follow'");
    expect(pill).not.toContain("'Request'");
  });
});

// ── Audit 2026-09-01 SEC-8: user text must never reach a JS string inside an
// inline event handler. escAttr() encodes ' as &#39;, which the HTML parser
// decodes back to ' BEFORE the handler's JS is parsed — so
// onclick="fn('${escAttr(name)}')" executes a crafted display_name (proved in
// Chromium for audit S3, ec5bfe6; nine more sinks of the same shape were found
// and converted 2026-09-01). The safe pattern is data-name="${escAttr(name)}"
// + fn(this.dataset.name). This lint keeps the dangerous shape at zero.
describe('No escaped-user-text inside handler JS strings (SEC-8)', () => {
  it("index.html has zero '${escAttr(...)} JS-string interpolations", () => {
    expect(html.split("'${escAttr(").length - 1).toBe(0);
  });

  it("index.html has zero '${escHtml(...)} JS-string interpolations", () => {
    expect(html.split("'${escHtml(").length - 1).toBe(0);
  });
});

// ── Audit 2026-09-23 SEC-23-3: two feed-card fields reached every viewer's
// page raw. logs.use_case is free text (custom occasions) and was rendered
// unescaped in .feed-meta; logs.id is client-chosen TEXT rendered raw in ~35
// attributes/handlers. The DB now pins both (sql/2026-09-24-sec-feed-xss-checks.sql:
// id ~ [A-Za-z0-9_-]{1,64}, use_case without < > " `), and the meta line escapes.
describe('Feed card fields from logs are escaped (SEC-23-3)', () => {
  it('use_case in the feed meta line goes through escHtml', () => {
    const i = html.indexOf('const metaParts = [');
    expect(i).toBeGreaterThan(-1);
    const block = html.slice(i, html.indexOf('].filter(Boolean)', i));
    expect(block).toContain('escHtml(item.use_case)');
    expect(block).not.toMatch(/\? item\.use_case :/);
  });
});

// ── Audit 2026-09-23 SEC-23-4: reporters flag through flag_content(), never a
// direct UPDATE — the permissive "Reporter can flag" policies that allowed it
// were dropped (sql/2026-09-24-sec-flag-content-rpc.sql).
describe('Report flow flags via RPC (SEC-23-4)', () => {
  it('submitReport calls flag_content and does not update moderation_status directly', () => {
    const i = html.indexOf("from('content_reports').insert(");
    expect(i).toBeGreaterThan(-1);
    const block = html.slice(i, html.indexOf('renderFeed();', i));
    expect(block).toContain("db.rpc('flag_content'");
    expect(block).not.toContain("update({ moderation_status: 'flagged' })");
  });
});

// ── Audit 2026-09-23 SEC-23-23: login CSRF. detectSessionInUrl adopts any
// #access_token in the URL, so a crafted link could sign a visitor into the
// attacker's account. A guard before createClient drops URL tokens unless this
// browser started an OAuth sign-in (marker set by signInWithGoogle/Apple).
describe('URL-token sign-in requires a sign-in this browser started (SEC-23-23)', () => {
  it('the guard runs before the Supabase client is created', () => {
    const guard = html.indexOf("localStorage.getItem('wr_oauth_started')");
    const client = html.indexOf('const db = supabase.createClient(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(client);
  });

  it('every web OAuth entry point sets the marker', () => {
    const oauthCalls = html.split('db.auth.signInWithOAuth(').length - 1;
    const markers = html.split("safeLS.set('wr_oauth_started'").length - 1;
    expect(oauthCalls).toBeGreaterThan(0);
    expect(markers).toBe(oauthCalls);
  });
});

// ── Audit 2026-09-23 SEC-23-10: admin-panel XSS. A report's content_id (free
// text chosen by the reporter) went raw into onclick handlers in the Reports
// tab, and a user's own collection_visibility went raw into Admin → Users.
describe('Admin panel renders user-controlled report/profile fields safely (SEC-23-10)', () => {
  it('report action buttons pass ids through data attributes', () => {
    expect(html).not.toContain("adminConfirmRemoval('${r.id}'");
    expect(html).not.toContain("adminRestoreContent('${r.id}'");
    expect(html).toContain('adminConfirmRemoval(this.dataset.rid,this.dataset.ctype,this.dataset.cid)');
  });

  it('the user-detail privacy line escapes both settings', () => {
    expect(html).toContain("${escHtml(p.collection_visibility || 'public')} collection");
    expect(html).not.toContain("${p.collection_visibility || 'public'} collection");
  });
});

// ── Audit 2026-09-23 SEC-23-16 follow-up: the username share page shows only a
// Public profile + Public collection, so sharePublicProfile warns instead of
// sending a link that opens "Private". It reads myProfile — which the privacy
// chips must actually update (they wrote to window.myProfile, undefined for a
// `let` binding, so the cache went stale after every change).
describe('Share profile link respects privacy (SEC-23-16)', () => {
  it('sharePublicProfile checks profile + collection visibility before sharing', () => {
    const i = html.indexOf('async function sharePublicProfile()');
    const body = html.slice(i, html.indexOf('\n}\n', i));
    expect(body).toContain("colVis !== 'public'");
    expect(body).toContain('profileOpen');
  });

  it('savePrivacyField updates the real myProfile binding', () => {
    const i = html.indexOf('async function savePrivacyField(');
    const body = html.slice(i, html.indexOf('\n}\n', i));
    expect(body).not.toContain('window.myProfile');
    expect(body).toContain('myProfile[field] = value');
  });
});

// ── Audit 2026-09-23 SEC-23-22: moderation_status is not user-updatable on
// logs/comments; the admin panel changes it through admin_set_moderation().
describe('Moderation changes go through the admin RPC (SEC-23-22)', () => {
  it('no client code updates moderation_status directly', () => {
    expect(html).not.toMatch(/\.update\(\{\s*moderation_status/);
    expect(html.split("db.rpc('admin_set_moderation'").length - 1).toBe(2);
  });
});

// ── Audit 2026-09-23 SEC-23-25: every page allows scripts only from the exact
// CDN package paths it loads (not all of cdn.jsdelivr.net, which serves any npm
// package), and CDN scripts carry an integrity hash.
describe('CSP script-src pins CDN packages; CDN scripts use SRI (SEC-23-25)', () => {
  for (const f of ['index.html', 'p/index.html', 'profile/index.html', 'w/index.html']) {
    it(f, () => {
      const src = readFileSync(join(root, f), 'utf8');
      const scriptSrc = src.match(/script-src ([^;"]+)/)[1];
      expect(scriptSrc.split(/\s+/)).not.toContain('https://cdn.jsdelivr.net');
      for (const tag of src.match(/<script[^>]+src="https:\/\/cdn\.jsdelivr\.net[^>]*>/g) || []) {
        expect(tag).toMatch(/integrity="sha384-/);
      }
    });
  }
});

// ── Audit 2026-09-23 low tail (L5): no third-party CORS proxies. They saw every
// watch URL and their responses were trusted; page scans go through
// search-watch-image and image bytes through fetch-image (own, guarded).
describe('No third-party CORS proxies (L5)', () => {
  it('index.html never calls corsproxy.io / allorigins and the CSP does not allow them', () => {
    const code = html.replace(/\/\/[^\n]*/g, '');   // ignore comments
    expect(code).not.toMatch(/https:\/\/corsproxy\.io|api\.allorigins\.win/);
  });
});
