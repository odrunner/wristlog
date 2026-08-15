import { test, expect } from '@playwright/test';

// Throwaway: runs the real loadAdminStats() against a stubbed data layer that
// mimics the live shape — 514 profiles, 6 internal, only some with activity —
// and reads the rendered "Users" row plus the users-table heading. Verifies the
// destructuring order, the arithmetic and the has-a-record filter, which a
// string-match test cannot.
const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';

test('the Users total counts every profile; the table lists only users with a record', async ({ page }) => {
  await page.goto('/');
  const users = await page.evaluate(async (adminId) => {
    currentUser = { id: adminId };
    window.ADMIN_USER_ID = adminId;

    // Mirrors production: 514 profiles, 6 internal, 4 of them older than the
    // newest 500 — the shape that made the total read 498 back when the fetch
    // was capped, and that leaves internal accounts off a capped page.
    const mkProfile = (id, ageHours) => ({
      id, username: 'u' + id, display_name: 'U' + id, avatar_url: null,
      created_at: new Date(Date.now() - ageHours * 3600e3).toISOString(),
    });
    const all = [];
    for (let i = 0; i < 508; i++) all.push(mkProfile('ext-' + i, 10 + i));
    all.push(mkProfile('int-recent-1', 0.5), mkProfile('int-recent-2', 1.5));
    for (let i = 0; i < 4; i++) all.push(mkProfile('int-old-' + i, 1000 + i));
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const internalIds = all.filter((p) => p.id.startsWith('int-')).map((p) => p.id);
    // INTERNAL_IDS is a top-level `let`, so it lives in the global lexical
    // scope, not on window — assign it by bare name or the stub never lands.
    INTERNAL_IDS = new Set(internalIds);
    loadInternalIds = async () => { INTERNAL_IDS = new Set(internalIds); };

    // Activity: the 120 newest external profiles have a watch, 30 older ones have
    // only a standalone post (which `wears` does not count), everyone else is an
    // empty signup. 150 of the 508 external users should reach the table.
    const withWatch = all.filter((p) => p.id.startsWith('ext-')).slice(0, 120).map((p) => p.id);
    const withPostOnly = all.filter((p) => p.id.startsWith('ext-')).slice(-30).map((p) => p.id);
    const userStats = all.map((p) => ({
      user_id: p.id,
      watches: withWatch.includes(p.id) ? 2 : 0,
      wears: 0,
      posts: withPostOnly.includes(p.id) ? 1 : 0,
      price_checks: 0, enhances: 0, recent_active_days: 0,
    }));

    // Chainable stub: every filter returns itself; awaiting resolves the payload.
    const chain = (payload) => {
      const o = {
        then: (res) => res(payload),
        select: () => o, order: () => o, limit: () => o, range: () => o, in: () => o,
        gte: () => o, lt: () => o, eq: () => o, neq: () => o, like: () => o, is: () => o, not: () => o,
      };
      return o;
    };
    db.from = (table) => ({
      select: (_cols, opts) => {
        if (table !== 'profiles') return chain({ data: [], count: 0, error: null });
        if (opts && opts.count) return chain({ data: null, count: all.length, error: null });
        const o = {
          _rows: all,
          then(res) { return res({ data: this._rows, count: null, error: null }); },
          order() { return this; },
          limit(n) { this._rows = all.slice(0, n); return this; },
          range(from, to) { this._rows = all.slice(from, to + 1); return this; },
          in(_c, ids) { this._rows = all.filter((p) => ids.includes(p.id)); return this; },
          gte() { return this; }, lt() { return this; }, eq() { return this; },
          neq() { return this; }, like() { return this; }, is() { return this; }, not() { return this; },
        };
        return o;
      },
    });
    db.rpc = async (name) => ({ data: name === 'admin_user_stats' ? userStats : [], error: null });

    await loadAdminStats();
    const rows = [...document.querySelectorAll('#admin-stats div')]
      .filter((d) => d.children.length === 2 && d.children[0].textContent.trim() === 'Users');
    const usersRow = rows[0] ? rows[0].children[1].textContent.trim() : null;
    const tableTitle = [...document.querySelectorAll('#admin-stats .eyebrow')]
      .map((e) => e.textContent.trim()).find((t) => t.startsWith('Users with'));
    const internalTitle = [...document.querySelectorAll('#admin-stats .eyebrow')]
      .map((e) => e.textContent.trim()).find((t) => t.startsWith('Internal Accounts'));
    const bodyRows = document.querySelectorAll('#admin-users tbody tr').length;
    return { usersRow, tableTitle, internalTitle, bodyRows };
  }, ADMIN_ID);

  // 514 profiles - 6 internal = 508, NOT the 498 the capped page would give.
  expect(users.usersRow).toContain('508');
  // 120 with a watch + 30 whose only activity is a standalone post. The 30 are
  // the OLDEST profiles, so they also prove the table is no longer a newest-N page.
  expect(users.tableTitle).toBe('Users with a record (150 of 508)');
  expect(users.bodyRows).toBe(150);
  expect(users.internalTitle).toBe('Internal Accounts (6)');
});
