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

  it('re-attaches after every feed render', () => {
    const fn = html.slice(html.indexOf('function renderFeed()'), html.indexOf('function mountFeedLoadMoreSentinel'));
    expect(fn).toContain('initFactRows()');
  });
});
