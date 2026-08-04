import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { eligiblePromoSlots } from '../wrotate_test.js';

// Coverage for the promo-impression guardrail (2026-08-04). The Supabase client
// RESOLVES with { error } rather than rejecting, so logPromoEvent()'s old
// `.then(() => {}).catch(() => {})` discarded a failed promo_events insert
// silently. That now matters: the dismiss (✕) control was removed, so
// max_impressions is the ONLY thing that ever retires a card — a run of
// failed writes would show a card forever, with no user-side escape. These
// tests exercise the REAL functions pulled straight out of index.html (via
// `new Function`, following the pattern in prov2-precision.test.js), never a
// hand-copied re-implementation, so they can't silently drift from the app.

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

// Extracts a top-level `function NAME(...) { ... }` declaration, closing
// brace included, assuming (like every function this file extracts) its own
// closing brace sits at column 0.
function fnSrc(name) {
  const start = html.indexOf(`function ${name}(`);
  expect(start, `${name} not found in index.html`).toBeGreaterThan(-1);
  const bodyEnd = html.indexOf('\n}', start);
  expect(bodyEnd, `${name}'s closing brace not found`).toBeGreaterThan(-1);
  return html.slice(start, bodyEnd + 2);
}

function buildLogPromoEvent({ db, currentUser, warn, promoEvents, incrementLocal }) {
  const factory = new Function('db', 'currentUser', 'console', '_promoEvents', '_incrementLocalPromoImpression', `
    ${fnSrc('logPromoEvent')}
    return logPromoEvent;
  `);
  return factory(db, currentUser, { warn }, promoEvents, incrementLocal);
}

function constSrc(name) {
  const re = new RegExp(`const ${name} = [^;]+;`);
  const m = re.exec(html);
  expect(m, `${name} not found in index.html`).not.toBeNull();
  return m[0];
}

function buildLocalCounters({ currentUser, localStorage, promoSlots }) {
  const src = [
    constSrc('PROMO_IMPRESSIONS_KEY'),
    fnSrc('_promoImpressionsKey'),
    fnSrc('_readLocalPromoImpressions'),
    fnSrc('_incrementLocalPromoImpression'),
  ].join('\n');
  const factory = new Function('currentUser', 'localStorage', '_promoSlots', `
    ${src}
    return { _promoImpressionsKey, _readLocalPromoImpressions, _incrementLocalPromoImpression };
  `);
  return factory(currentUser, localStorage, promoSlots || []);
}

function buildMaybeLogPromoImpression({ promoImpressed, logPromoEvent }) {
  const factory = new Function('_promoImpressed', 'logPromoEvent', `
    ${fnSrc('maybeLogPromoImpression')}
    return maybeLogPromoImpression;
  `);
  return factory(promoImpressed, logPromoEvent);
}

function memoryLocalStorage() {
  const store = {};
  return {
    store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
}

// ── 1. failed insert is detected and warned about, not swallowed ───────────
describe('logPromoEvent detects a failed insert', () => {
  it('warns with slot, event and message when the insert resolves { error }', async () => {
    const warnCalls = [];
    const db = {
      from: () => ({
        insert: () => Promise.resolve({ error: { message: 'permission denied for table promo_events' } }),
      }),
    };
    const promoEvents = [];
    const logPromoEvent = buildLogPromoEvent({
      db, currentUser: { id: 'u1' }, warn: (...a) => warnCalls.push(a),
      promoEvents, incrementLocal: () => {},
    });

    logPromoEvent('slot-1', 'impression');
    await new Promise((r) => setTimeout(r, 0)); // flush the insert's .then()

    expect(warnCalls.length).toBeGreaterThan(0);
    const joined = warnCalls.map((c) => c.join(' ')).join('\n');
    expect(joined).toContain('slot-1');
    expect(joined).toContain('permission denied for table promo_events');
  });

  it('still warns on a genuine network rejection (the .catch() path)', async () => {
    const warnCalls = [];
    const db = { from: () => ({ insert: () => Promise.reject(new Error('network down')) }) };
    const logPromoEvent = buildLogPromoEvent({
      db, currentUser: { id: 'u1' }, warn: (...a) => warnCalls.push(a),
      promoEvents: [], incrementLocal: () => {},
    });

    logPromoEvent('slot-2', 'click');
    await new Promise((r) => setTimeout(r, 0));

    expect(warnCalls.length).toBeGreaterThan(0);
    expect(warnCalls.map((c) => c.join(' ')).join('\n')).toContain('network down');
  });

  it('a successful insert (no error) never warns', async () => {
    const warnCalls = [];
    const db = { from: () => ({ insert: () => Promise.resolve({ error: null }) }) };
    const logPromoEvent = buildLogPromoEvent({
      db, currentUser: { id: 'u1' }, warn: (...a) => warnCalls.push(a),
      promoEvents: [], incrementLocal: () => {},
    });

    logPromoEvent('slot-3', 'impression');
    await new Promise((r) => setTimeout(r, 0));

    expect(warnCalls).toEqual([]);
  });
});

// ── 2. the local counter caps a card even when every insert fails ──────────
describe('local impression counter guardrails the cap when the DB write fails', () => {
  it('stops offering the card after default_max_impressions sessions, never more', () => {
    const ls = memoryLocalStorage();
    const { _readLocalPromoImpressions, _incrementLocalPromoImpression } =
      buildLocalCounters({ currentUser: { id: 'u1' }, localStorage: ls });

    const cfg = { enabled: true, default_max_impressions: 3 };
    const slots = [{ id: 's1', status: 'active', audience: 'all', priority: 0, created_at: '2026-01-01T00:00:00Z' }];

    let shown = 0;
    for (let session = 0; session < 6; session++) {
      // Every new session re-reads ZERO server events — the DB insert has
      // failed every time, so promo_events never got the row.
      const eligible = eligiblePromoSlots({
        slots, config: cfg, ctx: {}, events: [], now: Date.now(), modalShown: false,
        localCounts: _readLocalPromoImpressions(),
      });
      if (eligible.length) {
        shown++;
        _incrementLocalPromoImpression('s1'); // what logPromoEvent does on an impression
      }
    }

    expect(shown).toBe(3);
  });

  it('without the local counter the card would show every session (proves the guardrail matters)', () => {
    // Same loop, but never consulting localCounts — the pre-guardrail bug.
    const cfg = { enabled: true, default_max_impressions: 3 };
    const slots = [{ id: 's1', status: 'active', audience: 'all', priority: 0, created_at: '2026-01-01T00:00:00Z' }];
    let shown = 0;
    for (let session = 0; session < 6; session++) {
      const eligible = eligiblePromoSlots({ slots, config: cfg, ctx: {}, events: [], now: Date.now(), modalShown: false });
      if (eligible.length) shown++;
    }
    expect(shown).toBe(6);
  });
});

// ── 3. no double-count on re-placement within one session ──────────────────
describe('maybeLogPromoImpression (the observer\'s dedup guard)', () => {
  it('logs an impression once per slot per session even if the card is re-placed after a DOM wipe', () => {
    const calls = [];
    const maybeLogPromoImpression = buildMaybeLogPromoImpression({
      promoImpressed: new Set(),
      logPromoEvent: (id, ev) => calls.push([id, ev]),
    });

    maybeLogPromoImpression('slot-1');   // first placement, enters viewport
    maybeLogPromoImpression('slot-1');   // re-render wipes the DOM, card re-placed, re-enters viewport

    expect(calls).toEqual([['slot-1', 'impression']]);
  });

  it('still logs a different slot placed in the same session', () => {
    const calls = [];
    const maybeLogPromoImpression = buildMaybeLogPromoImpression({
      promoImpressed: new Set(),
      logPromoEvent: (id, ev) => calls.push([id, ev]),
    });

    maybeLogPromoImpression('slot-1');
    maybeLogPromoImpression('slot-2');

    expect(calls).toEqual([['slot-1', 'impression'], ['slot-2', 'impression']]);
  });
});

// ── 4. two accounts on one device keep separate counts ──────────────────────
describe('local counter is per-user', () => {
  it('does not leak or merge counts across an account switch on the same device', () => {
    const ls = memoryLocalStorage();
    const currentUser = { id: 'userA' };
    const { _readLocalPromoImpressions, _incrementLocalPromoImpression } =
      buildLocalCounters({ currentUser, localStorage: ls });

    _incrementLocalPromoImpression('s1');
    _incrementLocalPromoImpression('s1');
    _incrementLocalPromoImpression('s1');
    expect(_readLocalPromoImpressions().s1.n).toBe(3);

    currentUser.id = 'userB'; // account switch, same device/localStorage
    expect(_readLocalPromoImpressions().s1?.n || 0).toBe(0); // userB starts fresh
    _incrementLocalPromoImpression('s1');
    expect(_readLocalPromoImpressions().s1.n).toBe(1);

    currentUser.id = 'userA'; // switch back
    expect(_readLocalPromoImpressions().s1.n).toBe(3); // untouched by userB's writes
  });
});

// ── 5. corrupt / unavailable localStorage degrades safely ──────────────────
describe('local counter degrades safely, never breaks the feed', () => {
  it('never throws and returns no local contribution when localStorage access throws', () => {
    const throwingLs = {
      getItem: () => { throw new Error('SecurityError: storage disabled'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    const { _readLocalPromoImpressions, _incrementLocalPromoImpression } =
      buildLocalCounters({ currentUser: { id: 'u1' }, localStorage: throwingLs });

    expect(() => _incrementLocalPromoImpression('s1')).not.toThrow();
    expect(_readLocalPromoImpressions()).toEqual({});
  });

  it('never throws and returns no local contribution when the stored value is corrupt JSON', () => {
    const ls = memoryLocalStorage();
    ls.store['wrotate_promo_impressions_u1'] = '{not json';
    const { _readLocalPromoImpressions } = buildLocalCounters({ currentUser: { id: 'u1' }, localStorage: ls });

    expect(() => _readLocalPromoImpressions()).not.toThrow();
    expect(_readLocalPromoImpressions()).toEqual({});
  });

  it('never throws when the stored value is valid JSON but not an object', () => {
    const ls = memoryLocalStorage();
    ls.store['wrotate_promo_impressions_u1'] = '"not-an-object"';
    const { _readLocalPromoImpressions } = buildLocalCounters({ currentUser: { id: 'u1' }, localStorage: ls });

    expect(_readLocalPromoImpressions()).toEqual({});
  });

  it('eligiblePromoSlots still works normally (server-derived count only) when localCounts is unreadable', () => {
    const cfg = { enabled: true, default_max_impressions: 3 };
    const slots = [{ id: 's1', status: 'active', audience: 'all', priority: 0, created_at: '2026-01-01T00:00:00Z' }];
    const out = eligiblePromoSlots({ slots, config: cfg, ctx: {}, events: [], now: Date.now(), modalShown: false, localCounts: {} });
    expect(out).toHaveLength(1);
  });
});
