import { test, expect } from '@playwright/test';

// Admin → Traffic → "First load": runs the real renderAdminTraffic() against a
// stubbed data layer, so the wiring is what's covered — the fifth RPC in the
// batch, its result reaching firstLoadCardHtml(), and the tab surviving the RPC
// failing (older DB, network) without losing its other cards.
const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';
const DAYS = [
  { day: '2026-09-18', loads: 42, users: 30, script_p50: 812, script_p90: 2440, cached_paint_p50: 1040, first_live_p50: 1611, first_live_p90: 4020, enriched_p50: 2100, enriched_p90: 5160, cached_pct: 71, early_pct: 64, optimistic_pct: 88, shell_cache_pct: 12, error_pct: 2 },
  { day: '2026-09-17', loads: 7, users: 6, script_p50: 900, script_p90: 1800, cached_paint_p50: null, first_live_p50: 1500, first_live_p90: 2500, enriched_p50: 2000, enriched_p90: 3100, cached_pct: 0, early_pct: 57, optimistic_pct: 100, shell_cache_pct: 0, error_pct: 0 },
];

async function renderTraffic(page, bootResult) {
  await page.goto('/');
  return page.evaluate(async ({ adminId, bootResult }) => {
    currentUser = { id: adminId };
    let host = document.getElementById('admin-traffic');
    if (!host) { host = document.createElement('div'); host.id = 'admin-traffic'; document.body.appendChild(host); }
    const calls = [];
    db.rpc = (name, args) => {
      calls.push({ name, args });
      if (name === 'admin_boot_timing_daily') return Promise.resolve(bootResult);
      if (name === 'admin_traffic_stats') return Promise.resolve({ data: { by_source: [], by_device_7d: [], daily: [], funnel: {}, signups: {}, signups_by_source: [] }, error: null });
      return Promise.resolve({ data: {}, error: null });
    };
    await renderAdminTraffic();
    return { html: host.innerHTML, calls };
  }, { adminId: ADMIN_ID, bootResult });
}

test('the Traffic tab shows the First load card from admin_boot_timing_daily', async ({ page }) => {
  const { html, calls } = await renderTraffic(page, { data: DAYS, error: null });
  expect(calls.find(c => c.name === 'admin_boot_timing_daily').args).toEqual({ p_days: 14 });
  expect(html).toContain('First load (last 2 days, UTC)');
  expect(html).toContain('>09-18<');
  expect(html).toContain('>42<');
  expect(html).toContain('>71%<');
});

test('a failing First load RPC leaves the rest of the tab intact', async ({ page }) => {
  const { html } = await renderTraffic(page, { data: null, error: { message: 'function does not exist' } });
  expect(html).not.toContain('First load');
  expect(html).not.toContain('Loading traffic');
  expect(html.length).toBeGreaterThan(50);
});
