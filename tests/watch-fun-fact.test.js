import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { funFactCardHTML } from '../wrotate_test.js';

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
  it('saveNewPost (composer) calls attachFunFact', () => {
    expect(fnBody('async function saveNewPost(')).toContain('attachFunFact(');
  });
});

describe('feed fun-fact rendering', () => {
  it('FEED_LOG_COLS includes fact_id', () => {
    expect(html).toMatch(/const FEED_LOG_COLS = '[^']*fact_id[^']*'/);
  });
  it('feed enrichment fetches watch_facts by id', () => {
    expect(html).toMatch(/from\('watch_facts'\)\.select\([^)]*\)\.in\('id'/);
  });
  it('renderFeedCard emits a tappable fun-fact pill', () => {
    expect(html).toContain('toggleFunFact(');
    expect(html).toContain('funfact-pill');
  });
});

describe('fun-fact engagement tracking + admin metrics', () => {
  it('pill carries data-log-id', () => {
    expect(html).toMatch(/funfact-pill[^>]*data-log-id=/);
  });
  it('toggleFunFact records a click on open', () => {
    expect(html).toContain("recordFactClick(btn.getAttribute('data-log-id'))");
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
