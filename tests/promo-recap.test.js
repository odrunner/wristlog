import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  monthRecap, promoSlotEpoch, eligiblePromoSlots,
  RECAP_WINDOW_DAYS, RECAP_MIN_WEARS, RECAP_MIN_WATCHES, RECAP_MIN_STREAK,
} from '../wrotate_test.js';

// "Your month in review" — the automated promo card.
// Spec: docs/superpowers/specs/2026-08-07-month-in-review-promo-design.md
//
// monthRecap() is the whole feature gate: returning null is what keeps the card
// out of the feed, so most of what matters here is WHEN it returns null.

const W = (id, extra = {}) => ({ id, name: 'N' + id, brand: 'B', color: '#c9a84c', ...extra });
const L = (watchId, date, extra = {}) => ({ watchId, date, useCase: 'work', ...extra });

// Local-time construction throughout: the window ("first week of the month")
// and the period boundary are both wall-clock ideas, so a UTC literal would
// make these tests pass or fail depending on the runner's timezone.
const at = (y, m, d, h = 12) => new Date(y, m, d, h).getTime();

// A July that clears both thresholds: 3 watches, 6 wear-days.
const JULY_WATCHES = [W('a'), W('b'), W('c')];
const JULY_LOGS = [
  L('a', '2026-07-01'), L('a', '2026-07-02'), L('a', '2026-07-03'),
  L('b', '2026-07-04'), L('b', '2026-07-05'),
  L('c', '2026-07-06'),
];
const july = (over = {}) => monthRecap({
  now: at(2026, 7, 3), logs: JULY_LOGS, watches: JULY_WATCHES, ...over,
});

describe('monthRecap — the window', () => {
  it('is open on the 1st', () => {
    expect(july({ now: at(2026, 7, 1) })).not.toBeNull();
  });

  it(`is open on the last day of the window (${RECAP_WINDOW_DAYS})`, () => {
    expect(july({ now: at(2026, 7, RECAP_WINDOW_DAYS) })).not.toBeNull();
  });

  // The window is what makes the card self-limiting — without it a July recap
  // would still be sitting in the feed at the end of August.
  it('is shut the day after the window closes', () => {
    expect(july({ now: at(2026, 7, RECAP_WINDOW_DAYS + 1) })).toBeNull();
  });

  it('is shut mid-month', () => {
    expect(july({ now: at(2026, 7, 20) })).toBeNull();
  });

  it('recaps the month that just ENDED, not the current one', () => {
    const r = july();
    expect(r.period).toBe('2026-07');
    expect(r.year).toBe(2026);
    expect(r.month).toBe(6);           // 0-11
  });

  // Off-by-one bait: January's previous month is December of the year before.
  it('rolls the year back on 1 January', () => {
    const logs = [
      L('a', '2025-12-01'), L('a', '2025-12-02'), L('a', '2025-12-03'),
      L('b', '2025-12-04'), L('b', '2025-12-05'),
    ];
    const r = monthRecap({ now: at(2026, 0, 2), logs, watches: JULY_WATCHES });
    expect(r.period).toBe('2025-12');
    expect(r.year).toBe(2025);
    expect(r.month).toBe(11);
  });

  it('reports windowStart as midnight on the 1st of the CURRENT month', () => {
    const r = july({ now: at(2026, 7, 5, 9) });
    expect(r.windowStart).toBe(new Date(2026, 7, 1).getTime());
  });
});

describe('monthRecap — the thresholds', () => {
  it(`shows at exactly ${RECAP_MIN_WEARS} wears`, () => {
    const logs = JULY_LOGS.slice(0, RECAP_MIN_WEARS);
    expect(monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES })).not.toBeNull();
  });

  it(`hides one wear below ${RECAP_MIN_WEARS}`, () => {
    const logs = JULY_LOGS.slice(0, RECAP_MIN_WEARS - 1);
    expect(monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES })).toBeNull();
  });

  // A month spent on one watch is a slide, not a story.
  it(`hides below ${RECAP_MIN_WATCHES} distinct watches, however many wears`, () => {
    const logs = ['01', '02', '03', '04', '05', '06', '07'].map((d) => L('a', '2026-07-' + d));
    expect(monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES })).toBeNull();
  });

  it('hides when the month is empty', () => {
    expect(monthRecap({ now: at(2026, 7, 3), logs: [], watches: JULY_WATCHES })).toBeNull();
  });

  it('survives null logs and watches', () => {
    expect(monthRecap({ now: at(2026, 7, 3), logs: null, watches: null })).toBeNull();
  });
});

describe('monthRecap — what counts as a wear', () => {
  // Same three rules as the Stats page's Monthly Review, which sits one tap
  // away and gets compared against this card.
  it('excludes measurement shares', () => {
    const logs = [...JULY_LOGS, L('a', '2026-07-20', { useCase: 'measurement' })];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.totalWears).toBe(6);
    expect(r.top.find((t) => t.watchId === 'a').count).toBe(3);
  });

  it('excludes logs for a watch no longer in the collection', () => {
    const logs = [...JULY_LOGS, L('gone', '2026-07-08'), L('gone', '2026-07-09')];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.totalWears).toBe(6);
    expect(r.uniqueCount).toBe(3);
  });

  it('counts one watch worn twice in a day once', () => {
    const logs = [...JULY_LOGS, L('a', '2026-07-01', { useCase: 'casual' })];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.totalWears).toBe(6);
  });

  it('ignores other months', () => {
    const logs = [...JULY_LOGS, L('a', '2026-06-01'), L('b', '2026-08-01')];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.totalWears).toBe(6);
  });
});

describe('monthRecap — the numbers on the slides', () => {
  it('reports the headline three', () => {
    const r = july();
    expect(r.totalWears).toBe(6);
    expect(r.wearDays).toBe(6);
    expect(r.uniqueCount).toBe(3);
  });

  it('ranks the top three by wear count, most-worn first', () => {
    const r = july();
    expect(r.top).toEqual([
      { watchId: 'a', count: 3 },
      { watchId: 'b', count: 2 },
      { watchId: 'c', count: 1 },
    ]);
  });

  it('caps the podium at three even with more watches worn', () => {
    const watches = [...JULY_WATCHES, W('d'), W('e')];
    const logs = [...JULY_LOGS, L('d', '2026-07-10'), L('e', '2026-07-11')];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches });
    expect(r.top).toHaveLength(3);
  });

  // The Stats card's tie-break is Object.keys() insertion order — arbitrary. A
  // pure function under test needs one that is not.
  it('breaks a tie on watchId, ascending', () => {
    const logs = [
      L('z', '2026-07-01'), L('z', '2026-07-02'),
      L('m', '2026-07-03'), L('m', '2026-07-04'),
      L('a', '2026-07-05'), L('a', '2026-07-06'),
    ];
    const watches = [W('z'), W('m'), W('a')];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches });
    expect(r.top.map((t) => t.watchId)).toEqual(['a', 'm', 'z']);
  });

  it('reports the top use case', () => {
    const logs = [...JULY_LOGS, L('c', '2026-07-10', { useCase: 'dive' }), L('c', '2026-07-11', { useCase: 'dive' })];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.topUC).toBe('work');
    expect(r.topUCWears).toBe(6);
  });

  it('reports the busiest weekday as a Sunday-first index', () => {
    // 2026-07-01 is a Wednesday; three more Wednesdays make it the winner.
    const logs = [
      L('a', '2026-07-01'), L('a', '2026-07-08'), L('a', '2026-07-15'),
      L('b', '2026-07-02'), L('b', '2026-07-03'), L('c', '2026-07-04'),
    ];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.topDow).toBe(3);
    expect(r.topDowWears).toBe(3);
  });
});

// ── The four conditional slides ──────────────────────────────────────────────
// Each one drops itself rather than rendering an empty or dispiriting panel, so
// what matters most in each block is the case where the slide is ABSENT.

describe('monthRecap — vs. last month', () => {
  const JUNE = [
    L('a', '2026-06-01'), L('a', '2026-06-02'),
    L('b', '2026-06-03'), L('b', '2026-06-04'),
  ];

  it('compares against the month before the recap month', () => {
    const r = july({ logs: [...JULY_LOGS, ...JUNE] });
    expect(r.prev).toEqual({ period: '2026-06', totalWears: 4, uniqueCount: 2 });
  });

  // "Up 37 wears on a month you weren't here for" isn't a comparison.
  it('is null when the previous month is empty', () => {
    expect(july().prev).toBeNull();
  });

  it('rolls the year back for a January recap comparing to December', () => {
    const logs = [
      L('a', '2025-12-01'), L('a', '2025-12-02'), L('a', '2025-12-03'),
      L('b', '2025-12-04'), L('b', '2025-12-05'),
      L('a', '2025-11-01'), L('b', '2025-11-02'),
    ];
    const r = monthRecap({ now: at(2026, 0, 2), logs, watches: JULY_WATCHES });
    expect(r.period).toBe('2025-12');
    expect(r.prev.period).toBe('2025-11');
    expect(r.prev.totalWears).toBe(2);
  });

  it('applies the same wear rules to the previous month', () => {
    const june = [...JUNE, L('a', '2026-06-05', { useCase: 'measurement' }), L('gone', '2026-06-06')];
    const r = july({ logs: [...JULY_LOGS, ...june] });
    expect(r.prev.totalWears).toBe(4);
  });
});

describe('monthRecap — longest streak', () => {
  it('finds the longest consecutive run of logged days', () => {
    const logs = [
      L('a', '2026-07-01'), L('a', '2026-07-02'), L('b', '2026-07-03'), L('b', '2026-07-04'),
      L('c', '2026-07-10'), L('a', '2026-07-20'),
    ];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.streak).toEqual({ days: 4, start: '2026-07-01', end: '2026-07-04' });
  });

  it('picks the longest run, not the first or the last', () => {
    const logs = [
      L('a', '2026-07-01'), L('a', '2026-07-02'),
      L('b', '2026-07-10'), L('b', '2026-07-11'), L('b', '2026-07-12'), L('c', '2026-07-13'),
      L('a', '2026-07-20'), L('a', '2026-07-21'),
    ];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.streak).toEqual({ days: 4, start: '2026-07-10', end: '2026-07-13' });
  });

  it('counts a day once however many watches were worn on it', () => {
    const logs = [
      L('a', '2026-07-01'), L('b', '2026-07-01'), L('c', '2026-07-01'),
      L('a', '2026-07-02'), L('b', '2026-07-03'), L('c', '2026-07-04'),
    ];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.streak.days).toBe(4);
  });

  // Below the floor it reads as a rebuke rather than an achievement.
  it(`is null below ${RECAP_MIN_STREAK} days`, () => {
    const logs = [
      L('a', '2026-07-01'), L('a', '2026-07-02'),   // a run of 2, the longest here
      L('b', '2026-07-06'), L('b', '2026-07-10'),
      L('c', '2026-07-14'), L('c', '2026-07-19'),
    ];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.streak).toBeNull();
  });

  // The default fixture happens to be six consecutive days — worth pinning, so
  // a later edit to it can't silently gut the streak tests above.
  it('reports the whole month when every day is consecutive', () => {
    expect(july().streak).toEqual({ days: 6, start: '2026-07-01', end: '2026-07-06' });
  });

  it(`shows at exactly ${RECAP_MIN_STREAK} days`, () => {
    const logs = [
      L('a', '2026-07-01'), L('a', '2026-07-02'), L('a', '2026-07-03'),
      L('b', '2026-07-10'), L('c', '2026-07-20'),
    ];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.streak.days).toBe(RECAP_MIN_STREAK);
  });

  // The slide is about that month, so a run continuing from June is cut at the
  // boundary rather than counting days outside the period.
  it('does not count days outside the month', () => {
    const logs = [
      L('a', '2026-06-28'), L('a', '2026-06-29'), L('a', '2026-06-30'),
      L('a', '2026-07-01'), L('a', '2026-07-02'), L('b', '2026-07-03'),
      L('b', '2026-07-10'), L('c', '2026-07-11'),
    ];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES });
    expect(r.streak).toEqual({ days: 3, start: '2026-07-01', end: '2026-07-03' });
  });
});

describe('monthRecap — new arrivals', () => {
  it('lists watches added during the recap month, oldest first', () => {
    const watches = [
      W('a', { createdAt: '2026-07-20T10:00:00Z' }),
      W('b', { createdAt: '2026-07-05T10:00:00Z' }),
      W('c', { createdAt: '2026-03-01T10:00:00Z' }),
    ];
    expect(july({ watches }).arrivals).toEqual(['b', 'a']);
  });

  it('is empty in a month with no additions', () => {
    expect(july().arrivals).toEqual([]);
  });

  it('caps at three', () => {
    const watches = ['a', 'b', 'c'].map((id, i) =>
      W(id, { createdAt: `2026-07-0${i + 1}T10:00:00Z` }));
    const extra = ['d', 'e'].map((id, i) => W(id, { createdAt: `2026-07-1${i}T10:00:00Z` }));
    const r = monthRecap({ now: at(2026, 7, 3), logs: JULY_LOGS, watches: [...watches, ...extra] });
    expect(r.arrivals).toHaveLength(3);
  });

  it('ignores a watch with no createdAt', () => {
    expect(july({ watches: [W('a'), W('b'), W('c')] }).arrivals).toEqual([]);
  });
});

describe('monthRecap — top post', () => {
  const withIds = [
    L('a', '2026-07-01', { id: 'p1', photoUrl: 'https://x/1.jpg' }),
    L('a', '2026-07-02', { id: 'p2' }),
    L('a', '2026-07-03', { id: 'p3' }),
    L('b', '2026-07-04', { id: 'p4' }),
    L('b', '2026-07-05', { id: 'p5' }),
    L('c', '2026-07-06', { id: 'p6' }),
  ];
  const run = (likes) => monthRecap({
    now: at(2026, 7, 3), logs: withIds, watches: JULY_WATCHES, likes,
  });

  it('picks the most-liked post of the month', () => {
    const r = run({ p1: 2, p4: 9, p6: 5 });
    expect(r.topPost).toMatchObject({ logId: 'p4', watchId: 'b', likes: 9 });
  });

  it('carries the photo through when the post has one', () => {
    expect(run({ p1: 3 }).topPost.photoUrl).toBe('https://x/1.jpg');
  });

  it('still works for a post with no photo', () => {
    expect(run({ p4: 3 }).topPost).toMatchObject({ logId: 'p4', photoUrl: null });
  });

  // Zero likes is not a highlight.
  it('is null when nothing was liked', () => {
    expect(run({}).topPost).toBeNull();
  });

  // No map = the fetch never ran (out of window, or it failed). The rest of the
  // card must be unaffected.
  it('is null when no likes map was supplied', () => {
    expect(run(undefined).topPost).toBeNull();
    expect(run(undefined).totalWears).toBe(6);
  });

  it('breaks a tie on the more recent post', () => {
    expect(run({ p1: 4, p5: 4 }).topPost.logId).toBe('p5');
  });

  it('ignores likes on posts outside the month', () => {
    const logs = [...withIds, L('a', '2026-06-01', { id: 'old' })];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES, likes: { old: 99, p1: 2 } });
    expect(r.topPost.logId).toBe('p1');
  });

  it('ignores likes on a measurement share', () => {
    const logs = [...withIds, L('a', '2026-07-09', { id: 'm1', useCase: 'measurement' })];
    const r = monthRecap({ now: at(2026, 7, 3), logs, watches: JULY_WATCHES, likes: { m1: 99, p1: 2 } });
    expect(r.topPost.logId).toBe('p1');
  });
});

describe('promoSlotEpoch', () => {
  it('is updated_at for a normal slot — what makes "Reset impressions" work', () => {
    const slot = { variant: 'tag', updated_at: '2026-08-01T00:00:00Z' };
    expect(promoSlotEpoch(slot, null)).toBe('2026-08-01T00:00:00Z');
  });

  // The recap re-arms itself every month, so its local count must be filed
  // under the period rather than a row timestamp nobody is going to bump.
  it('is the recap period for a recap slot, not updated_at', () => {
    const slot = { variant: 'recap', updated_at: '2026-01-01T00:00:00Z' };
    expect(promoSlotEpoch(slot, { period: '2026-07' })).toBe('2026-07');
  });

  it('is null for a recap slot with no recap in hand', () => {
    expect(promoSlotEpoch({ variant: 'recap' }, null)).toBeNull();
  });

  it('survives a null slot', () => {
    expect(promoSlotEpoch(null, null)).toBeNull();
  });
});

describe('eligiblePromoSlots — recap slots', () => {
  const CFG = {
    enabled: true, first_position: 2, repeat_every: 0, max_per_session: 1,
    default_max_impressions: 1, suppress_after_modal: false,
  };
  const RECAP = { period: '2026-07', windowStart: Date.parse('2026-08-01T00:00:00Z') };
  const slot = (o = {}) => ({
    id: 's1', variant: 'recap', audience: 'all', priority: 0, status: 'active',
    starts_at: null, ends_at: null, max_impressions: null,
    created_at: '2026-01-01T00:00:00Z', ...o,
  });
  const run = (o = {}) => eligiblePromoSlots({
    slots: [slot()], config: CFG, ctx: { recap: RECAP }, events: [],
    now: Date.parse('2026-08-02T12:00:00Z'), modalShown: false, ...o,
  });

  it('offers a recap slot while there is a recap', () => {
    expect(run().map((s) => s.id)).toEqual(['s1']);
  });

  // The existence gate. Out of window, or too thin a month, monthRecap()
  // returns null and the card simply is not there.
  it('drops a recap slot when there is no recap', () => {
    expect(run({ ctx: { recap: null } })).toEqual([]);
  });

  it('still caps within the month, like any other slot', () => {
    const events = [{ slot_id: 's1', event: 'impression', created_at: '2026-08-01T09:00:00Z' }];
    expect(run({ events })).toEqual([]);
  });

  // The whole point of the windowed count: an all-time count would retire the
  // card permanently after its first month and nothing would bring it back.
  it('does not let LAST month\'s impressions bound this month\'s card', () => {
    const events = [
      { slot_id: 's1', event: 'impression', created_at: '2026-07-02T09:00:00Z' },
      { slot_id: 's1', event: 'impression', created_at: '2026-06-02T09:00:00Z' },
    ];
    expect(run({ events }).map((s) => s.id)).toEqual(['s1']);
  });

  // Rows written before created_at was selected have none; failing open the
  // other way would uncap the card for those accounts.
  it('counts an impression with no timestamp as inside the window', () => {
    const events = [{ slot_id: 's1', event: 'impression' }];
    expect(run({ events })).toEqual([]);
  });

  it('leaves a non-recap slot capped for all time', () => {
    const events = [{ slot_id: 's1', event: 'impression', created_at: '2020-01-01T00:00:00Z' }];
    expect(run({ slots: [slot({ variant: 'tag' })], events })).toEqual([]);
  });

  // The local mirror is filed under the period, so last month's count is not
  // honoured against this month's card either.
  it('ignores a local count recorded under a previous period', () => {
    const localCounts = { s1: { n: 5, e: '2026-06' } };
    expect(run({ localCounts }).map((s) => s.id)).toEqual(['s1']);
  });

  it('honours a local count recorded under the CURRENT period', () => {
    const localCounts = { s1: { n: 5, e: '2026-07' } };
    expect(run({ localCounts })).toEqual([]);
  });

  // The fun-fact modal fires daily at login and sets modalShown, which used to
  // stand every card down for the session. For a card that comes round twelve
  // times a year that meant the recap depended on beating the modal to the
  // feed — a race it often lost, and the reason it looked like it had
  // "disappeared" on 2026-08-08.
  // CFG above has suppression OFF, so these must turn it on explicitly or they
  // assert nothing at all.
  const SUPPRESSING = { ...CFG, suppress_after_modal: true };

  it('survives a modal that already took the screen', () => {
    expect(run({ config: SUPPRESSING, modalShown: true }).map((s) => s.id)).toEqual(['s1']);
  });

  it('still stands a non-recap slot down after a modal', () => {
    expect(run({
      slots: [slot({ variant: 'tag' })], config: SUPPRESSING, modalShown: true,
    })).toEqual([]);
  });

  // The exemption is about the modal, not a licence to ignore everything else.
  it('is not exempt from the config being disabled', () => {
    expect(run({ config: { ...SUPPRESSING, enabled: false }, modalShown: true })).toEqual([]);
  });

  it('is not exempt from the existence gate', () => {
    expect(run({ config: SUPPRESSING, ctx: { recap: null }, modalShown: true })).toEqual([]);
  });

  it('is not exempt from its own impression cap', () => {
    const events = [{ slot_id: 's1', event: 'impression', created_at: '2026-08-01T09:00:00Z' }];
    expect(run({ config: SUPPRESSING, events, modalShown: true })).toEqual([]);
  });
});

// The three thresholds are plain numbers, so the mirror-drift guard can only
// assert they exist in both files (see its ADAPTED list). This is the value
// check it can't do.
describe('recap constants match between index.html and the test mirror', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  const appValue = (name) => {
    const m = new RegExp(`const ${name}\\s*=\\s*(\\d+)`).exec(html);
    expect(m, `${name} not found in index.html`).not.toBeNull();
    return Number(m[1]);
  };

  it.each([
    ['RECAP_WINDOW_DAYS', RECAP_WINDOW_DAYS],
    ['RECAP_MIN_WEARS',   RECAP_MIN_WEARS],
    ['RECAP_MIN_WATCHES', RECAP_MIN_WATCHES],
    ['RECAP_MIN_STREAK',  RECAP_MIN_STREAK],
  ])('%s', (name, mirrored) => {
    expect(appValue(name)).toBe(mirrored);
  });
});
