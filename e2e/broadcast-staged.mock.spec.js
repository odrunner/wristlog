import { test, expect } from '@playwright/test';

// Staged broadcast sends: queue a first batch, read its metrics, release or cancel.
// SQL: sql/2026-08-07-staged-broadcast-sends.sql

const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';

// Labels are admin-authored subject lines and routinely contain an apostrophe.
// Using one throughout is deliberate: it's the character an inline onclick
// would break on, so every delegated handler here is exercised against it.
const LABEL = "Your watches miss you — here's a fun fact";

const asAdmin = async (page) => {
  await page.goto('/');
  await page.evaluate((id) => { currentUser = { id }; }, ADMIN_ID);
};

// Renders the In Flight list from a canned queue-status payload. The top-level
// totals are summed from the breakdown unless overridden — all-zero totals hit
// the "nothing queued" early return and the list never renders at all.
async function renderQueue(page, breakdown, totals = {}) {
  const sum = (k) => breakdown.reduce((n, b) => n + (Number(b[k]) || 0), 0);
  const derived = {
    pending: sum('pending'), held: sum('held'), sent: sum('sent'),
    failed: sum('failed'), used_today: 0, sent_today: sum('sent_today'),
  };
  return page.evaluate(async ({ breakdown, totals }) => {
    db.rpc = async (name) => {
      if (name === 'admin_broadcast_queue_status') {
        return { data: { ...totals, breakdown }, error: null };
      }
      return { data: null, error: null };
    };
    await window.renderBroadcastQueueStatus();
    return {
      list: document.getElementById('broadcast-sends-list').innerHTML,
      status: document.getElementById('broadcast-queue-status').innerHTML,
    };
  }, { breakdown, totals: { ...derived, ...totals } });
}

test.describe('staged broadcast — send dialog', () => {
  // Regression: these controls first shipped INSIDE the confirm step, so
  // nothing appeared until you had already committed to sending and there was
  // no way to find the batch size while deciding. They belong on the form.
  test('the batch controls are on the form before any send is started', async ({ page }) => {
    await asAdmin(page);
    const out = await page.evaluate(() => ({
      box: !!document.getElementById('broadcast-first-batch'),
      radios: document.querySelectorAll('input[name="bc-stage"]').length,
      inStatus: document.getElementById('broadcast-status').innerHTML.trim(),
    }));
    expect(out.box).toBe(true);
    expect(out.radios).toBe(2);
    // Present without the confirm step having run at all.
    expect(out.inStatus).toBe('');
  });

  test('the confirm step reports the plan and adds no second set of radios', async ({ page }) => {
    await asAdmin(page);
    const out = await page.evaluate(async () => {
      document.getElementById('broadcast-subject').value = 'S';
      document.getElementById('broadcast-body').value = 'B';
      document.getElementById('broadcast-first-batch').value = '25';
      await window.sendBroadcastAll();
      return {
        status: document.getElementById('broadcast-status').innerHTML,
        // Two radios total, i.e. only the ones on the form.
        radios: document.querySelectorAll('input[name="bc-stage"]').length,
        boxes: document.querySelectorAll('#broadcast-first-batch').length,
      };
    });
    expect(out.status).toContain('First batch of 25');
    expect(out.radios).toBe(2);
    expect(out.boxes).toBe(1);
  });

  test('the confirm step says so when there is no review step', async ({ page }) => {
    await asAdmin(page);
    const status = await page.evaluate(async () => {
      document.getElementById('broadcast-subject').value = 'S';
      document.getElementById('broadcast-body').value = 'B';
      const all = document.querySelector('input[name="bc-stage"][value="all"]');
      all.checked = true;
      all.dispatchEvent(new Event('change'));
      await window.sendBroadcastAll();
      return document.getElementById('broadcast-status').innerHTML;
    });
    expect(status).toContain('Everyone at once');
  });

  test('offers a staged first batch by default, with "everyone" one click away', async ({ page }) => {
    await asAdmin(page);
    const out = await page.evaluate(async () => {
      document.getElementById('broadcast-subject').value = 'S';
      document.getElementById('broadcast-body').value = 'B';
      await window.sendBroadcastAll();
      return {
        staged: document.querySelector('input[name="bc-stage"][value="batch"]').checked,
        batchValue: document.getElementById('broadcast-first-batch').value,
        firstBatch: window.selectedFirstBatch(),
      };
    });
    expect(out.staged).toBe(true);
    expect(out.batchValue).toBe('50');
    expect(out.firstBatch).toBe(50);
  });

  test('choosing "everyone" sends no first_batch at all', async ({ page }) => {
    await asAdmin(page);
    const out = await page.evaluate(async () => {
      document.getElementById('broadcast-subject').value = 'S';
      document.getElementById('broadcast-body').value = 'B';
      await window.sendBroadcastAll();
      const all = document.querySelector('input[name="bc-stage"][value="all"]');
      all.checked = true;
      all.dispatchEvent(new Event('change'));
      return {
        firstBatch: window.selectedFirstBatch(),
        boxDisabled: document.getElementById('broadcast-first-batch').disabled,
      };
    });
    // null, not 0 — the server treats "no staging" and "hold everything" very
    // differently, and 0 must never be sent as a batch size.
    expect(out.firstBatch).toBeNull();
    expect(out.boxDisabled).toBe(true);
  });

  test('a blank or junk batch size degrades to no staging, never to holding all', async ({ page }) => {
    await asAdmin(page);
    const out = await page.evaluate(async () => {
      document.getElementById('broadcast-subject').value = 'S';
      document.getElementById('broadcast-body').value = 'B';
      await window.sendBroadcastAll();
      const box = document.getElementById('broadcast-first-batch');
      const seen = [];
      for (const v of ['', '0', '-3', 'abc']) { box.value = v; seen.push(window.selectedFirstBatch()); }
      return seen;
    });
    expect(out).toEqual([null, null, null, null]);
  });
});

test.describe('staged broadcast — In Flight row', () => {
  const HELD_ROW = {
    label: LABEL, total: 412, pending: 0, held: 362, sent: 50, failed: 0,
    sent_today: 50, rank: 0, first_queued_at: '2026-08-07T10:00:00Z', last_sent: '2026-08-07T10:05:00Z',
  };

  test('a campaign with only held rows reads "held for review", not failed', async ({ page }) => {
    await asAdmin(page);
    const { list } = await renderQueue(page, [HELD_ROW]);
    expect(list).toContain('held for review');
    expect(list).not.toContain('failed');
    expect(list).toContain('362 held');
    expect(list).toContain('50 of 412 sent');
  });

  test('the label is escaped, not executed', async ({ page }) => {
    await asAdmin(page);
    const { list } = await renderQueue(page, [
      { ...HELD_ROW, label: '<img src=x onerror=alert(1)>' },
    ]);
    expect(list).not.toContain('<img src=x');
    expect(list).not.toContain('onerror=alert(1)>');
  });

  test('a campaign with no held rows shows no review gate', async ({ page }) => {
    await asAdmin(page);
    const { list } = await renderQueue(page, [
      { ...HELD_ROW, held: 0, pending: 362 },
    ]);
    expect(list).not.toContain('data-bc-gate');
    expect(list).toContain('sending next');
  });

  test('the quota line reports the real 500 limit, not the stale 100', async ({ page }) => {
    await asAdmin(page);
    const { status } = await renderQueue(page, [HELD_ROW], { used_today: 40, held: 362, sent: 50 });
    expect(status).toContain('40/500');
    // 500 - 40 used - 10 reserve
    expect(status).toContain('450 emails');
  });
});

test.describe('staged broadcast — the review gate', () => {
  const HELD_ROW = {
    label: LABEL, total: 412, pending: 0, held: 362, sent: 50, failed: 0,
    sent_today: 50, rank: 0, first_queued_at: '2026-08-07T10:00:00Z', last_sent: '2026-08-07T10:05:00Z',
  };

  // Renders the queue, clicks "Show batch results", returns the gate's markup
  // plus every RPC the page made.
  async function openGate(page, metrics) {
    return page.evaluate(async ({ breakdown, metrics }) => {
      window.__calls = [];
      db.rpc = async (name, args) => {
        window.__calls.push({ name, args });
        if (name === 'admin_broadcast_queue_status') {
          return { data: { pending: 0, held: 362, sent: 50, failed: 0, used_today: 0, sent_today: 50, breakdown }, error: null };
        }
        if (name === 'admin_broadcast_batch_metrics') return { data: metrics, error: null };
        return { data: null, error: null };
      };
      await window.renderBroadcastQueueStatus();
      document.querySelector('[data-bc-metrics]').click();
      await new Promise((r) => setTimeout(r, 100));
      return {
        gate: document.querySelector('[data-bc-gate]').innerHTML,
        calls: window.__calls,
      };
    }, { breakdown: [HELD_ROW], metrics });
  }

  test('shows delivered, opens and unsubscribes — and no click rate', async ({ page }) => {
    await asAdmin(page);
    const { gate, calls } = await openGate(page, {
      sent: 50, delivered: 48, opened: 22, opened_human: 12, unsubscribed: 1, bounced: 0, complained: 0,
    });
    expect(gate).toContain('48 delivered');
    // Human opens lead; the prefetch remainder is shown but does not drive the rate.
    expect(gate).toContain('12 opened (24%)');
    expect(gate).toContain('+10 prefetch');
    expect(gate).toContain('1 unsubscribed');
    // Click tracking is off; a 0% click rate would read as failure, not absence.
    expect(gate.toLowerCase()).not.toContain('click');
    // The label reached the RPC intact, apostrophe and em dash and all.
    const call = calls.find((c) => c.name === 'admin_broadcast_batch_metrics');
    expect(call.args.p_label).toBe(LABEL);
  });

  test('offers both ways out of the gate', async ({ page }) => {
    await asAdmin(page);
    const { gate } = await openGate(page, { sent: 50, delivered: 48, opened: 22, opened_human: 12, unsubscribed: 0, bounced: 0, complained: 0 });
    expect(gate).toContain('data-bc-release');
    expect(gate).toContain('data-bc-cancel');
  });

  test('surfaces spam complaints, which are the real stop signal', async ({ page }) => {
    await asAdmin(page);
    const { gate } = await openGate(page, {
      sent: 50, delivered: 50, opened: 30, opened_human: 18, unsubscribed: 3, bounced: 1, complained: 2,
    });
    expect(gate).toContain('2 spam complaints');
  });

  test('a zero-sent batch reports 0% rather than dividing by zero', async ({ page }) => {
    await asAdmin(page);
    const { gate } = await openGate(page, { sent: 0, delivered: 0, opened: 0, opened_human: 0, unsubscribed: 0, bounced: 0, complained: 0 });
    expect(gate).toContain('batch of 0');
    expect(gate).toContain('0 opened (0%)');
    expect(gate).not.toContain('NaN');
  });

  test('an RPC failure says so instead of rendering an empty gate', async ({ page }) => {
    await asAdmin(page);
    const gate = await page.evaluate(async ({ breakdown }) => {
      db.rpc = async (name) => {
        if (name === 'admin_broadcast_queue_status') {
          return { data: { pending: 0, held: 362, sent: 50, failed: 0, used_today: 0, sent_today: 50, breakdown }, error: null };
        }
        return { data: null, error: { message: 'boom' } };
      };
      await window.renderBroadcastQueueStatus();
      document.querySelector('[data-bc-metrics]').click();
      await new Promise((r) => setTimeout(r, 100));
      return document.querySelector('[data-bc-gate]').innerHTML;
    }, { breakdown: [HELD_ROW] });
    expect(gate).toContain('Could not load results');
    expect(gate).toContain('boom');
  });
});

test.describe('staged broadcast — release and cancel', () => {
  test('release flips the held rows and then actually drains', async ({ page }) => {
    await asAdmin(page);
    const out = await page.evaluate(async (label) => {
      const calls = [];
      db.rpc = async (name, args) => {
        calls.push({ name, args });
        if (name === 'admin_release_broadcast') return { data: { released: 362 }, error: null };
        return { data: { pending: 0, held: 0, sent: 0, failed: 0, used_today: 0, breakdown: [] }, error: null };
      };
      let drained = false;
      window.fetch = async () => { drained = true; return { ok: true, json: async () => ({ drained: 362, budget: 450 }) }; };
      toast = () => {};
      await window.releaseBroadcastRemainder(label);
      return { calls, drained };
    }, LABEL);

    const rel = out.calls.find((c) => c.name === 'admin_release_broadcast');
    expect(rel.args.p_label).toBe(LABEL);
    // The button says "Send remaining" — it must send, not wait for 21:30.
    expect(out.drained).toBe(true);
  });

  test('releasing nothing reports it rather than claiming a send', async ({ page }) => {
    await asAdmin(page);
    const out = await page.evaluate(async (label) => {
      const toasts = [];
      db.rpc = async (name) => {
        if (name === 'admin_release_broadcast') return { data: { released: 0 }, error: null };
        return { data: { pending: 0, held: 0, sent: 0, failed: 0, used_today: 0, breakdown: [] }, error: null };
      };
      let drained = false;
      window.fetch = async () => { drained = true; return { ok: true, json: async () => ({}) }; };
      toast = (m) => toasts.push(m);
      await window.releaseBroadcastRemainder(label);
      return { toasts, drained };
    }, LABEL);
    expect(out.toasts.join(' ')).toContain('Nothing held');
    expect(out.drained).toBe(false);
  });

  test('cancel deletes the remainder and never drains', async ({ page }) => {
    await asAdmin(page);
    const out = await page.evaluate(async (label) => {
      const calls = [];
      db.rpc = async (name, args) => {
        calls.push({ name, args });
        if (name === 'admin_cancel_broadcast') return { data: { cancelled: 362 }, error: null };
        return { data: { pending: 0, held: 0, sent: 0, failed: 0, used_today: 0, breakdown: [] }, error: null };
      };
      let drained = false;
      window.fetch = async () => { drained = true; return { ok: true, json: async () => ({}) }; };
      const toasts = [];
      toast = (m) => toasts.push(m);
      await window.cancelBroadcastRemainder(label);
      return { calls, drained, toasts };
    }, LABEL);

    const can = out.calls.find((c) => c.name === 'admin_cancel_broadcast');
    expect(can.args.p_label).toBe(LABEL);
    expect(out.drained).toBe(false);
    expect(out.toasts.join(' ')).toContain('362');
  });
});
