import { test, expect } from '@playwright/test';

// Drives maybeShowFactModal directly with stubbed globals. The point is the
// gating and the CTA, not the sign-in path — which other specs already cover.
async function setup(page, { logs = [], alreadyShown = false, needsGeneration = false, overlayOpen = false } = {}) {
  await page.goto('/');
  // NOTE: currentUser/watches/logs/db/_isDemoMode are `let`/`const` bindings
  // declared at the top level of index.html's single classic <script> tag.
  // Top-level let/const in a classic script never become properties of
  // `window` (unlike top-level `var`/function declarations), so
  // `window.currentUser = ...` etc. would silently create unrelated
  // properties the app never reads — and `window.db.rpc = ...` throws
  // outright since `window.db` is undefined. All page.evaluate calls share
  // the page's global declarative environment though, so bare identifiers
  // (no `window.` prefix) resolve to the app's real bindings. The `logs`
  // param is renamed on the way in to avoid shadowing the bare global.
  await page.evaluate(({ logs: _logs, alreadyShown, needsGeneration, overlayOpen }) => {
    currentUser = { id: 'u1' };
    _isDemoMode = false;
    watches = [
      { id: 'w1', brand: 'Seiko', name: 'SKX007', createdAt: '2026-01-01' },
      { id: 'w2', brand: 'Rolex', name: 'Explorer', createdAt: '2026-02-01' },
    ];
    logs = _logs;
    localStorage.removeItem('wrotate_fact_modal_shown_u1');
    if (alreadyShown) localStorage.setItem('wrotate_fact_modal_shown_u1', '1');

    window.__rpcCalls = [];
    db.rpc = async (name, args) => {
      window.__rpcCalls.push({ name, args });
      if (name === 'peek_watch_fact') {
        return needsGeneration
          ? { data: { fact_id: null, fact: null, needs_generation: true }, error: null }
          : { data: { fact_id: 'f1', fact: 'A genuinely interesting fact about this watch.', needs_generation: false }, error: null };
      }
      return { data: null, error: null };
    };

    window.__trackOpened = null;
    // openTrackModal is a top-level *function declaration*, which — unlike
    // let/const — does become a `window` property, so this override reaches
    // the real global that factModalLogNow() calls.
    window.openTrackModal = (id) => { window.__trackOpened = id; };

    // These tests drive maybeShowFactModal() directly instead of going
    // through a real sign-in (that path is covered elsewhere), so the
    // landing page's #auth-screen is never dismissed the way login does it
    // (style.display = 'none'). It still sits over the app underneath and
    // intercepts pointer events for the click-driven tests below, even
    // though it plays no part in the gating logic under test.
    document.getElementById('auth-screen').style.display = 'none';

    if (overlayOpen) document.getElementById('whats-new-modal').classList.remove('hidden');
  }, { logs, alreadyShown, needsGeneration, overlayOpen });
}

const visible = (page) => page.evaluate(() =>
  !document.getElementById('fact-modal').classList.contains('hidden'));

test.describe('Login fun-fact modal (mocked)', () => {
  test('appears for an eligible user, featuring the most recently added watch', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(true);
    // No wears at all → falls back to newest added (w2, the Rolex).
    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === 'peek_watch_fact'));
    expect(call.args).toEqual({ p_brand: 'Rolex', p_name: 'Explorer' });
    await expect(page.locator('#fact-modal-eyebrow')).toContainText('Rolex Explorer');
    await expect(page.locator('#fact-modal-card')).toContainText('A genuinely interesting fact');
  });

  test('features the most-worn watch when wears exist', async ({ page }) => {
    await setup(page, { logs: [
      { watchId: 'w1', date: '2020-01-01', useCase: 'unspecified' },
      { watchId: 'w1', date: '2020-01-02', useCase: 'unspecified' },
      { watchId: 'w2', date: '2020-01-03', useCase: 'unspecified' },
    ] });
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === 'peek_watch_fact'));
    expect(call.args).toEqual({ p_brand: 'Seiko', p_name: 'SKX007' });
  });

  test('does not appear when another overlay is already open', async ({ page }) => {
    await setup(page, { overlayOpen: true });
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(false);
    // And it stays eligible — the once-ever key must not have been written.
    expect(await page.evaluate(() => localStorage.getItem('wrotate_fact_modal_shown_u1'))).toBe(null);
  });

  test('does not appear once already shown', async ({ page }) => {
    await setup(page, { alreadyShown: true });
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(false);
  });

  test('does not appear for someone who already logged a wear today', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      logs = [{ watchId: 'w1', date: todayStr(), useCase: 'unspecified' }];
    });
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(false);
  });

  test('skips silently rather than showing a spinner when no fact is ready', async ({ page }) => {
    await setup(page, { needsGeneration: true });
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(false);
    // Stays eligible for a later session once the pool is warm.
    expect(await page.evaluate(() => localStorage.getItem('wrotate_fact_modal_shown_u1'))).toBe(null);
  });

  test('"Log this watch" opens the track modal for that watch', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    await page.click('#fact-modal button.btn-primary');
    expect(await page.evaluate(() => window.__trackOpened)).toBe('w2');
    expect(await visible(page)).toBe(false);
  });

  test('"Maybe later" closes it and it does not return', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    await page.click('#fact-modal button.btn-ghost');
    expect(await visible(page)).toBe(false);
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(false);
  });
});
