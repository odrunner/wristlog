import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { funFactCardHTML, funFactRowHTML } from '../wrotate_test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('funFactCardHTML', () => {
  it('returns empty string when no fact', () => {
    expect(funFactCardHTML({ fact: '' })).toBe('');
    expect(funFactCardHTML({ fact: null })).toBe('');
  });
  it('renders the fact text escaped', () => {
    const out = funFactCardHTML({ fact: 'Made in 1953 <b>x</b>' });
    expect(out).toContain('Made in 1953');
    expect(out).toContain('&lt;b&gt;');
    expect(out).not.toContain('<b>x</b>');
  });
});

describe('fun-fact wiring in index.html', () => {
  it('logToRow round-trips fact_id', () => {
    expect(html).toMatch(/fact_id:\s*l\.factId/);
  });
  it('rowToLog reads fact_id', () => {
    expect(html).toMatch(/factId:\s*r\.fact_id/);
  });
  it('saveLog attaches a fun fact for wear logs', () => {
    expect(html).toContain('attachFunFact(');
  });
  it('pick RPC is called; generation commits server-side via the edge', () => {
    expect(html).toContain("pick_watch_fact");
    // The client no longer commits directly — it passes commit:{logId,wearDate}
    // to the edge function, which persists pool+cursor+logs.fact_id server-side
    // so a cold-model fact survives the client disconnecting mid-generation.
    expect(html).toMatch(/commit:\s*\{\s*logId:\s*logEntry\.id/);
  });
});

describe('fun-fact covers every wear-creation path', () => {
  // Regression guard: attachFunFact was originally wired only into saveLog, so
  // wears logged via quickLog (collection one-tap) and saveNewPost (New Post
  // composer with a watch tagged) silently got no fact. All three must call it.
  const fnBody = (marker) => {
    const i = html.indexOf(marker);
    if (i === -1) return '';
    const rest = html.slice(i + marker.length);
    const next = rest.search(/\n(async )?function [a-zA-Z]/);
    return next === -1 ? rest : rest.slice(0, next);
  };
  it('saveLog (Track modal) calls attachFunFact', () => {
    expect(fnBody('async function saveLog(')).toContain('attachFunFact(');
  });
  it('quickLog (collection one-tap) calls attachFunFact', () => {
    expect(fnBody('function quickLog(')).toContain('attachFunFact(');
  });
  it('saveNewPost calls attachFunFact for any watch-tagged post (incl. measurement)', () => {
    // Guarded by postedWatch, NOT isWear — measurement shares tag a watch and
    // should get a fact about it too.
    expect(fnBody('async function saveNewPost(')).toMatch(/if \(postedWatch\) attachFunFact/);
  });
});

describe('feed fun-fact rendering', () => {
  it('FEED_LOG_COLS includes fact_id', () => {
    expect(html).toMatch(/const FEED_LOG_COLS = '[^']*fact_id[^']*'/);
  });
  it('feed enrichment fetches watch_facts by id', () => {
    expect(html).toMatch(/from\('watch_facts'\)\.select\([^)]*\)\.in\('id'/);
  });
  it('renderFeedCard emits a tappable fun-fact footnote row', () => {
    expect(html).toContain('toggleFunFact(');
    expect(html).toContain('funfact-row');
  });
});

describe('fun-fact engagement tracking + admin metrics', () => {
  it('card template builds the row via funFactRowHTML with the log id', () => {
    expect(html).toMatch(/funFactRowHTML\(\{\s*fact:\s*item\.fact,\s*logId:\s*item\.id\s*\}\)/);
  });
  it('toggleFunFact records a click on open', () => {
    expect(html).toContain("recordFactClick(row.getAttribute('data-log-id'))");
  });
  it('recordFactClick does a PLAIN insert into fact_clicks (not upsert)', () => {
    expect(html).toMatch(/from\('fact_clicks'\)\.insert\(/);
    expect(html).not.toMatch(/from\('fact_clicks'\)\.upsert\(/);
  });
  it('admin dashboard calls admin_fact_counts and shows the four rows', () => {
    expect(html).toContain('admin_fact_counts');
    expect(html).toContain('Fun fact clicks');
    expect(html).toContain('Fun fact viewers');
    expect(html).toContain('Fun facts generated');
    expect(html).toContain('Watches with facts');
  });
});

describe('funFactRowHTML', () => {
  it('returns empty string when there is no fact', () => {
    expect(funFactRowHTML({ fact: '', logId: 'log1' })).toBe('');
    expect(funFactRowHTML({ fact: null, logId: 'log1' })).toBe('');
    expect(funFactRowHTML({ fact: '   ', logId: 'log1' })).toBe('');
  });

  it('escapes the fact text', () => {
    const out = funFactRowHTML({ fact: 'Made in 1953 <b>x</b>', logId: 'log1' });
    expect(out).toContain('Made in 1953');
    expect(out).toContain('&lt;b&gt;');
    expect(out).not.toContain('<b>x</b>');
  });

  it('escapes the log id into the data attribute', () => {
    const out = funFactRowHTML({ fact: 'A fact', logId: 'a"b' });
    expect(out).toContain('data-log-id="a&quot;b"');
  });

  it('keeps the visible label inside the button so it lands in the accessible name', () => {
    const out = funFactRowHTML({ fact: 'A fact', logId: 'log1' });
    expect(out).toContain('>Fun fact</span>');
    expect(out).not.toContain('aria-label');
  });

  it('renders collapsed, expandable and tagged with the log id', () => {
    const out = funFactRowHTML({ fact: 'A fact', logId: 'log1' });
    expect(out).toContain('class="funfact-row is-clamped"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('data-log-id="log1"');
    expect(out).toContain('funfact-clamp');
    expect(out).toContain('funfact-more');
  });

  it('hides the bulb and the more affordance from assistive tech', () => {
    const out = funFactRowHTML({ fact: 'A fact', logId: 'log1' });
    expect(out.match(/aria-hidden="true"/g)).toHaveLength(2);
  });
});

describe('feed card uses the footnote row, not the pill', () => {
  it('has removed the pill and the amber feed body from the CSS, card template and toggleFunFact', () => {
    expect(html).not.toContain('funfact-pill');
    expect(html).not.toContain('funfact-body');
  });

  it('renders the row from the feed card template', () => {
    expect(html).toMatch(/\$\{funFactRow\}/);
  });

  it('keeps the amber card for the login modal and watch preview', () => {
    expect(html).toContain('.funfact-card{');
    expect(html).toContain('function funFactCardHTML');
  });

  it('styles the label with the AA-compliant accent, not the tier gold', () => {
    const css = html.slice(html.indexOf('.funfact-row {'), html.indexOf('.feed-chip-row {'));
    expect(css).toContain('var(--badge-accent)');
    expect(css).not.toContain('--badge-tier');
    expect(css).not.toContain('#B8952A');
  });
});

describe('toggleFunFact', () => {
  const fn = html.slice(html.indexOf('function toggleFunFact('), html.indexOf('// ── Feed three-dot menu'));

  it('drives the row, not a separate hidden body', () => {
    expect(fn).not.toContain('funfact-body');
    expect(fn).toContain("querySelector('.funfact-clamp')");
  });

  it('toggles aria-expanded in both directions', () => {
    expect(fn).toContain("aria-expanded', expanding ? 'true' : 'false'");
  });

  it('still records the expand exactly once, on expand only', () => {
    expect(fn.match(/recordFactClick\(/g)).toHaveLength(1);
  });

  it('honours prefers-reduced-motion', () => {
    expect(fn).toContain('prefers-reduced-motion: reduce');
  });

  it('uses the shared 3-line constant rather than a magic number', () => {
    expect(html).toContain('const FUNFACT_CLAMP_PX = 58.5');
    expect(fn).toContain('FUNFACT_CLAMP_PX');
  });
});

describe('toggleFunFact race guard: a stale transitionend cannot mutate a newer state', () => {
  // Build a real, callable toggleFunFact straight out of the index.html source
  // (not a reimplementation), so this test tracks the actual shipped logic.
  const src = html.slice(html.indexOf('function toggleFunFact('), html.indexOf('// ── Feed three-dot menu'));

  function buildToggleFunFact(recordFactClick) {
    const factory = new Function(
      'FUNFACT_CLAMP_PX', 'recordFactClick', 'window', 'requestAnimationFrame',
      `${src}\nreturn toggleFunFact;`
    );
    return factory(
      58.5,
      recordFactClick,
      { matchMedia: () => ({ matches: false }) }, // prefers-reduced-motion: no
      (cb) => cb() // run synchronously; only the final state matters here
    );
  }

  // Minimal EventTarget-ish clamp: addEventListener just records listeners.
  // fireTransitionEnd() invokes every listener still attached for
  // 'transitionend' in one shot — this is what a real browser does when an
  // earlier transition was superseded (it gets 'transitioncancel', not
  // 'transitionend', so its 'once' listener is never invoked or removed) and
  // a later, unrelated transition then completes for real.
  function makeClamp(scrollHeight) {
    const listeners = [];
    return {
      style: { maxHeight: '' },
      scrollHeight,
      get offsetHeight() { return 0; },
      addEventListener(evt, cb, opts) { listeners.push({ evt, cb, opts }); },
      fireTransitionEnd() {
        listeners.filter((l) => l.evt === 'transitionend').forEach((l) => l.cb());
      },
    };
  }

  function makeRow(clamp) {
    const attrs = { 'aria-expanded': 'false', 'data-log-id': 'log1' };
    const classes = new Set(['is-clamped']);
    return {
      querySelector: (sel) => (sel === '.funfact-clamp' ? clamp : null),
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = v; },
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      _classes: classes,
    };
  }

  it('rapid expand/collapse/expand leaves the row matching its final aria-expanded state once the deferred transitionend lands', () => {
    const clicks = [];
    const toggleFunFact = buildToggleFunFact((logId) => clicks.push(logId));
    const clamp = makeClamp(200);
    const row = makeRow(clamp);

    toggleFunFact(row); // tap 1: collapsed -> expanding   (registers stale listener A)
    toggleFunFact(row); // tap 2: expanded  -> collapsing   (registers stale listener B)
    toggleFunFact(row); // tap 3: collapsed -> expanding again (registers listener C — the only one still current)

    // None of the three transitions ever completed on their own (each was
    // superseded before its own event landed), so all three listeners are
    // still attached. A later, real transitionend now fires once, and every
    // attached listener sees it — exactly the merge described in the review.
    clamp.fireTransitionEnd();

    expect(row.getAttribute('aria-expanded')).toBe('true');
    // The bug this guards against: listener B's callback unconditionally runs
    // `row.classList.add('is-clamped')`. Without a generation check, B fires
    // alongside C and re-clamps a row whose aria-expanded still says 'true'.
    expect(row._classes.has('is-clamped')).toBe(false);
    expect(clicks).toEqual(['log1', 'log1']); // recordFactClick fired once per expand (taps 1 and 3)
  });
});

describe('fun-fact impression tracking', () => {
  it('inserts impressions into their own table', () => {
    expect(html).toContain("db.from('fact_impressions').insert(");
  });

  it('dedups within the page view before hitting the network', () => {
    const fn = html.slice(html.indexOf('function recordFactImpression('), html.indexOf('function initFactRows('));
    expect(fn).toContain('_factImpSeen.has(logId)');
    expect(fn).toContain('_factImpSeen.add(logId)');
  });

  it('marks truncated rows so the more affordance only shows when it is true', () => {
    const fn = html.slice(html.indexOf('function initFactRows('), html.indexOf('// ── Feed three-dot menu'));
    expect(fn).toContain('scrollHeight > clamp.clientHeight');
    expect(fn).toContain("classList.add('is-truncated')");
  });

  it('re-attaches after every feed render, dropping stale observer registrations (freshRender=true)', () => {
    const fn = html.slice(html.indexOf('function renderFeed()'), html.indexOf('function mountFeedLoadMoreSentinel'));
    expect(fn).toContain('initFactRows(true)');
  });
});

describe('fix: paginated posts (loadMoreFeed) are counted too', () => {
  // 2026-07-27 review finding (Critical): loadMoreFeed() appends cards via
  // insertAdjacentHTML and never called initFactRows(), so posts loaded by
  // infinite scroll got no is-truncated flag and no impression observer —
  // forever. Clicks are recorded on every page (toggleFunFact has no such
  // gap), so this silently inflated expand rate by undercounting the
  // denominator. Guard both that the call exists AND that it runs after the
  // new cards actually land in the DOM.
  const fn = html.slice(html.indexOf('async function loadMoreFeed('), html.indexOf('async function scrollToFeedPost('));

  it('calls initFactRows() after appending the new cards', () => {
    const insertIdx = fn.indexOf("insertAdjacentHTML('beforeend', html)");
    const initIdx = fn.indexOf('initFactRows()');
    expect(insertIdx).toBeGreaterThan(-1);
    expect(initIdx).toBeGreaterThan(insertIdx);
  });

  it('does not pass freshRender=true — an append must not disconnect rows still awaiting their first render\'s observer', () => {
    expect(fn).not.toContain('initFactRows(true)');
  });
});

describe('fix: full re-render vs. append are handled differently by initFactRows (observer leak)', () => {
  // 2026-07-27 review finding (Important): the single module-level
  // _factImpObserver was created once and never disconnected. Every full
  // renderFeed() replaces #feed-list's innerHTML, detaching any row that
  // hadn't intersected yet; IntersectionObserver holds strong references to
  // observed targets, so those detached rows leaked for the rest of the
  // session. A full render must drop the old observer; an append (pagination)
  // must NOT, or rows from the previous page mid-scroll would stop counting.
  const src = html.slice(html.indexOf('let _factImpObserver = null;'), html.indexOf('function toggleFeedMenu('));

  class FakeObserver {
    constructor(cb) {
      this.cb = cb;
      this.observed = new Set();
      this.disconnected = false;
      FakeObserver.instances.push(this);
    }
    observe(el) { this.observed.add(el); }
    unobserve(el) { this.observed.delete(el); }
    disconnect() { this.disconnected = true; this.observed.clear(); }
  }

  function makeRow() {
    const attrs = {};
    return {
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = v; },
      classList: { add: () => {} },
      querySelector: () => null, // not truncated; irrelevant to this test
    };
  }

  // Builds a fresh, real, callable initFactRows straight out of the shipped
  // source (not a reimplementation) with a fake document/IntersectionObserver
  // wired in, mirroring the toggleFunFact race-guard test's approach below.
  function build() {
    FakeObserver.instances = [];
    let liveRows = [];
    const fakeDocument = {
      querySelectorAll: () => liveRows.filter(r => !r.getAttribute('data-fact-init')),
    };
    const fakeWindow = { IntersectionObserver: FakeObserver };
    const currentUser = { id: 'user1' };
    const db = { from: () => ({ insert: () => ({ then: (cb) => { cb && cb(); return { catch: () => {} }; } }) }) };
    const factory = new Function(
      'window', 'document', 'IntersectionObserver', 'currentUser', 'db',
      `${src}\nreturn { initFactRows, getObserver: () => _factImpObserver };`
    );
    const api = factory(fakeWindow, fakeDocument, FakeObserver, currentUser, db);
    return { ...api, setLiveRows: (rows) => { liveRows = rows; }, instances: FakeObserver.instances };
  }

  it('a full render (freshRender=true) disconnects the previous observer instead of leaking it', () => {
    const { initFactRows, getObserver, setLiveRows, instances } = build();
    const rowA = makeRow();
    setLiveRows([rowA]);
    initFactRows(true);
    const firstObserver = getObserver();
    expect(instances).toHaveLength(1);
    expect(firstObserver.observed.has(rowA)).toBe(true);

    // Simulate the next full renderFeed(): the whole list is replaced, so rowA
    // is detached and a brand-new rowB takes its place.
    const rowB = makeRow();
    setLiveRows([rowB]);
    initFactRows(true);

    expect(firstObserver.disconnected).toBe(true); // stale registration dropped, not leaked
    const secondObserver = getObserver();
    expect(secondObserver).not.toBe(firstObserver);
    expect(instances).toHaveLength(2);
    expect(secondObserver.observed.has(rowB)).toBe(true);
  });

  it('an append (no freshRender flag) reuses the existing observer and keeps prior rows registered', () => {
    const { initFactRows, getObserver, setLiveRows, instances } = build();
    const rowA = makeRow();
    setLiveRows([rowA]);
    initFactRows(true); // the page's initial renderFeed()
    const observerAfterFirstRender = getObserver();

    // Simulate loadMoreFeed(): rowA is still on screen (not replaced), rowB is
    // newly appended alongside it.
    const rowB = makeRow();
    setLiveRows([rowA, rowB]);
    initFactRows(); // append — freshRender omitted

    expect(getObserver()).toBe(observerAfterFirstRender); // same instance — not disconnected
    expect(observerAfterFirstRender.disconnected).toBe(false);
    expect(instances).toHaveLength(1); // no new observer created
    expect(observerAfterFirstRender.observed.has(rowA)).toBe(true); // survived the append
    expect(observerAfterFirstRender.observed.has(rowB)).toBe(true); // newly observed
  });
});

describe('fix: _factImpSeen is reset on sign-out so it cannot survive an account switch', () => {
  // 2026-07-27 review finding (Important): _factImpSeen is never reset on
  // sign-out. clearUserState() deliberately resets feed state to stop stale
  // data leaking across accounts but omitted this new Set — so a post already
  // seen under account A would never fire an impression for account B in the
  // same tab.
  it('clearUserState() clears _factImpSeen', () => {
    const fn = html.slice(html.indexOf('function clearUserState()'), html.indexOf('// ── Timegrapher'));
    expect(fn).toContain('_factImpSeen.clear()');
  });

  it('recordFactImpression fires again for the same log id once the set is cleared (simulating an account switch)', () => {
    const src = html.slice(html.indexOf('let _factImpObserver = null;'), html.indexOf('function initFactRows('));
    const inserted = [];
    const db = { from: () => ({ insert: (row) => { inserted.push(row); return { then: (cb) => { cb && cb(); return { catch: () => {} }; } }; } }) };
    const currentUser = { id: 'userA' };
    const factory = new Function(
      'currentUser', 'db',
      `${src}\nreturn { recordFactImpression, clearSeen: () => _factImpSeen.clear() };`
    );
    const { recordFactImpression, clearSeen } = factory(currentUser, db);

    recordFactImpression('log1');
    recordFactImpression('log1'); // same session, same post — suppressed by design
    expect(inserted).toHaveLength(1);

    clearSeen(); // exactly what clearUserState() now does on sign-out
    recordFactImpression('log1'); // next account happens to see the same log id
    expect(inserted).toHaveLength(2);
  });
});

describe('admin fun-fact stats', () => {
  it('shows impressions and an expand rate beside the click counts', () => {
    expect(html).toContain("statRow('Fun fact impressions'");
    expect(html).toContain("statRow('Fun fact expand rate'");
  });
});

describe('fix: refreshFeedCard re-initialises the fun-fact row after replacing the card', () => {
  // 2026-07-27 final review finding (Important): refreshFeedCard() replaces a
  // single card via outerHTML but never re-ran initFactRows(), so the brand-new
  // DOM node had no data-fact-init, no observer registration and no
  // is-truncated class. It has 19 call sites (like, unlike, comment like, post
  // comment, delete comment, caption edit, report, toggleComments, ...) — the
  // most common feed actions. Consequence: the "more" affordance silently
  // disappears, and if the row hadn't yet crossed the observer's threshold its
  // impression is never recorded even though a later tap still fires
  // recordFactClick — a click with no matching impression, inflating expand
  // rate.
  const fn = html.slice(html.indexOf('function refreshFeedCard('), html.indexOf('// ── Comments'));

  it('calls initFactRows() after replacing the card', () => {
    expect(fn).toMatch(/initFactRows\(\s*\)/);
  });

  it('does not pass a truthy freshRender argument (that would disconnect the shared observer and drop every other row on the page)', () => {
    const calls = fn.match(/initFactRows\(([^)]*)\)/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((c) => {
      const arg = c.slice('initFactRows('.length, -1).trim();
      expect(arg).toBe(''); // must be the bare, no-argument form
    });
  });

  it('calls initFactRows() after the outerHTML swap, not before (the row must exist in the DOM first)', () => {
    const swapIdx = fn.indexOf('.outerHTML = renderFeedCard(item)');
    const initIdx = fn.indexOf('initFactRows(');
    expect(swapIdx).toBeGreaterThan(-1);
    expect(initIdx).toBeGreaterThan(swapIdx);
  });
});

describe('fix: .funfact-bulb footnote color/spacing rule is scoped to the footnote row', () => {
  // 2026-07-27 final review finding (Minor): the rule added for the new
  // footnote (`color`, `vertical-align`, `margin-right`) was unscoped, so it
  // also matched the bulb inside funFactCardHTML's amber card (post-wear card,
  // login fun-fact modal, watch preview panel). That card already has its own
  // `gap: .5rem`, so the extra margin-right widened its spacing — and this
  // feature was explicitly required not to alter that card's appearance.
  it('scopes the color/vertical-align/margin-right rule under .funfact-row .funfact-bulb', () => {
    expect(html).toContain('.funfact-row .funfact-bulb { color: var(--badge-accent); vertical-align: -2px; margin-right: .3rem; }');
  });

  it('does not leave a bare, unscoped .funfact-bulb rule that would also style the amber card bulb', () => {
    expect(html).not.toMatch(/(?<!\.funfact-row )\.funfact-bulb\s*\{\s*color:/);
  });

  it('leaves the pre-existing layout-only rule untouched', () => {
    expect(html).toContain('.funfact-bulb{flex:0 0 auto;}');
  });
});

describe('fix: truncation is measured at first real visibility, not synchronously at init', () => {
  // 2026-07-27 final review finding (Minor): initFactRows previously measured
  // scrollHeight/clientHeight synchronously, right after the HTML was
  // injected. If the feed wasn't the visible page at that moment (the boot
  // path calls loadFeed() unconditionally and asynchronously, so a deep link
  // or restored route can have switched away), both values read 0 and no row
  // got is-truncated — and the data-fact-init guard then blocks any later
  // remeasurement for the rest of the session, so "more" never appears.
  // Fix: measure inside the IntersectionObserver callback, at first
  // visibility, when layout has actually settled. The no-IntersectionObserver
  // fallback still measures synchronously, as before.
  const src = html.slice(html.indexOf('let _factImpObserver = null;'), html.indexOf('function toggleFeedMenu('));

  class FakeObserver {
    constructor(cb) { this.cb = cb; this.observed = new Set(); }
    observe(el) { this.observed.add(el); }
    unobserve(el) { this.observed.delete(el); }
    disconnect() { this.observed.clear(); }
    fire(entries) { this.cb(entries); }
  }

  function makeRow(clamp, logId) {
    const attrs = { 'data-log-id': logId || 'log1' };
    const classes = new Set(['is-clamped']);
    return {
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = v; },
      classList: { add: (c) => classes.add(c), contains: (c) => classes.has(c) },
      querySelector: (sel) => (sel === '.funfact-clamp' ? clamp : null),
      _classes: classes,
    };
  }

  function buildWithObserver() {
    let liveRows = [];
    const fakeDocument = { querySelectorAll: () => liveRows.filter((r) => !r.getAttribute('data-fact-init')) };
    const fakeWindow = { IntersectionObserver: FakeObserver };
    const currentUser = { id: 'user1' };
    const inserted = [];
    const db = { from: () => ({ insert: (row) => { inserted.push(row); return { then: (cb) => { cb && cb(); return { catch: () => {} }; } }; } }) };
    const factory = new Function(
      'window', 'document', 'IntersectionObserver', 'currentUser', 'db',
      `${src}\nreturn { initFactRows, getObserver: () => _factImpObserver };`
    );
    const api = factory(fakeWindow, fakeDocument, FakeObserver, currentUser, db);
    return { ...api, setLiveRows: (rows) => { liveRows = rows; }, inserted };
  }

  it('does not stamp is-truncated at init time when layout has not settled (scrollHeight/clientHeight both read 0)', () => {
    const { initFactRows, setLiveRows } = buildWithObserver();
    const clamp = { scrollHeight: 0, clientHeight: 0 }; // page not visible yet, exactly as in the bug report
    const row = makeRow(clamp);
    setLiveRows([row]);
    initFactRows();
    expect(row._classes.has('is-truncated')).toBe(false); // correct — nothing measurable yet, no false negative locked in
  });

  it('measures truncation lazily, at first real visibility, once layout has settled — not frozen at init', () => {
    const { initFactRows, getObserver, setLiveRows } = buildWithObserver();
    const clamp = { scrollHeight: 0, clientHeight: 0 }; // not settled when initFactRows runs
    const row = makeRow(clamp);
    setLiveRows([row]);
    initFactRows();

    // Layout settles later (row becomes visible for real) and genuinely overflows.
    clamp.scrollHeight = 90;
    clamp.clientHeight = 58;
    getObserver().fire([{ isIntersecting: true, target: row }]);

    expect(row._classes.has('is-truncated')).toBe(true);
  });

  it('does not mark a row truncated at first visibility if it never actually overflows', () => {
    const { initFactRows, getObserver, setLiveRows } = buildWithObserver();
    const clamp = { scrollHeight: 40, clientHeight: 40 };
    const row = makeRow(clamp);
    setLiveRows([row]);
    initFactRows();
    getObserver().fire([{ isIntersecting: true, target: row }]);
    expect(row._classes.has('is-truncated')).toBe(false);
  });

  it('still records the impression when the observer fires, unchanged', () => {
    const { initFactRows, getObserver, setLiveRows, inserted } = buildWithObserver();
    const clamp = { scrollHeight: 90, clientHeight: 58 };
    const row = makeRow(clamp, 'log42');
    setLiveRows([row]);
    initFactRows();
    getObserver().fire([{ isIntersecting: true, target: row }]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ user_id: 'user1', log_id: 'log42' });
  });

  it('fallback (no IntersectionObserver in the environment) still measures synchronously at init, as before', () => {
    let liveRows = [];
    const fakeDocument = { querySelectorAll: () => liveRows.filter((r) => !r.getAttribute('data-fact-init')) };
    const fakeWindow = {}; // no IntersectionObserver — forces the fallback branch
    const currentUser = { id: 'user1' };
    const inserted = [];
    const db = { from: () => ({ insert: (row) => { inserted.push(row); return { then: (cb) => { cb && cb(); return { catch: () => {} }; } }; } }) };
    const factory = new Function(
      'window', 'document', 'currentUser', 'db',
      `${src}\nreturn { initFactRows };`
    );
    const { initFactRows } = factory(fakeWindow, fakeDocument, currentUser, db);
    const clamp = { scrollHeight: 90, clientHeight: 58 };
    const row = makeRow(clamp);
    liveRows = [row];
    initFactRows();
    expect(row._classes.has('is-truncated')).toBe(true);
    expect(inserted).toHaveLength(1);
  });
});
