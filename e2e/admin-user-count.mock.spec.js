import { test, expect } from '@playwright/test';

// Throwaway: runs the real loadAdminStats() against a stubbed data layer that
// mimics the live shape — 514 profiles, 6 internal, a page capped at 500 — and
// reads the rendered "Users" row. Verifies the destructuring order and the
// arithmetic, which a string-match test cannot.
const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';

test('the Users total reports every profile, not just the capped page', async ({ page }) => {
  await page.goto('/');
  const users = await page.evaluate(async (adminId) => {
    currentUser = { id: adminId };
    window.ADMIN_USER_ID = adminId;

    // Mirrors production: 514 profiles, 6 internal, of which only 2 are recent
    // enough to fall inside the newest 500. That is exactly the shape that made
    // the total read 498 (500 fetched, 2 of them internal).
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

    // Chainable stub: every filter returns itself; awaiting resolves the payload.
    const chain = (payload) => {
      const o = {
        then: (res) => res(payload),
        select: () => o, order: () => o, limit: () => o, in: () => o,
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
          in(_c, ids) { this._rows = all.filter((p) => ids.includes(p.id)); return this; },
          gte() { return this; }, lt() { return this; }, eq() { return this; },
          neq() { return this; }, like() { return this; }, is() { return this; }, not() { return this; },
        };
        return o;
      },
    });
    db.rpc = async () => ({ data: [], error: null });

    await loadAdminStats();
    const rows = [...document.querySelectorAll('#admin-stats div')]
      .filter((d) => d.children.length === 2 && d.children[0].textContent.trim() === 'Users');
    const usersRow = rows[0] ? rows[0].children[1].textContent.trim() : null;
    const tableTitle = [...document.querySelectorAll('#admin-stats .eyebrow')]
      .map((e) => e.textContent.trim()).find((t) => t.startsWith('Users ('));
    const internalTitle = [...document.querySelectorAll('#admin-stats .eyebrow')]
      .map((e) => e.textContent.trim()).find((t) => t.startsWith('Internal Accounts'));
    return { usersRow, tableTitle, internalTitle };
  }, ADMIN_ID);

  // 514 profiles - 6 internal = 508, NOT the 498 the capped page would give.
  expect(users.usersRow).toContain('508');
  expect(users.tableTitle).toBe('Users (498 newest of 508)');
  expect(users.internalTitle).toBe('Internal Accounts (6)');
});
