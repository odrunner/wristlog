import { test, expect } from '@playwright/test';

test.describe('admin Promos tab (mocked)', () => {
  test('audience and action dropdowns are generated from the registries', async ({ page }) => {
    await page.goto('/');
    const { audiences, actions } = await page.evaluate(() => {
      window.renderPromoAdminOptions();
      const opts = (id) => [...document.getElementById(id).options].map((o) => o.value);
      return { audiences: opts('promo-audience'), actions: opts('promo-cta-action') };
    });
    await page.evaluate(() => { window.__keys = Object.keys(PROMO_AUDIENCES); });
    const registryAudiences = await page.evaluate(() => window.__keys);
    // Generated, not hand-maintained — the two can never drift.
    expect(audiences).toEqual(registryAudiences);
    expect(actions).toContain('open_ranking_game');
  });

  test('the preview renders the real card, not a second renderer', async ({ page }) => {
    await page.goto('/');
    const same = await page.evaluate(() => {
      document.getElementById('promo-heading').value = 'Preview me';
      document.getElementById('promo-body').value = '<b>bold</b>';
      window.updatePromoPreview();
      const preview = document.getElementById('promo-preview').innerHTML;
      return preview.includes('Preview me') && preview.includes('<b>bold</b>');
    });
    expect(same).toBe(true);
  });

  test('the preview sanitizes exactly like the feed does', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(() => {
      document.getElementById('promo-heading').value = 'H';
      document.getElementById('promo-body').value = '<script>alert(1)<\/script>ok';
      window.updatePromoPreview();
      return document.getElementById('promo-preview').innerHTML;
    });
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('ok');
  });

  test('a new slot is saved as a draft, never active', async ({ page }) => {
    await page.goto('/');
    const row = await page.evaluate(async () => {
      currentUser = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5' };
      let captured = null;
      db.from = () => ({ insert: async (r) => { captured = r; return { data: [r], error: null }; } });
      document.getElementById('promo-heading').value = 'Draft slot';
      await window.savePromoSlot();
      return captured;
    });
    expect(row.status).toBe('draft');
  });
});

// The write functions (savePromoSlot, setPromoStatus, savePromoConfig) must
// gate on ADMIN_USER_ID the same way every sibling admin write function does
// (adminConfirmRemoval, saveOfficialDraft, etc.) — RLS is the real boundary,
// but the client should never even attempt the request for a non-admin.
test.describe('admin Promos tab — write guards (mocked)', () => {
  const NON_ADMIN_ID = '11111111-1111-1111-1111-111111111111';
  const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';

  // Records every insert/update attempt without a real db.from() chain.
  async function installRecordingDb(page) {
    await page.evaluate(() => {
      window.__promoCalls = [];
      const readChain = {
        limit: () => readChain,
        order: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      db.from = (table) => ({
        insert: async (row) => { window.__promoCalls.push({ table, op: 'insert' }); return { data: [row], error: null }; },
        update: (patch) => ({
          eq: async () => { window.__promoCalls.push({ table, op: 'update' }); return { data: null, error: null }; },
        }),
        select: () => readChain,
      });
      db.rpc = async () => ({ data: [], error: null });
    });
  }

  test('a non-admin currentUser cannot save a slot, change status, or save config', async ({ page }) => {
    await page.goto('/');
    await installRecordingDb(page);
    await page.evaluate((id) => {
      currentUser = { id };
      document.getElementById('promo-heading').value = 'Should never save';
      document.getElementById('promo-cfg-first').value = '2';
    }, NON_ADMIN_ID);

    await page.evaluate(async () => {
      await window.savePromoSlot();
      await window.setPromoStatus('some-slot-id', 'active');
      await window.savePromoConfig();
    });

    const calls = await page.evaluate(() => window.__promoCalls);
    expect(calls).toEqual([]);
  });

  test('the admin id can still write through all three functions', async ({ page }) => {
    await page.goto('/');
    await installRecordingDb(page);
    await page.evaluate((id) => {
      currentUser = { id };
      document.getElementById('promo-heading').value = 'Admin slot';
      document.getElementById('promo-cfg-first').value = '2';
    }, ADMIN_ID);

    await page.evaluate(async () => {
      await window.savePromoSlot();
      await window.setPromoStatus('some-slot-id', 'active');
      await window.savePromoConfig();
    });

    const calls = await page.evaluate(() => window.__promoCalls);
    expect(calls.map((c) => c.op)).toEqual(['insert', 'update', 'update']);
  });
});
