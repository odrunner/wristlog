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

// ── Load/Edit ────────────────────────────────────────────────────────────
// Round-trips every field that promoFormSlot()/savePromoSlot() wrote back
// into the composer, then flips savePromoSlot() from insert to update
// without ever letting an update touch `status`.
test.describe('admin Promos tab — load/edit (mocked)', () => {
  const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';

  test('editing a slot loads every field, including the url: action and null max_impressions', async ({ page }) => {
    await page.goto('/');
    const slot = {
      id: 'slot-123',
      eyebrow: 'New',
      heading: 'Rank your collection',
      body: '<b>Try it</b>',
      image_url: 'https://example.com/hero.jpg',
      images: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
      cta_label: 'Start ranking',
      cta_action: 'url:https://example.com/custom',
      audience: 'no_wishlist',
      priority: 5,
      max_impressions: null,
      status: 'draft',
    };
    const out = await page.evaluate((slot) => {
      currentUser = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5' };
      window.renderPromoAdminOptions();
      window.loadPromoIntoForm(slot);
      const val = (id) => document.getElementById(id).value;
      return {
        eyebrow: val('promo-eyebrow'),
        heading: val('promo-heading'),
        body: val('promo-body'),
        imageUrl: val('promo-image-url'),
        images: val('promo-images'),
        ctaLabel: val('promo-cta-label'),
        ctaAction: val('promo-cta-action'),
        ctaUrl: val('promo-cta-url'),
        audience: val('promo-audience'),
        priority: val('promo-priority'),
        maxImpressions: val('promo-max-impressions'),
        editingId: _editingPromoId,
        saveLabel: document.getElementById('promo-save-btn').textContent,
      };
    }, slot);
    expect(out.eyebrow).toBe('New');
    expect(out.heading).toBe('Rank your collection');
    expect(out.body).toBe('<b>Try it</b>');
    expect(out.imageUrl).toBe('https://example.com/hero.jpg');
    expect(out.images).toBe('https://example.com/1.jpg\nhttps://example.com/2.jpg');
    expect(out.ctaLabel).toBe('Start ranking');
    expect(out.ctaAction).toBe('url:');
    expect(out.ctaUrl).toBe('https://example.com/custom');
    expect(out.audience).toBe('no_wishlist');
    expect(out.priority).toBe('5');
    expect(out.maxImpressions).toBe('');
    expect(out.editingId).toBe('slot-123');
    expect(out.saveLabel).toBe('Update slot');
  });

  test('editing a slot with a registry-key cta_action selects the key and clears the url field', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(() => {
      currentUser = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5' };
      window.renderPromoAdminOptions();
      document.getElementById('promo-cta-url').value = 'https://leftover.example.com';
      window.loadPromoIntoForm({
        id: 's1', heading: 'H', cta_action: 'open_wishlist', images: [], max_impressions: 3,
      });
      return {
        action: document.getElementById('promo-cta-action').value,
        url: document.getElementById('promo-cta-url').value,
        maxImpressions: document.getElementById('promo-max-impressions').value,
      };
    });
    expect(out.action).toBe('open_wishlist');
    expect(out.url).toBe('');
    expect(out.maxImpressions).toBe('3');
  });

  test('update targets the existing row via .eq(id), never inserts, and never sends status', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (id) => {
      currentUser = { id };
      let insertCalled = false;
      let updatePatch = null;
      let updateId = null;
      db.from = () => ({
        insert: async (r) => { insertCalled = true; return { data: [r], error: null }; },
        update: (patch) => ({ eq: async (col, eid) => { updatePatch = patch; updateId = eid; return { data: null, error: null }; } }),
      });
      window.loadPromoIntoForm({
        id: 'existing-slot-id', heading: 'Old heading', status: 'active', images: [], max_impressions: null,
      });
      document.getElementById('promo-heading').value = 'Updated heading';
      await window.savePromoSlot();
      return { insertCalled, updatePatch, updateId };
    }, ADMIN_ID);
    expect(result.insertCalled).toBe(false);
    expect(result.updateId).toBe('existing-slot-id');
    expect(result.updatePatch.heading).toBe('Updated heading');
    expect(Object.prototype.hasOwnProperty.call(result.updatePatch, 'status')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.updatePatch, 'created_by')).toBe(false);
  });

  test('the datetime round trip is drift-free: edit -> save -> edit -> save yields identical timestamps', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      currentUser = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5' };
      document.getElementById('promo-heading').value = 'Round trip test';
      document.getElementById('promo-starts').value = '2026-08-03T14:30';
      document.getElementById('promo-ends').value = '2026-08-10T09:15';
      const firstSave = window.promoFormSlot();
      // Load the "saved" row back into the form, as loadPromoAdmin() would
      // after a real insert, then read the composer's payload again.
      window.loadPromoIntoForm({
        id: 'x', heading: 'Round trip test', images: [], max_impressions: null, cta_action: '',
        starts_at: firstSave.starts_at, ends_at: firstSave.ends_at,
      });
      const secondSave = window.promoFormSlot();
      return {
        firstStarts: firstSave.starts_at, firstEnds: firstSave.ends_at,
        secondStarts: secondSave.starts_at, secondEnds: secondSave.ends_at,
      };
    });
    expect(result.secondStarts).toBe(result.firstStarts);
    expect(result.secondEnds).toBe(result.firstEnds);
    // Sanity: the round trip didn't just null both fields out.
    expect(result.firstStarts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    expect(result.firstEnds).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  });

  test('cancel edit resets the form to insert mode', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      currentUser = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5' };
      window.loadPromoIntoForm({ id: 'slot-1', heading: 'Editing me', images: [], max_impressions: null });
      const midEditing = _editingPromoId;
      const midLabel = document.getElementById('promo-save-btn').textContent;
      window.clearPromoForm();
      return {
        midEditing, midLabel,
        afterEditing: _editingPromoId,
        afterLabel: document.getElementById('promo-save-btn').textContent,
        heading: document.getElementById('promo-heading').value,
      };
    });
    expect(result.midEditing).toBe('slot-1');
    expect(result.midLabel).toBe('Update slot');
    expect(result.afterEditing).toBeNull();
    expect(result.afterLabel).toBe('Save as Draft');
    expect(result.heading).toBe('');
  });

  test('the slot list uses delegated data-* handlers (no inline onclick) for Edit and Activate/Archive', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      currentUser = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5' };
      const slots = [{ id: 's1', heading: 'Slot One', status: 'draft', audience: 'all', images: [], max_impressions: null, cta_action: '' }];
      const emptyChain = { limit: () => emptyChain, order: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) };
      const slotsChain = { order: async () => ({ data: slots, error: null }) };
      let toggledTo = null;
      db.from = (table) => ({
        select: () => (table === 'promo_slots' ? slotsChain : emptyChain),
        update: (patch) => ({ eq: async (col, id) => { toggledTo = { id, patch }; return { data: null, error: null }; } }),
      });
      db.rpc = async () => ({ data: [], error: null });
      await window.loadPromoAdmin();
      const listHtml = document.getElementById('promo-list').innerHTML;
      document.querySelector('[data-promo-edit]').click();
      const headingAfterEdit = document.getElementById('promo-heading').value;
      document.querySelector('[data-promo-toggle]').click();
      await new Promise((r) => setTimeout(r, 50));
      return { hasOnclick: listHtml.includes('onclick='), headingAfterEdit, toggledTo };
    });
    expect(result.hasOnclick).toBe(false);
    expect(result.headingAfterEdit).toBe('Slot One');
    expect(result.toggledTo.id).toBe('s1');
    expect(result.toggledTo.patch.status).toBe('active');
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

  test('a non-admin cannot load a slot into the composer or update it', async ({ page }) => {
    await page.goto('/');
    await installRecordingDb(page);
    const result = await page.evaluate(async (id) => {
      currentUser = { id };
      document.getElementById('promo-heading').value = 'Untouched';
      window.loadPromoIntoForm({ id: 'slot-x', heading: 'Should not load', images: [], max_impressions: null });
      const headingAfterEditAttempt = document.getElementById('promo-heading').value;
      const editingAfterAttempt = _editingPromoId;
      await window.savePromoSlot();
      return { headingAfterEditAttempt, editingAfterAttempt, calls: window.__promoCalls };
    }, NON_ADMIN_ID);
    expect(result.headingAfterEditAttempt).toBe('Untouched');
    expect(result.editingAfterAttempt).toBeNull();
    expect(result.calls).toEqual([]);
  });
});

// ── The composer preview must not touch feed state ──────────────────────────
// The preview deliberately renders through the REAL renderPromoCard(), so the
// node it produces carries data-promo-id="preview", data-promo-cta and
// data-promo-dismiss — the same hooks the delegated feed handler listens for.
// Clicking ✕ in the composer therefore ran dismissPromo('preview'), which burnt
// the session's max_per_session budget and permanently poisoned _promoDismissed;
// and the document-wide impression observer logged impression events with
// slot_id 'preview', which fail the uuid cast silently.
test.describe('admin preview is inert (mocked)', () => {
  test('clicking ✕ in the preview burns no budget and logs no event', async ({ page }) => {
    await page.goto('/');
    const res = await page.evaluate(() => {
      currentUser = { id: 'u1' };
      window.__events = [];
      db.from = (t) => ({ insert: async (row) => { window.__events.push({ t, row }); return { error: null }; } });
      _promoPlaced = new Set(); _promoDismissed = new Set(); _promoImpressed = new Set();
      document.getElementById('promo-heading').value = 'Preview me';
      document.getElementById('promo-cta-label').value = 'Go';
      window.updatePromoPreview();

      const prev = document.getElementById('promo-preview');
      prev.querySelector('.promo-dismiss').click();
      prev.querySelector('.promo-cta')?.click();

      return {
        placed: [..._promoPlaced],
        dismissed: [..._promoDismissed],
        events: window.__events,
        stillRendered: !!prev.querySelector('.promo-card'),
      };
    });
    expect(res.placed).toEqual([]);
    expect(res.dismissed).toEqual([]);
    expect(res.events).toEqual([]);
    expect(res.stillRendered).toBe(true);   // the preview is not a live card to dismiss
  });

  test('the impression observer only watches cards inside the feed', async ({ page }) => {
    await page.goto('/');
    const observed = await page.evaluate(() => {
      window.__observed = [];
      _promoObserver = null;
      window.IntersectionObserver = class {
        constructor(cb) { this.cb = cb; }
        observe(n) { window.__observed.push(n.id); }
        unobserve() {} disconnect() {}
      };
      const card = (id) =>
        `<div class="promo-card" id="promocard-${id}" data-promo-id="${id}"></div>`;
      document.getElementById('feed-list').innerHTML = card('p1');
      // Raw markup, so this stands even for a card the preview did not strip.
      document.getElementById('promo-preview').innerHTML = card('preview');
      window.observePromoImpressions();
      return window.__observed;
    });
    expect(observed).toEqual(['promocard-p1']);
  });
});
