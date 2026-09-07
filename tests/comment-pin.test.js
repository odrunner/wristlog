import { describe, it, expect } from 'vitest';
import { orderCommentsForDisplay } from '../wrotate_test.js';

// Pinning the most-liked comment to the top of a thread (1a39a0f, 2026-03-05)
// scrambled short threads: one stray like on a reply put it above the question
// it answered, with no label to say why (reported 2026-09-05). A pin now needs
// ≥2 likes AND ≥4 comments; otherwise the thread is chronological.

const c = (id, user = 'u') => ({ id, user_id: user });
const likes = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { count: v, liked: false }]));

describe('orderCommentsForDisplay — expanded thread', () => {
  it('3 comments, reply has 1 like → chronological (the reported case)', () => {
    const list = [c('q'), c('reply'), c('emoji')];
    expect(orderCommentsForDisplay(list, likes({ reply: 1 }), true).map(x => x.id)).toEqual(['q', 'reply', 'emoji']);
  });
  it('4 comments but top has only 1 like → chronological', () => {
    const list = [c('a'), c('b'), c('c'), c('d')];
    expect(orderCommentsForDisplay(list, likes({ c: 1 }), true).map(x => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('3 comments with a 5-like comment → still chronological (thread too short)', () => {
    const list = [c('a'), c('b'), c('c')];
    expect(orderCommentsForDisplay(list, likes({ b: 5 }), true).map(x => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('4 comments, one with 2 likes → pinned first, rest chronological', () => {
    const list = [c('a'), c('b'), c('c'), c('d')];
    expect(orderCommentsForDisplay(list, likes({ c: 2 }), true).map(x => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('pinned comment already first → order unchanged', () => {
    const list = [c('a'), c('b'), c('c'), c('d')];
    expect(orderCommentsForDisplay(list, likes({ a: 3 }), true).map(x => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('tie on likes → the earliest of the tied comments is pinned', () => {
    const list = [c('a'), c('b'), c('c'), c('d')];
    expect(orderCommentsForDisplay(list, likes({ b: 2, d: 2 }), true).map(x => x.id)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('no likes map / empty list → safe', () => {
    expect(orderCommentsForDisplay([c('a'), c('b'), c('c'), c('d')], undefined, true).map(x => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(orderCommentsForDisplay([], {}, true)).toEqual([]);
    expect(orderCommentsForDisplay(null, {}, false)).toEqual([]);
  });
  it('does not mutate the input array', () => {
    const list = [c('a'), c('b'), c('c'), c('d')];
    orderCommentsForDisplay(list, likes({ c: 2 }), true);
    expect(list.map(x => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('orderCommentsForDisplay — collapsed preview', () => {
  it('short thread → the two most recent, in order', () => {
    const list = [c('q'), c('reply'), c('emoji')];
    expect(orderCommentsForDisplay(list, likes({ reply: 1 }), false).map(x => x.id)).toEqual(['reply', 'emoji']);
  });
  it('one comment → just that one', () => {
    expect(orderCommentsForDisplay([c('a')], {}, false).map(x => x.id)).toEqual(['a']);
  });
  it('long thread with a qualifying top comment → top + newest', () => {
    const list = [c('a'), c('b'), c('c'), c('d'), c('e')];
    expect(orderCommentsForDisplay(list, likes({ b: 2 }), false).map(x => x.id)).toEqual(['b', 'e']);
  });
  it('qualifying top comment IS the newest → the two most recent', () => {
    const list = [c('a'), c('b'), c('c'), c('d'), c('e')];
    expect(orderCommentsForDisplay(list, likes({ e: 2 }), false).map(x => x.id)).toEqual(['d', 'e']);
  });
});
