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

  // Reviewer-caught regression: _editingPromoId used to survive a successful
  // update, so a second Save silently re-updated (overwrote) the SAME row
  // instead of inserting a new one. Repro: edit live-slot "Live" -> Update ->
  // type a completely different slot -> Save -> live-slot is destroyed and
  // replaced, no new row created. The fix must exit edit mode on success and
  // stay in edit mode on failure (so an in-flight edit isn't lost to a
  // transient error).
  test('a successful update exits edit mode: the next Save inserts, not a second update on the same row', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (id) => {
      currentUser = { id };
      const calls = [];
      db.from = () => ({
        insert: async (r) => { calls.push({ op: 'insert', row: r }); return { data: [r], error: null }; },
        update: (patch) => ({ eq: async (col, eid) => { calls.push({ op: 'update', id: eid, patch }); return { data: null, error: null }; } }),
      });
      window.loadPromoIntoForm({ id: 'live-slot', heading: 'Live', status: 'active', images: [], max_impressions: null });
      document.getElementById('promo-heading').value = 'Live';
      await window.savePromoSlot(); // update #1 — succeeds
      const editingAfterFirstSave = _editingPromoId;
      const saveLabelAfterFirstSave = document.getElementById('promo-save-btn').textContent;
      document.getElementById('promo-heading').value = 'A totally different slot';
      await window.savePromoSlot(); // must be an INSERT, never a second update('live-slot', ...)
      return { calls, editingAfterFirstSave, saveLabelAfterFirstSave };
    }, ADMIN_ID);
    expect(result.editingAfterFirstSave).toBeNull();
    expect(result.saveLabelAfterFirstSave).toBe('Save as Draft');
    expect(result.calls.map((c) => c.op)).toEqual(['update', 'insert']);
    expect(result.calls[1].row.heading).toBe('A totally different slot');
    expect(result.calls.filter((c) => c.op === 'update' && c.id === 'live-slot').length).toBe(1);
  });

  test('a failed update stays in edit mode: the next Save still targets the same row', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (id) => {
      currentUser = { id };
      let attempt = 0;
      const calls = [];
      db.from = () => ({
        insert: async (r) => { calls.push({ op: 'insert', row: r }); return { data: [r], error: null }; },
        update: (patch) => ({
          eq: async (col, eid) => {
            attempt++;
            calls.push({ op: 'update', id: eid, patch, attempt });
            if (attempt === 1) return { data: null, error: { message: 'network blip' } };
            return { data: null, error: null };
          },
        }),
      });
      window.loadPromoIntoForm({ id: 'live-slot', heading: 'Live', status: 'active', images: [], max_impressions: null });
      document.getElementById('promo-heading').value = 'Edited while offline';
      await window.savePromoSlot(); // fails
      const editingAfterFailure = _editingPromoId;
      const saveLabelAfterFailure = document.getElementById('promo-save-btn').textContent;
      await window.savePromoSlot(); // retried save must still be an UPDATE on live-slot
      return { calls, editingAfterFailure, saveLabelAfterFailure };
    }, ADMIN_ID);
    expect(result.editingAfterFailure).toBe('live-slot');
    expect(result.saveLabelAfterFailure).toBe('Update slot');
    expect(result.calls.map((c) => c.op)).toEqual(['update', 'update']);
    expect(result.calls[1].id).toBe('live-slot');
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

// ── Pause / resume ───────────────────────────────────────────────────────
// Before this, `next = s.status === 'active' ? 'archived' : 'active'` made
// the list a single binary toggle: an active slot could only go to archived,
// with no way back to draft (no pause). All three transitions route through
// the same setPromoStatus(id, status) write path and the same delegated
// data-promo-toggle/data-promo-next handler as before — this only changes
// which buttons a row offers for its current status.
test.describe('admin Promos tab — pause/resume (mocked)', () => {
  const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';
  const NON_ADMIN_ID = '11111111-1111-1111-1111-111111111111';

  const threeSlots = () => [
    { id: 'active-1', status: 'active', heading: 'Active slot', audience: 'all', images: [], max_impressions: null, cta_action: '' },
    { id: 'draft-1', status: 'draft', heading: 'Draft slot', audience: 'all', images: [], max_impressions: null, cta_action: '' },
    { id: 'archived-1', status: 'archived', heading: 'Archived slot', audience: 'all', images: [], max_impressions: null, cta_action: '' },
  ];

  async function installReadOnlyDb(page, slots) {
    await page.evaluate((slots) => {
      const emptyChain = { limit: () => emptyChain, order: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) };
      const slotsChain = { order: async () => ({ data: slots, error: null }) };
      db.from = (table) => ({ select: () => (table === 'promo_slots' ? slotsChain : emptyChain) });
      db.rpc = async () => ({ data: [], error: null });
    }, slots);
  }

  test('active offers Pause + Archive; draft offers Activate + Archive; archived offers only Activate', async ({ page }) => {
    await page.goto('/');
    await installReadOnlyDb(page, threeSlots());
    const rows = await page.evaluate(async () => {
      currentUser = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5' };
      await window.loadPromoAdmin();
      return [...document.querySelectorAll('#promo-list .admin-card')].map((c) => ({
        heading: c.querySelector('div').textContent,
        buttons: [...c.querySelectorAll('[data-promo-toggle]')].map((b) => ({ label: b.textContent.trim(), next: b.dataset.promoNext })),
      }));
    });
    const byHeading = Object.fromEntries(rows.map((r) => [r.heading, r.buttons]));
    expect(byHeading['Active slot']).toEqual([{ label: 'Pause', next: 'draft' }, { label: 'Archive', next: 'archived' }]);
    expect(byHeading['Draft slot']).toEqual([{ label: 'Activate', next: 'active' }, { label: 'Archive', next: 'archived' }]);
    expect(byHeading['Archived slot']).toEqual([{ label: 'Activate', next: 'active' }]);
  });

  test('Pause on an active slot sets status to exactly "draft" and nothing else, via the delegated Pause button', async ({ page }) => {
    await page.goto('/');
    await installReadOnlyDb(page, [threeSlots()[0]]); // active-1 only
    const result = await page.evaluate(async () => {
      currentUser = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5' };
      let captured = null;
      await window.loadPromoAdmin();
      // setPromoStatus() reloads the list on success, so `select` has to stay
      // answerable — only `update` is the thing this test cares about.
      const emptyChain = { limit: () => emptyChain, order: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) };
      db.from = () => ({
        select: () => emptyChain,
        update: (patch) => ({ eq: async (col, eid) => { captured = { col, eid, patch }; return { data: null, error: null }; } }),
      });
      db.rpc = async () => ({ data: [], error: null });
      const pauseBtn = [...document.querySelectorAll('[data-promo-toggle="active-1"]')].find((b) => b.dataset.promoNext === 'draft');
      pauseBtn.click();
      await new Promise((r) => setTimeout(r, 50));
      return captured;
    });
    expect(result.col).toBe('id');
    expect(result.eid).toBe('active-1');
    expect(Object.keys(result.patch)).toEqual(['status']);
    expect(result.patch.status).toBe('draft');
  });

  test('Activate still works from draft and from archived, through the delegated handler', async ({ page }) => {
    await page.goto('/');
    const slots = threeSlots().filter((s) => s.id !== 'active-1');
    const captured = await page.evaluate(async (slots) => {
      currentUser = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5' };
      const calls = [];
      // setPromoStatus() reloads the list after each write, so `select` has
      // to keep answering with both rows (statically — this mock doesn't
      // model the actual status change) or the second button disappears
      // from the DOM before it can be clicked.
      const emptyChain = { limit: () => emptyChain, order: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) };
      const slotsChain = { order: async () => ({ data: slots, error: null }) };
      db.from = (table) => ({
        select: () => (table === 'promo_slots' ? slotsChain : emptyChain),
        update: (patch) => ({ eq: async (col, eid) => { calls.push({ eid, patch }); return { data: null, error: null }; } }),
      });
      db.rpc = async () => ({ data: [], error: null });
      await window.loadPromoAdmin();
      [...document.querySelectorAll('[data-promo-toggle="draft-1"]')].find((b) => b.dataset.promoNext === 'active').click();
      await new Promise((r) => setTimeout(r, 50));
      document.querySelector('[data-promo-toggle="archived-1"]').click();
      await new Promise((r) => setTimeout(r, 50));
      return calls;
    }, slots);
    expect(captured).toEqual([
      { eid: 'draft-1', patch: { status: 'active' } },
      { eid: 'archived-1', patch: { status: 'active' } },
    ]);
  });

  test('a non-admin cannot pause, resume, or archive a slot', async ({ page }) => {
    await page.goto('/');
    const called = await page.evaluate(async (id) => {
      currentUser = { id };
      let called = false;
      db.from = () => ({ update: () => ({ eq: async () => { called = true; return { data: null, error: null }; } }) });
      await window.setPromoStatus('active-1', 'draft');
      await window.setPromoStatus('draft-1', 'active');
      await window.setPromoStatus('archived-1', 'active');
      return called;
    }, NON_ADMIN_ID);
    expect(called).toBe(false);
  });

  test('a paused (draft-with-impressions) slot reads "paused" in the list, not "draft"', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const slots = [{ id: 'paused-1', status: 'draft', heading: 'Paused slot', audience: 'all', images: [], max_impressions: null, cta_action: '' }];
      const stats = [{ slot_id: 'paused-1', impressions: 42, clicks: 3, dismissals: 1, distinct_users: 10 }];
      const emptyChain = { limit: () => emptyChain, order: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) };
      const slotsChain = { order: async () => ({ data: slots, error: null }) };
      db.from = (table) => ({ select: () => (table === 'promo_slots' ? slotsChain : emptyChain) });
      db.rpc = async () => ({ data: stats, error: null });
    });
    const rowText = await page.evaluate(async () => {
      currentUser = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5' };
      await window.loadPromoAdmin();
      return document.querySelector('#promo-list .admin-card').textContent;
    });
    expect(rowText).toContain('paused');
    expect(rowText).not.toContain('draft');
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
// node it produces carries data-promo-id="preview" and data-promo-cta — the
// same hooks the delegated feed handler listens for. Clicking the CTA in the
// composer would otherwise run runPromoAction('preview') against a slot id
// that doesn't exist; and the document-wide impression observer logged
// impression events with slot_id 'preview', which fail the uuid cast silently.
test.describe('admin preview is inert (mocked)', () => {
  test('clicking the CTA in the preview burns no budget and logs no event', async ({ page }) => {
    await page.goto('/');
    const res = await page.evaluate(() => {
      currentUser = { id: 'u1' };
      window.__events = [];
      db.from = (t) => ({ insert: async (row) => { window.__events.push({ t, row }); return { error: null }; } });
      _promoPlaced = new Set(); _promoImpressed = new Set();
      document.getElementById('promo-heading').value = 'Preview me';
      document.getElementById('promo-cta-label').value = 'Go';
      window.updatePromoPreview();

      const prev = document.getElementById('promo-preview');
      prev.querySelector('.promo-cta')?.click();

      return {
        placed: [..._promoPlaced],
        events: window.__events,
        stillRendered: !!prev.querySelector('.promo-card'),
      };
    });
    expect(res.placed).toEqual([]);
    expect(res.events).toEqual([]);
    expect(res.stillRendered).toBe(true);   // the preview is not a live card
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
