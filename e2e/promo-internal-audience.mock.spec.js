import { test, expect } from '@playwright/test';

// internal_only audience: lets the owner activate a slot that renders ONLY
// for their own internal_accounts rows, so they can test end-to-end without
// showing it to real users. Unlike the other promo-*.mock.spec.js files,
// this drives the REAL loadPromoSlots() (not pre-seeded module state) so the
// internal_accounts membership lookup itself is exercised, not just the
// audience predicate.

const CFG = {
  enabled: true, first_position: 0, repeat_every: 0, max_per_session: 1,
  default_max_impressions: 3, suppress_after_modal: false,
};

const SLOT = {
  id: 'p1', heading: 'Internal test card', body: 'b', audience: 'internal_only',
  status: 'active', priority: 0, starts_at: null, ends_at: null,
  max_impressions: null, images: [], cta_label: 'Go', cta_action: 'open_wishlist',
  created_at: '2026-01-01T00:00:00Z',
};

// Fakes db.from() for the four queries loadPromoSlots() issues, close enough
// to the real Supabase chain shape to drive the actual client code — the
// point of this test is the internal_accounts lookup, not pre-seeded state.
async function stubDb(page, { isInternal }) {
  await page.evaluate(({ isInternal, CFG, SLOT }) => {
    db.from = (table) => {
      if (table === 'promo_config') {
        return { select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: CFG, error: null }) }) }) };
      }
      if (table === 'promo_slots') {
        return { select: () => ({ eq: async () => ({ data: [SLOT], error: null }) }) };
      }
      if (table === 'promo_events') {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      }
      if (table === 'internal_accounts') {
        // Mocked — never hits production. Mirrors the real RLS-backed query:
        // a row back only for a member, null otherwise.
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: isInternal ? { user_id: 'u1' } : null, error: null }),
            }),
          }),
        };
      }
      return { insert: async () => ({ error: null }) };
    };
  }, { isInternal, CFG, SLOT });
}

async function run(page, { isInternal }) {
  await page.goto('/');
  await stubDb(page, { isInternal });
  return page.evaluate(async () => {
    currentUser = { id: 'u1' };
    document.getElementById('auth-screen').style.display = 'none';
    await window.loadPromoSlots();
    document.getElementById('feed-list').innerHTML =
      '<div class="feed-card" id="feedcard-0">post 0</div>';
    window.injectPromoCards();
    return document.querySelectorAll('.promo-card').length;
  });
}

test.describe('internal_only audience (mocked)', () => {
  test('an internal_only slot renders for an internal user', async ({ page }) => {
    expect(await run(page, { isInternal: true })).toBe(1);
  });

  test('an internal_only slot does not render for a non-internal user', async ({ page }) => {
    expect(await run(page, { isInternal: false })).toBe(0);
  });
});
