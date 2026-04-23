// ── AF2 (Add Flow V2) UAT — Real Browser + Real Supabase ─────────────────
// Tests the full AF2 flow: detect → identify → confirm → enhance → price
// Uses testuser (test@wrotate.com) with real API calls to identify-watch edge function.
//
// Run: npx playwright test e2e/af2-uat.int.spec.js --project=integration
//
// FIXTURES:
//   e2e/fixtures/IMG_4155.jpeg — single watch (wrist shot)
//   e2e/fixtures/IMG_4174.jpeg — 12-watch collection box
//
// CLEANUP: all watches added during tests are deleted in afterEach.

import { test, expect } from '@playwright/test';
import path from 'path';

const SINGLE_WATCH = path.resolve('e2e/fixtures/IMG_4155.jpeg');
const MULTI_WATCH = path.resolve('e2e/fixtures/IMG_4174.jpeg');

// Track watch IDs added during tests for cleanup
let addedWatchIds = [];

test.beforeEach(async ({ page }) => {
  const response = await page.goto('/dev-config.js');
  if (!response || response.status() !== 200) {
    test.skip(true, 'dev-config.js not found — integration tests require local dev setup');
  }
  addedWatchIds = [];
});

async function devLogin(page) {
  await page.goto('/');
  // On localhost, dev-login buttons may not be visible — log in via Supabase directly
  const hasDevLogin = await page.locator('#dev-login-wrap button:first-child').isVisible({ timeout: 3_000 }).catch(() => false);
  if (hasDevLogin) {
    await page.click('#dev-login-wrap button:first-child');
  } else {
    // Log in programmatically
    await page.evaluate(async () => {
      await db.auth.signInWithPassword({ email: 'test@wrotate.com', password: 'wrotate-test-2026' });
      location.reload();
    });
  }
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 15_000 });
  await page.waitForSelector('nav', { state: 'visible', timeout: 10_000 });
}

async function dismissModals(page) {
  // Dismiss "What's New" or any blocking modal
  const gotItBtn = page.locator('button:has-text("Got it")');
  if (await gotItBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await gotItBtn.click();
    await page.waitForTimeout(300);
  }
}

async function navigateToCollection(page) {
  await dismissModals(page);
  await page.click('nav button[data-page="collection"]');
  await page.waitForTimeout(500);
}

async function triggerAF2WithFile(page, filePath) {
  const fs = await import('fs');
  const imageBuffer = fs.readFileSync(filePath);
  const base64 = imageBuffer.toString('base64');
  const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  // Create a File object in browser context and call af2StartWithFile
  // This goes through the proper resize pipeline (blobToResizedBase64ForIdentify)
  page.evaluate(async ({ b64, mime }) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'test-photo.jpg', { type: mime });
    await af2StartWithFile(file);
  }, { b64: base64, mime: mimeType }).catch(e =>
    console.error('[triggerAF2] evaluate error:', e.message));
}

async function waitForSheet(page) {
  await page.waitForSelector('#af2-sheet:not(.hidden)', { timeout: 15_000 });
}

async function waitForIdentified(page, timeoutMs = 120_000) {
  // Wait until no rows are in 'waiting' or 'identifying' state
  await page.waitForFunction(() => {
    return typeof _af2Watches !== 'undefined'
      && _af2Watches.length > 0
      && _af2Watches.every(w => !['waiting', 'identifying'].includes(w._af2State)
        || w._af2State === 'skipped');
  }, { timeout: timeoutMs });
}

async function getWatchStates(page) {
  return page.evaluate(() => _af2Watches.map(w => ({
    state: w._af2State,
    brand: w.brand || 'Unknown',
    model: w.model || 'Unknown',
    ref: w.reference || '',
  })));
}

async function getWatchCount(page) {
  return page.evaluate(() => _af2Watches.length);
}

async function cleanupAddedWatches(page) {
  if (addedWatchIds.length === 0) return;
  await page.evaluate(async (ids) => {
    for (const id of ids) {
      const idx = watches.findIndex(w => w.id === id);
      if (idx >= 0) watches.splice(idx, 1);
      await db.from('watches').delete().eq('id', id);
    }
    save();
  }, addedWatchIds);
}

test.afterEach(async ({ page }) => {
  try { await cleanupAddedWatches(page); } catch (_) {}
});

// ═══════════════════════════════════════════════════════════════════════════
//  1. SINGLE WATCH — FULL HAPPY PATH
// ═══════════════════════════════════════════════════════════════════════════

test.describe('1. Single watch — full flow', () => {
  test('detect → identify → confirm → enhance → price → done', async ({ page }) => {
    test.setTimeout(180_000);
    await devLogin(page);
    await dismissModals(page);
    await navigateToCollection(page);

    // Snapshot watch IDs before
    const beforeIds = await page.evaluate(() => watches.map(w => w.id));
    const beforeCount = beforeIds.length;

    // Trigger AF2 with single watch image
    await triggerAF2WithFile(page, SINGLE_WATCH);
    await waitForSheet(page);

    // Should show "Scanning photo…" initially
    const sheetVisible = await page.isVisible('#af2-sheet:not(.hidden)');
    expect(sheetVisible).toBe(true);

    // Wait for crops to appear (all watches in 'waiting' state with crops)
    await page.waitForFunction(() =>
      typeof _af2Watches !== 'undefined'
      && _af2Watches.length >= 1
      && _af2Watches.every(w => w._af2State !== undefined),
    { timeout: 30_000 });

    const watchCount = await getWatchCount(page);
    console.log(`  → Detected ${watchCount} watch(es) in single photo`);
    expect(watchCount).toBeGreaterThanOrEqual(1);

    // Wait for identification to complete
    await waitForIdentified(page);
    const states = await getWatchStates(page);
    console.log('  → Identification results:', JSON.stringify(states, null, 2));

    // At least one should be identified (not failed)
    const identified = states.filter(s => s.state === 'identified');
    expect(identified.length).toBeGreaterThanOrEqual(1);

    // Verify row shows brand/model/ref
    const firstIdentified = identified[0];
    expect(firstIdentified.brand).not.toBe('Unknown');
    console.log(`  → Identified: ${firstIdentified.brand} ${firstIdentified.model}`);

    // Verify Confirm and Edit buttons are visible
    await expect(page.locator('.af2-btn-confirm').first()).toBeVisible();
    await expect(page.locator('.af2-btn-edit').first()).toBeVisible();

    // Click Confirm on the first identified watch
    await page.click('.af2-btn-confirm');

    // Should transition to 'confirmed' then 'enhancing'
    await page.waitForFunction(() =>
      _af2Watches.some(w => w._af2State === 'confirmed' || w._af2State === 'enhancing'),
    { timeout: 10_000 });
    console.log('  → Watch confirmed, enhancing...');

    // Wait for watch ID to be set (DB upsert may take a moment)
    await page.waitForFunction(() =>
      _af2Watches.some(w => w._af2WatchId), { timeout: 15_000 });

    // Wait for enhance to complete
    await page.waitForFunction(() =>
      _af2Watches.some(w => ['enhanced', 'pricing', 'done'].includes(w._af2State)),
    { timeout: 60_000 });

    // Check enhance fields were found
    const enhanceFields = await page.evaluate(() => {
      const w = _af2Watches.find(w => w._af2EnhanceFields);
      return w?._af2EnhanceFields || [];
    });
    console.log(`  → Enhanced with ${enhanceFields.length} fields:`, enhanceFields.slice(0, 5));

    // Wait for done state (price or skip price)
    await page.waitForFunction(() =>
      _af2Watches.some(w => w._af2State === 'done'),
    { timeout: 60_000 });
    console.log('  → Flow complete (done state reached)');

    // Verify watch was added to collection by comparing before/after IDs
    const afterIds = await page.evaluate(() => watches.map(w => w.id));
    expect(afterIds.length).toBe(beforeCount + 1);
    console.log(`  → Collection: ${beforeCount} → ${afterIds.length} watches`);

    const newIds = afterIds.filter(id => !beforeIds.includes(id));
    expect(newIds.length).toBe(1);
    const newId = newIds[0];
    addedWatchIds.push(newId);

    const savedWatch = await page.evaluate((id) => {
      const w = watches.find(w => w.id === id);
      return w ? { id: w.id, brand: w.brand, name: w.name } : null;
    }, newId);
    expect(savedWatch).not.toBeNull();
    console.log(`  → Verified in collection: ${savedWatch.brand} ${savedWatch.name} (${savedWatch.id})`);

    // Footer should show "See details" + "Add another" for single watch
    await expect(page.locator('#af2-footer button:has-text("See details")')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#af2-footer button:has-text("Add another")')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. MULTI WATCH — DETECT MULTIPLE, CONFIRM SOME, SKIP SOME
// ═══════════════════════════════════════════════════════════════════════════

test.describe('2. Multi watch — selective confirm/skip', () => {
  test('detect multiple watches, skip some, confirm rest', async ({ page }) => {
    test.setTimeout(600_000);
    await devLogin(page);
    await dismissModals(page);
    await navigateToCollection(page);

    const beforeCount = await page.evaluate(() => watches.length);

    await triggerAF2WithFile(page, MULTI_WATCH);
    await waitForSheet(page);

    // Wait for detection — accept any count >= 1
    await page.waitForFunction(() =>
      typeof _af2Watches !== 'undefined' && _af2Watches.length >= 1
      && _af2Watches.every(w => w._af2State !== undefined),
    { timeout: 60_000 });

    const detected = await getWatchCount(page);
    console.log(`  → Detected ${detected} watches in collection photo`);

    if (detected < 2) {
      console.log('  → Need ≥2 watches for multi-watch test, skipping');
      test.skip(true, 'Detect API returned fewer than 2 watches from multi-watch image');
      return;
    }

    // All should start in 'waiting' or 'identifying'
    const initialStates = await page.evaluate(() =>
      _af2Watches.map(w => ({ state: w._af2State, hasCrop: !!w._croppedUrl }))
    );
    console.log('  → Initial states:', JSON.stringify(initialStates));

    // Wait for all identification to complete
    await waitForIdentified(page, 300_000);
    const states = await getWatchStates(page);
    console.log('  → All identified:', JSON.stringify(states.map(s => `${s.brand} ${s.model} [${s.state}]`)));

    const identifiedCount = states.filter(s => s.state === 'identified').length;
    console.log(`  → ${identifiedCount} identified, ${states.filter(s => s.state === 'failed').length} failed`);

    // Skip the first identified watch
    const skipButtons = page.locator('.af2-btn-skip');
    if (await skipButtons.count() > 0) {
      await skipButtons.first().click();
      console.log('  → Skipped first watch');
    }

    // Verify skip state + undo timer
    const skippedState = await page.evaluate(() => {
      const s = _af2Watches.find(w => w._af2State === 'skipped');
      return s ? { state: s.state, hasUndo: !!s._af2UndoTimer } : null;
    });
    if (skippedState) {
      expect(skippedState.state).toBe('skipped');
      expect(skippedState.hasUndo).toBe(true);
      console.log('  → Skip confirmed with undo timer');
    }

    // If there's a "Confirm all" button, use it for remaining
    const confirmAllBtn = page.locator('button:has-text("Confirm all")');
    if (await confirmAllBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmAllBtn.click();
      console.log('  → Clicked Confirm all');
    } else {
      const confirmBtns = page.locator('.af2-btn-confirm');
      const count = await confirmBtns.count();
      for (let i = 0; i < Math.min(count, 3); i++) {
        await confirmBtns.first().click();
        await page.waitForTimeout(500);
      }
      console.log('  → Confirmed watches individually');
    }

    // Wait for all to reach done/skipped
    await page.waitForFunction(() =>
      _af2Watches.every(w => ['done', 'skipped', 'failed'].includes(w._af2State)),
    { timeout: 180_000 });

    // Track added watch IDs for cleanup
    const newIds = await page.evaluate(() =>
      _af2Watches.filter(w => w._af2WatchId).map(w => w._af2WatchId)
    );
    addedWatchIds.push(...newIds);
    console.log(`  → All done: ${newIds.length} added, cleaning up`);

    // Verify footer
    const doneCount = await page.evaluate(() =>
      _af2Watches.filter(w => w._af2State === 'done' && w._af2WatchId).length);
    if (doneCount > 1) {
      await expect(page.locator('button:has-text("View collection")')).toBeVisible({ timeout: 5_000 });
    } else if (doneCount === 1) {
      await expect(page.locator('button:has-text("See details")')).toBeVisible({ timeout: 5_000 });
    }

    const afterCount = await page.evaluate(() => watches.length);
    console.log(`  → Collection: ${beforeCount} → ${afterCount} watches (+${afterCount - beforeCount})`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. SKIP DURING IDENTIFICATION — Promise.race unblocking
// ═══════════════════════════════════════════════════════════════════════════

test.describe('3. Skip during identification', () => {
  test('skip a watch mid-identify, loop exits without waiting for API', async ({ page }) => {
    test.setTimeout(180_000);
    await devLogin(page);
    await dismissModals(page);
    await navigateToCollection(page);

    await triggerAF2WithFile(page, SINGLE_WATCH);
    await waitForSheet(page);

    // Wait for the watch to enter 'identifying' state
    await page.waitForFunction(() =>
      typeof _af2Watches !== 'undefined'
      && _af2Watches.some(w => w._af2State === 'identifying'),
    { timeout: 30_000 });

    console.log('  → Watch is identifying, clicking skip...');
    const skipStartMs = Date.now();

    // Skip it mid-flight
    await page.locator('.af2-btn-skip').first().click();

    // Verify it's now skipped
    const wasSkipped = await page.evaluate(() =>
      _af2Watches[0]._af2State === 'skipped');
    expect(wasSkipped).toBe(true);
    console.log('  → Watch skipped successfully');

    // The identify loop should exit within 2s (Promise.race unblocks immediately)
    // — if it were waiting for the API, it would take 10-30s
    await page.waitForFunction(() =>
      _af2Watches.every(w => !['waiting', 'identifying'].includes(w._af2State)),
    { timeout: 5_000 });
    const skipElapsedMs = Date.now() - skipStartMs;
    console.log(`  → Loop exited in ${skipElapsedMs}ms after skip`);
    expect(skipElapsedMs).toBeLessThan(5_000);

    // Wait a moment to make sure nothing overwrites the skipped state
    await page.waitForTimeout(3_000);
    const stillSkipped = await page.evaluate(() =>
      _af2Watches[0]._af2State === 'skipped');
    expect(stillSkipped).toBe(true);
    console.log('  → Skipped state persisted after 3s wait ✓');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. SKIP ALL WAITING — skip everything before identification
// ═══════════════════════════════════════════════════════════════════════════

test.describe('4. Skip from waiting state', () => {
  test('skip watches before they start identifying', async ({ page }) => {
    test.setTimeout(180_000);
    await devLogin(page);
    await dismissModals(page);
    await navigateToCollection(page);

    await triggerAF2WithFile(page, MULTI_WATCH);
    await waitForSheet(page);

    // Wait for detection
    await page.waitForFunction(() =>
      typeof _af2Watches !== 'undefined'
      && _af2Watches.length >= 1
      && _af2Watches.every(w => w._af2State !== undefined),
    { timeout: 60_000 });

    const detected = await getWatchCount(page);
    console.log(`  → Detected ${detected} watches`);

    if (detected < 2) {
      console.log('  → Need ≥2 watches to test skip-from-waiting, skipping');
      test.skip(true, 'Detect API returned fewer than 2 watches');
      return;
    }

    // Find a watch in 'waiting' state (not the one currently identifying)
    const waitingIdx = await page.evaluate(() =>
      _af2Watches.findIndex(w => w._af2State === 'waiting'));

    if (waitingIdx < 0) {
      console.log('  → No watches in waiting state (all already identifying), skipping');
      test.skip(true, 'No watches in waiting state');
      return;
    }

    await page.evaluate((idx) => af2Skip(idx), waitingIdx);
    const skipped = await page.evaluate((idx) =>
      _af2Watches[idx]._af2State, waitingIdx);
    expect(skipped).toBe('skipped');
    console.log(`  → Skipped waiting watch ${waitingIdx}`);

    // Verify it shows crop in gray
    const row = page.locator('.af2-row').nth(waitingIdx);
    await expect(row).toHaveClass(/af2-skipped/);
    console.log('  → Skipped row has af2-skipped class ✓');

    // Wait for identification to finish
    await waitForIdentified(page, 180_000);

    const stillSkipped = await page.evaluate((idx) =>
      _af2Watches[idx]._af2State === 'skipped', waitingIdx);
    expect(stillSkipped).toBe(true);
    console.log('  → Pre-skipped watch was never identified ✓');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. EDIT BEFORE CONFIRM — modify brand/model
// ═══════════════════════════════════════════════════════════════════════════

test.describe('5. Edit before confirm', () => {
  test('edit brand/model, then confirm saves correct data', async ({ page }) => {
    test.setTimeout(180_000);
    await devLogin(page);
    await dismissModals(page);
    await navigateToCollection(page);

    await triggerAF2WithFile(page, SINGLE_WATCH);
    await waitForSheet(page);
    await waitForIdentified(page);

    const states = await getWatchStates(page);
    const identifiedIdx = states.findIndex(s => s.state === 'identified');
    if (identifiedIdx < 0) {
      console.log('  → No watches identified, skipping edit test');
      test.skip(true, 'No watches identified');
      return;
    }

    console.log(`  → Editing watch ${identifiedIdx}: ${states[identifiedIdx].brand} ${states[identifiedIdx].model}`);

    // Click Edit
    await page.locator('.af2-btn-edit').first().click();

    // Wait for edit form to appear
    await page.waitForSelector('#af2-sheet input', { timeout: 5_000 });

    // Get the brand input and change it
    const brandInput = page.locator('#af2-sheet input').first();
    await brandInput.clear();
    await brandInput.fill('TestBrand');

    // Get model input and change it
    const modelInput = page.locator('#af2-sheet input').nth(1);
    await modelInput.clear();
    await modelInput.fill('TestModel');

    // Click Save/Done
    const saveBtn = page.locator('#af2-sheet button:has-text("Save"), #af2-sheet button:has-text("Done")').first();
    await saveBtn.click();

    // Verify the watch now shows edited values
    const editedState = await page.evaluate((idx) => ({
      brand: _af2Watches[idx].brand,
      model: _af2Watches[idx].model,
    }), identifiedIdx);
    expect(editedState.brand).toBe('TestBrand');
    expect(editedState.model).toBe('TestModel');
    console.log(`  → Edited to: ${editedState.brand} ${editedState.model} ✓`);

    // Confirm the edited watch
    await page.locator('.af2-btn-confirm').first().click();
    await page.waitForFunction(() =>
      _af2Watches.some(w => w._af2State === 'confirmed' || w._af2State === 'enhancing'),
    { timeout: 10_000 });

    // Track for cleanup
    const newId = await page.evaluate(() => {
      const w = _af2Watches.find(w => w._af2WatchId);
      return w?._af2WatchId;
    });
    if (newId) addedWatchIds.push(newId);

    // Verify saved with edited values in memory
    await page.waitForTimeout(2_000);
    if (newId) {
      const memWatch = await page.evaluate((id) => {
        const w = watches.find(w => w.id === id);
        return w ? { brand: w.brand, name: w.name } : null;
      }, newId);
      expect(memWatch).not.toBeNull();
      expect(memWatch.brand).toBe('TestBrand');
      expect(memWatch.name).toBe('TestModel');
      console.log(`  → Verified: ${memWatch.brand} ${memWatch.name} ✓`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  6. UNDO SKIP
// ═══════════════════════════════════════════════════════════════════════════

test.describe('6. Undo skip', () => {
  test('skip a watch, then undo returns it to identified', async ({ page }) => {
    test.setTimeout(180_000);
    await devLogin(page);
    await dismissModals(page);
    await navigateToCollection(page);

    await triggerAF2WithFile(page, SINGLE_WATCH);
    await waitForSheet(page);
    await waitForIdentified(page);

    const states = await getWatchStates(page);
    const identifiedIdx = states.findIndex(s => s.state === 'identified');
    if (identifiedIdx < 0) { test.skip(true, 'No identified watches'); return; }

    // Skip it
    await page.locator('.af2-btn-skip').first().click();
    const afterSkip = await page.evaluate((idx) => _af2Watches[idx]._af2State, identifiedIdx);
    expect(afterSkip).toBe('skipped');
    console.log('  → Skipped ✓');

    // Undo should be visible
    const undoBtn = page.locator('.af2-btn-undo');
    await expect(undoBtn).toBeVisible({ timeout: 2_000 });

    // Click undo
    await undoBtn.click();
    const afterUndo = await page.evaluate((idx) => _af2Watches[idx]._af2State, identifiedIdx);
    expect(afterUndo).toBe('identified');
    console.log('  → Undo restored to identified ✓');

    // Confirm/Edit buttons should be back
    await expect(page.locator('.af2-btn-confirm').first()).toBeVisible();
    console.log('  → Confirm button visible after undo ✓');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  7. DB SAVE INTEGRITY — functions stored as array, enhance fields persist
// ═══════════════════════════════════════════════════════════════════════════

test.describe('7. DB save integrity', () => {
  test('enhanced watch saves all fields to DB including functions as array', async ({ page }) => {
    test.setTimeout(180_000);
    await devLogin(page);
    await dismissModals(page);
    await navigateToCollection(page);

    await triggerAF2WithFile(page, SINGLE_WATCH);
    await waitForSheet(page);
    await waitForIdentified(page);

    // Confirm the first identified watch
    const confirmBtn = page.locator('.af2-btn-confirm');
    if (await confirmBtn.count() === 0) { test.skip(true, 'No watches to confirm'); return; }
    await confirmBtn.first().click();

    // Wait for enhance + price to complete (done state)
    await page.waitForFunction(() =>
      _af2Watches.some(w => w._af2State === 'done'),
    { timeout: 120_000 });

    const watchId = await page.evaluate(() =>
      _af2Watches.find(w => w._af2State === 'done')?._af2WatchId);
    if (watchId) addedWatchIds.push(watchId);

    // Check the in-memory watch object (mirrors what was upserted to DB)
    const watchData = await page.evaluate((id) => {
      const w = watches.find(w => w.id === id);
      if (!w) return null;
      return {
        brand: w.brand, name: w.name, ref: w.ref,
        movementType: w.movementType, caseMaterial: w.caseMaterial,
        caseDiameter: w.caseDiameter, functions: w.functions,
        functionsType: Array.isArray(w.functions) ? 'array' : typeof w.functions,
      };
    }, watchId);

    expect(watchData).not.toBeNull();
    console.log('  → Watch data found');
    console.log(`    brand: ${watchData.brand}`);
    console.log(`    name: ${watchData.name}`);
    console.log(`    ref: ${watchData.ref}`);
    console.log(`    movementType: ${watchData.movementType}`);
    console.log(`    caseMaterial: ${watchData.caseMaterial}`);
    console.log(`    caseDiameter: ${watchData.caseDiameter}`);
    console.log(`    functions: ${JSON.stringify(watchData.functions)} (type: ${watchData.functionsType})`);

    // Functions should be an array (not a string)
    if (watchData.functions) {
      expect(watchData.functionsType).toBe('array');
      console.log('  → functions is array ✓');
    }

    // Basic fields should be populated
    expect(watchData.brand).toBeTruthy();
    expect(watchData.name).toBeTruthy();
    console.log('  → Save integrity verified ✓');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  8. ENHANCE FIELD DISPLAY — shows actual values, not labels
// ═══════════════════════════════════════════════════════════════════════════

test.describe('8. Enhance field display', () => {
  test('enhanced state shows actual field values in the row', async ({ page }) => {
    test.setTimeout(180_000);
    await devLogin(page);
    await dismissModals(page);
    await navigateToCollection(page);

    await triggerAF2WithFile(page, SINGLE_WATCH);
    await waitForSheet(page);
    await waitForIdentified(page);

    const confirmBtn = page.locator('.af2-btn-confirm');
    if (await confirmBtn.count() === 0) { test.skip(true, 'No watches to confirm'); return; }
    await confirmBtn.first().click();

    // Wait for enhanced state (after enhance completes)
    await page.waitForFunction(() =>
      _af2Watches.some(w => ['enhanced', 'pricing', 'done'].includes(w._af2State)),
    { timeout: 120_000 });

    const enhanceFields = await page.evaluate(() => {
      const w = _af2Watches.find(w => w._af2EnhanceFields);
      return w?._af2EnhanceFields || [];
    });
    console.log(`  → Enhance fields (${enhanceFields.length}):`, enhanceFields);

    // Should show actual values (not labels like "case_material")
    if (enhanceFields.length > 0) {
      const hasLabel = enhanceFields.some(f =>
        ['case_material', 'movement_type', 'caliber', 'functions'].includes(f));
      expect(hasLabel).toBe(false);
      console.log('  → Fields show actual values, not labels ✓');
    }

    // Track for cleanup
    const watchId = await page.evaluate(() =>
      _af2Watches.find(w => w._af2WatchId)?._af2WatchId);
    if (watchId) addedWatchIds.push(watchId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  9. SHEET CLOSE + COLLECTION REFRESH
// ═══════════════════════════════════════════════════════════════════════════

test.describe('9. Sheet close + collection refresh', () => {
  test('closing sheet after done refreshes collection view', async ({ page }) => {
    test.setTimeout(180_000);
    await devLogin(page);
    await dismissModals(page);
    await navigateToCollection(page);

    const beforeCount = await page.evaluate(() => watches.length);

    await triggerAF2WithFile(page, SINGLE_WATCH);
    await waitForSheet(page);
    await waitForIdentified(page);

    // Confirm
    const confirmBtn = page.locator('.af2-btn-confirm');
    if (await confirmBtn.count() === 0) { test.skip(true, 'No watches to confirm'); return; }
    await confirmBtn.first().click();

    // Wait for done
    await page.waitForFunction(() =>
      _af2Watches.some(w => w._af2State === 'done'),
    { timeout: 120_000 });

    const watchId = await page.evaluate(() =>
      _af2Watches.find(w => w._af2State === 'done')?._af2WatchId);
    if (watchId) addedWatchIds.push(watchId);

    // Click "See details" or "View collection"
    const seeDetailsBtn = page.locator('button:has-text("See details")');
    const viewCollBtn = page.locator('button:has-text("View collection")');

    if (await seeDetailsBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await seeDetailsBtn.click();
      console.log('  → Clicked "See details"');
      // Edit/detail modal should open
      await page.waitForSelector('.overlay:not(.hidden)', { timeout: 5_000 });
      console.log('  → Edit modal opened ✓');
    } else if (await viewCollBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await viewCollBtn.click();
      console.log('  → Clicked "View collection"');
    }

    // Sheet should be closed
    await page.waitForFunction(() =>
      document.getElementById('af2-sheet')?.classList.contains('hidden'), { timeout: 5_000 });
    console.log('  → AF2 sheet closed ✓');

    // Collection should reflect new watch
    const afterCount = await page.evaluate(() => watches.length);
    expect(afterCount).toBe(beforeCount + 1);
    console.log(`  → Collection updated: ${beforeCount} → ${afterCount} ✓`);
  });
});
