import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Guard-rail coverage for two admin metrics shipped this session that compute
// inline inside loadAdminStats (no extractable pure function): the cross-feature
// repeat-user definition and the advanced-mode usage surfacing. These assert the
// wiring stays intact so a refactor can't silently drop them.
// Specs: repeat-user (commit 7278e2d), advanced-mode (commit eed604a).
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('Admin repeat-user metric (R?)', () => {
  it('reads recent_active_days from admin_user_stats', () => {
    expect(html).toMatch(/recent_active_days/);
  });

  it('marks repeat when active on 2+ days (>1 threshold)', () => {
    expect(html).toMatch(/repeat:\s*\(activeDaysByUser\[[^\]]+\]\s*\|\|\s*0\)\s*>\s*1/);
  });

  it('uses the renamed "repeat" column key (not the stale r7)', () => {
    expect(html).toContain("{ key: 'repeat', label: 'R?' }");
    expect(html).not.toMatch(/key:\s*'r7'/);
  });

  it('detail modal repeat verdict also thresholds on >1 active days', () => {
    expect(html).toMatch(/d\.active_days\s*>\s*1/);
  });
});

describe('Admin advanced-mode surfacing', () => {
  it('counts advanced_used sessions per user from session summaries', () => {
    expect(html).toMatch(/if \(msg\.advanced_used\)/);
  });

  it('shows the 24h advanced-mode rollup on the dashboard', () => {
    expect(html).toContain("statRow('Advanced mode (24h)'");
  });

  it('excludes internal accounts from the advanced-mode rollup', () => {
    expect(html).toMatch(/advEntries\s*=\s*Object\.entries\(advSessionsByUser\)\.filter\(/);
    expect(html).toMatch(/advSessionsByUser\)\.filter\(\(\[uid\]\)\s*=>\s*!INTERNAL_IDS\.has\(uid\)\)/);
  });

  it('shows an Advanced mode line in the per-user detail modal', () => {
    expect(html).toContain("row('Advanced mode'");
    expect(html).toContain('d.advanced_sessions');
  });
});

describe('Totals card day-over-day deltas', () => {
  // Every count metric on the totals card wires a dod.* delta from admin_dod_counts
  // (SECURITY DEFINER RPC, external users only, last 24h). Spec: sql/2026-07-20-admin-dod-full.sql.
  const dodKeys = ['users', 'watches', 'wears', 'priceChecks', 'enhances',
    'measurements', 'wish', 'clubs', 'follows', 'friends', 'likes', 'comments'];

  it.each(dodKeys)('passes dod.%s into a statRow', (key) => {
    expect(html).toContain(`dod.${key}`);
  });

  it('fetches the deltas from the admin_dod_counts RPC', () => {
    expect(html).toContain("db.rpc('admin_dod_counts')");
  });

  it('Advanced mode delta compares 24h vs the prior 24h window', () => {
    expect(html).toMatch(/advDelta\s*=\s*advSessions24h\s*-\s*advSessionsPrev24h/);
    // prior-window advanced sessions parsed identically to the 24h window
    expect(html).toContain('advSessionsPrevByUser');
    expect(html).toMatch(/statRow\('Advanced mode \(24h\)',\s*advSessions24h,\s*advDelta/);
  });

  it('Totals splits measurements by engine — Pro V2 and Original, each with users + sessions', () => {
    expect(html).toContain("db.rpc('admin_engine_stats')");
    expect(html).toMatch(/engineRow\('Measurements — Pro V2',\s*eng\.prov2_sessions,\s*eng\.prov2_users,\s*eng\.prov2_sessions_24h,\s*eng\.prov2_sessions_prev24h\)/);
    expect(html).toMatch(/engineRow\('Measurements — Original',\s*eng\.orig_sessions,\s*eng\.orig_users,\s*eng\.orig_sessions_24h,\s*eng\.orig_sessions_prev24h\)/);
  });

  it('engineRow: sessions is the headline, users + 24h change live in the sub', () => {
    // sessions passed as the value with a null delta (no change glued to the all-time
    // total); the 24h-vs-prior change is folded into the sub next to the 24h figure
    expect(html).toMatch(/const engineRow = \(label, sessions, users, s24, sPrev24\) => \{[\s\S]*?statRow\(label, n, null,[\s\S]*?inlineDelta\(h24 - p24, false\)\)/);
  });

  it('Email Unsubs row: total stands alone, 24h change inverted (a rise is not green)', () => {
    // total passes null delta; the 24h change is inverted (higher-is-bad) via inlineDelta(..., true)
    expect(html).toMatch(/statRow\('Email Unsubs \(total\)',[^\n]*null,[^\n]*inlineDelta\([^\n]*unsub_prev24h[^\n]*,\s*true\)/);
  });

  it('Push approvals row: distinct users from admin_push_stats, newly-approved 24h delta', () => {
    // device_tokens is RLS-scoped to the owner, so the count has to come from the
    // SECURITY DEFINER RPC — a client-side select would return only the admin's rows.
    expect(html).toContain("db.rpc('admin_push_stats')");
    expect(html).toMatch(/pushUsers\s*=\s*Number\(push\.push_users\)\s*\|\|\s*0/);
    expect(html).toMatch(/statRow\('Push approved \(users\)',\s*pushUsers,\s*Number\(push\.push_users_24h\)[^\n]*pushSub\)/);
  });

  it('Push approvals sub: share of all users plus the device count', () => {
    expect(html).toMatch(/pushSub\s*=\s*\(extUsers > 0 \? Math\.round\(pushUsers \/ extUsers \* 100\) : 0\) \+ '% of users'/);
    expect(html).toMatch(/pushDevices\s*=\s*Number\(push\.push_devices\)\s*\|\|\s*0/);
  });

  // Regression: extUsers was the length of a profiles fetch capped at .limit(500),
  // so once there were more than 500 profiles the user total froze — it read 498
  // (500 newest, 2 of them internal) while the real external count was 508, and a
  // new signup only pushed an older row out of the window. Counting an array that
  // has a LIMIT on it is the bug; the count has to come over the wire.
  it('the user total comes from an exact count, not the length of a capped fetch', () => {
    expect(html).toContain("db.from('profiles').select('id', { count: 'exact', head: true })");
    expect(html).toContain('const extUsers = Math.max(0, (profileCountR.count || 0) - internalProfiles.length);');
    expect(html).not.toContain("const extUsers = allProfiles.filter(p => !INTERNAL_IDS.has(p.id)).length;");
  });

  it('internal accounts are fetched by id, not filtered out of the capped page', () => {
    // 4 of the 6 internal accounts are older than the 500 newest profiles, so
    // filtering the capped page showed an Internal Accounts table of 2.
    expect(html).toContain(".in('id', [...INTERNAL_IDS])");
    expect(html).toContain('const internalList = internalProfiles.map(toProfileItem);');
  });

  // The users table used to render the newest 500 profiles, so the sortable
  // columns ranked that page instead of the whole user base, and ~95 all-zero
  // signups crowded out everyone with actual activity. Now every profile is
  // fetched (paged) and the table keeps only users with a record.
  it('fetches every profile by paging, not a flat .limit(500)', () => {
    expect(html).toContain('const fetchAllProfiles = async () => {');
    expect(html).toMatch(/\.range\(from, from \+ PAGE - 1\)/);
    expect(html).not.toContain("db.from('profiles').select('id, username, display_name, avatar_url, created_at').order('created_at', { ascending: false }).limit(500)");
  });

  it('keeps only users with at least one record, posts included', () => {
    expect(html).toMatch(/const hasRecord = \(u\) => \(u\.watches \+ u\.wears \+ u\.posts \+ u\.priceChecks \+ u\.enhances \+ u\.measurements\) > 0;/);
    expect(html).toContain('.map(toProfileItem).filter(hasRecord);');
  });

  it('counts standalone posts per user from admin_user_stats', () => {
    // wears counts watch-linked logs only, so without r.posts the users whose
    // only activity is a standalone post would be filtered out of the table.
    expect(html).toMatch(/postByUser\[r\.user_id\] = Number\(r\.posts\) \|\| 0;/);
    expect(html).toMatch(/posts: postByUser\[p\.id\] \|\| 0,/);
  });

  it('the users table heading shows the filtered count against the user total', () => {
    expect(html).toMatch(/usersTitle = `Users with a record \(\$\{profileList\.length\} of \$\{extUsers\}\)`/);
  });

  it('internal accounts keep their own unfiltered table', () => {
    expect(html).toContain('const internalList = internalProfiles.map(toProfileItem);');
  });

  it('inlineDelta colors an embedded change and inverts when a rise is bad', () => {
    expect(html).toMatch(/const inlineDelta = \(delta, invert\) => \{[\s\S]*?const good = invert \? delta < 0 : delta > 0;/);
  });

  it('statRow renders green only when good, honoring the invert flag', () => {
    expect(html).toMatch(/const good = invert \? delta < 0 : delta > 0;/);
  });
});

describe('Email metrics day-over-day', () => {
  // Email Engagement + By Campaign carry a last-24h delta on every engagement
  // figure, summed from the per-row *_24h fields admin_email_engagement returns.
  // Spec: sql/2026-08-04-email-engagement-dod.sql.
  it('sums the 24h fields alongside the all-time totals', () => {
    expect(html).toMatch(/let delivered24 = 0, opened24 = 0, openedHuman24 = 0, clicked24 = 0, bounced24 = 0;/);
    for (const f of ['delivered_24h', 'opened_24h', 'clicked_24h', 'bounced_24h']) {
      expect(html).toContain(`r.${f}`);
    }
  });

  it('dodDelta hides a zero change and inverts when a rise is bad', () => {
    expect(html).toMatch(/const dodDelta = \(n, invert\) => \{[\s\S]*?if \(!d\) return '';[\s\S]*?const good = invert \? d < 0 : d > 0;/);
  });

  it('headline card shows a delta on delivered, opened, clicked and bounced', () => {
    expect(html).toContain("statRow('Delivered', delivered, null, dodDelta(delivered24))");
    // Opened reports HUMAN opens; prefetch is shown beside it, not folded in.
    expect(html).toContain("statRow('Opened', openedHuman, pct(openedHuman, delivered)");
    expect(html).toContain('dodDelta(openedHuman24)');
    expect(html).toContain("statRow('Clicked', clicked, pct(clicked, delivered), dodDelta(clicked24))");
    // bounces invert: a rise is not a green number
    expect(html).toContain("dodDelta(bounced24, true)");
  });

  it('per-campaign rows carry their own 24h deltas', () => {
    expect(html).toContain('Delivered: ${s.delivered}${dodDelta(s.delivered24)}');
    expect(html).toContain('dodDelta(s.openedHuman24)');
    expect(html).toContain('dodDelta(s.clicked24)');
  });

  it('accumulates per-campaign 24h counts for both subjects and broadcast labels', () => {
    // one accumulator per source: by_subject rows (r.*) and broadcast rows (b.*)
    expect(html).toContain('s.delivered24 += +r.delivered_24h || 0;');
    expect(html).toContain('s.delivered24 += +b.delivered_24h || 0;');
    expect(html).toContain('s.opened24 += +b.opened_24h || 0;');
    expect(html).toContain('s.clicked24 += +b.clicked_24h || 0;');
  });
});

describe('Machine vs human opens', () => {
  // Apple Mail Privacy Protection and Gmail's image proxy fetch the tracking
  // pixel the moment a message is delivered, so a raw open count measures mail
  // clients, not readers: a 50-recipient broadcast logged 11 opens inside 90
  // seconds, 10 of them under 5s. admin_email_engagement now returns
  // opened_human (>= 30s after delivery) alongside opened, and the admin UI
  // leads with the human figure. Spec: sql/2026-08-13-open-split-prefetch.sql.
  it('accumulates opened_human from both by_subject rows and broadcast labels', () => {
    expect(html).toContain('openedHuman += +r.opened_human || 0;');
    expect(html).toContain('s.openedHuman += +r.opened_human || 0;');
    expect(html).toContain('s.openedHuman += +b.opened_human || 0;');
    expect(html).toContain('openedHuman24 += +r.opened_human_24h || 0;');
    expect(html).toContain('s.openedHuman24 += +b.opened_human_24h || 0;');
  });

  it('derives the prefetch count as opened minus human, never negative', () => {
    expect(html).toContain('const prefetch = (total, human) => Math.max(0, (+total || 0) - (+human || 0));');
  });

  it('per-campaign rows show the human open rate, with prefetch beside it', () => {
    expect(html).toContain('Opened: ${s.openedHuman} (${pct(s.openedHuman, base)})');
    expect(html).toContain('prefetch(s.opened, s.openedHuman)');
  });

  it('marks prefetch rows in the recent opens list instead of hiding them', () => {
    // Filtering them out would make a live broadcast read as zero engagement.
    expect(html).toContain("e.machine ? '⟳' : '👁'");
    expect(html).toContain("const dim = e.machine ? 'opacity:.5;' : '';");
  });

  it('zero-initialises the new fields on every campaign accumulator', () => {
    // A missing key would make the row render "undefined" the first time a
    // campaign is seen; both accumulators (subject and label) seed it.
    const seeds = html.match(/\{ sent: 0, delivered: 0, opened: 0, openedHuman: 0, clicked: 0, delivered24: 0, opened24: 0, openedHuman24: 0, clicked24: 0 \}/g) || [];
    expect(seeds.length).toBe(2);
  });
});

describe('Per-User Averages w/w + m/m', () => {
  // Each average row carries its change vs 7d and 30d ago, computed from
  // admin_per_user_trend snapshots (now/week/month, external only) so both sides
  // of every delta share one definition. Spec: sql/2026-08-15-admin-per-user-trend.sql.
  const keys = ['watches', 'wears', 'price_checks', 'enhances', 'measurements', 'follows'];

  it('fetches the snapshots from the admin_per_user_trend RPC', () => {
    expect(html).toContain("db.rpc('admin_per_user_trend')");
  });

  it.each(keys)('the %s row passes trendSub into its sub slot', (key) => {
    expect(html).toContain(`null, trendSub('${key}'))`);
  });

  it('trendSub computes avg_now − avg_then at 3 decimals for both windows', () => {
    const fn = html.match(/const trendSub = \(key\) => \{[\s\S]*?\n    \};/)[0];
    const trend = { now: { users: 514, watches: 1139 }, week: { users: 487, watches: 1087 }, month: { users: 415, watches: 892 } };
    const trendSub = new Function('trend', fn + ' return trendSub;')(trend);
    const out = trendSub('watches');
    expect(out).toContain('w/w');
    expect(out).toContain('m/m');
    expect(out).toContain('-0.016'); // 2.216 - 2.232
    expect(out).toContain('+0.067'); // 2.2160 - 2.1494
    expect(new Function('trend', fn + ' return trendSub;')({})('watches')).toBe('');
  });
});
