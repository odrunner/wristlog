import { describe, it, expect } from 'vitest';
import {
  computeFriendState, getFriendStatus,
  computeFriendships,
  aggregateLikes, aggregateCommentCounts,
  reorderList,
} from '../wristlog.js';

// ── computeFriendState ───────────────────────────────────────────────────────

describe('computeFriendState', () => {
  it('returns empty set when no requests', () => {
    const friends = computeFriendState(new Map(), new Map());
    expect(friends.size).toBe(0);
  });

  it('adds accepted sent requests as friends', () => {
    const sent = new Map([
      ['user2', { receiver_id: 'user2', status: 'accepted' }],
    ]);
    const friends = computeFriendState(sent, new Map());
    expect(friends.has('user2')).toBe(true);
  });

  it('does not add pending sent requests as friends', () => {
    const sent = new Map([
      ['user2', { receiver_id: 'user2', status: 'pending' }],
    ]);
    const friends = computeFriendState(sent, new Map());
    expect(friends.has('user2')).toBe(false);
  });

  it('adds accepted received requests as friends', () => {
    const received = new Map([
      ['user3', { sender_id: 'user3', status: 'accepted' }],
    ]);
    const friends = computeFriendState(new Map(), received);
    expect(friends.has('user3')).toBe(true);
  });

  it('does not add declined received requests', () => {
    const received = new Map([
      ['user3', { sender_id: 'user3', status: 'declined' }],
    ]);
    const friends = computeFriendState(new Map(), received);
    expect(friends.has('user3')).toBe(false);
  });

  it('handles both sent and received accepted requests', () => {
    const sent = new Map([['u2', { receiver_id: 'u2', status: 'accepted' }]]);
    const received = new Map([['u3', { sender_id: 'u3', status: 'accepted' }]]);
    const friends = computeFriendState(sent, received);
    expect(friends.size).toBe(2);
    expect(friends.has('u2')).toBe(true);
    expect(friends.has('u3')).toBe(true);
  });
});

// ── getFriendStatus ──────────────────────────────────────────────────────────

describe('getFriendStatus', () => {
  const state = {
    friends: new Set(['u2']),
    sentRequests: new Map([['u3', { status: 'pending' }]]),
    receivedRequests: new Map([['u4', { status: 'pending' }]]),
  };

  it('returns "friends" for established friendship', () => {
    expect(getFriendStatus('u2', state)).toBe('friends');
  });

  it('returns "pending_sent" for outgoing pending request', () => {
    expect(getFriendStatus('u3', state)).toBe('pending_sent');
  });

  it('returns "pending_received" for incoming pending request', () => {
    expect(getFriendStatus('u4', state)).toBe('pending_received');
  });

  it('returns "none" for unknown user', () => {
    expect(getFriendStatus('u99', state)).toBe('none');
  });

  it('prioritizes friends over sent requests', () => {
    const dualState = {
      friends: new Set(['u2']),
      sentRequests: new Map([['u2', { status: 'accepted' }]]),
      receivedRequests: new Map(),
    };
    expect(getFriendStatus('u2', dualState)).toBe('friends');
  });
});

// ── computeFriendships ────────────────────────────────────────────────────────

describe('computeFriendships', () => {
  const ME = 'user-me';
  const A  = 'user-a';
  const B  = 'user-b';

  it('returns empty set when no requests', () => {
    expect(computeFriendships([], new Set(), ME).size).toBe(0);
  });

  it('returns empty set when both verified but not following', () => {
    const req = [{ initiator_id: ME, target_id: A, initiator_verified: true, target_verified: true }];
    // ME is not following A
    expect(computeFriendships(req, new Set(), ME).size).toBe(0);
  });

  it('returns empty set when only one side verified', () => {
    const following = new Set([A]);
    const req = [{ initiator_id: ME, target_id: A, initiator_verified: true, target_verified: false }];
    expect(computeFriendships(req, following, ME).size).toBe(0);
  });

  it('adds friend when both verified AND mutual follow (ME is initiator)', () => {
    const following = new Set([A]);
    const req = [{ initiator_id: ME, target_id: A, initiator_verified: true, target_verified: true }];
    const result = computeFriendships(req, following, ME);
    expect(result.has(A)).toBe(true);
    expect(result.size).toBe(1);
  });

  it('adds friend when both verified AND mutual follow (ME is target)', () => {
    const following = new Set([B]);
    const req = [{ initiator_id: B, target_id: ME, initiator_verified: true, target_verified: true }];
    const result = computeFriendships(req, following, ME);
    expect(result.has(B)).toBe(true);
    expect(result.size).toBe(1);
  });

  it('handles multiple friends', () => {
    const following = new Set([A, B]);
    const reqs = [
      { initiator_id: ME, target_id: A, initiator_verified: true, target_verified: true },
      { initiator_id: B,  target_id: ME, initiator_verified: true, target_verified: true },
    ];
    const result = computeFriendships(reqs, following, ME);
    expect(result.size).toBe(2);
    expect(result.has(A)).toBe(true);
    expect(result.has(B)).toBe(true);
  });

  it('excludes requests where only initiator verified', () => {
    const following = new Set([A]);
    const req = [{ initiator_id: ME, target_id: A, initiator_verified: true, target_verified: false }];
    expect(computeFriendships(req, following, ME).has(A)).toBe(false);
  });

  it('excludes requests where only target verified', () => {
    const following = new Set([A]);
    const req = [{ initiator_id: ME, target_id: A, initiator_verified: false, target_verified: true }];
    expect(computeFriendships(req, following, ME).has(A)).toBe(false);
  });

  it('excludes requests where neither side verified', () => {
    const following = new Set([A]);
    const req = [{ initiator_id: ME, target_id: A, initiator_verified: false, target_verified: false }];
    expect(computeFriendships(req, following, ME).has(A)).toBe(false);
  });

  it('does not mutate the followingSet', () => {
    const following = new Set([A]);
    const req = [{ initiator_id: ME, target_id: A, initiator_verified: true, target_verified: true }];
    computeFriendships(req, following, ME);
    expect(following.size).toBe(1);
  });

  it('correctly identifies otherId for both initiator and target roles', () => {
    const C = 'user-c';
    const following = new Set([A, B, C]);
    const reqs = [
      { initiator_id: ME, target_id: A, initiator_verified: true, target_verified: true }, // ME=initiator → friend is A
      { initiator_id: B,  target_id: ME, initiator_verified: true, target_verified: true }, // ME=target   → friend is B
      { initiator_id: C,  target_id: ME, initiator_verified: true, target_verified: false }, // not complete
    ];
    const result = computeFriendships(reqs, following, ME);
    expect(result.has(A)).toBe(true);
    expect(result.has(B)).toBe(true);
    expect(result.has(C)).toBe(false);
  });
});

// ── aggregateLikes ───────────────────────────────────────────────────────────

describe('aggregateLikes', () => {
  it('initializes all log IDs with zero counts and not liked', () => {
    const result = aggregateLikes([], ['l1', 'l2'], 'me');
    expect(result.l1).toEqual({ count: 0, liked: false });
    expect(result.l2).toEqual({ count: 0, liked: false });
  });

  it('counts likes per log', () => {
    const likes = [
      { log_id: 'l1', user_id: 'u1' },
      { log_id: 'l1', user_id: 'u2' },
      { log_id: 'l2', user_id: 'u1' },
    ];
    const result = aggregateLikes(likes, ['l1', 'l2'], 'me');
    expect(result.l1.count).toBe(2);
    expect(result.l2.count).toBe(1);
  });

  it('sets liked=true when current user has liked', () => {
    const likes = [
      { log_id: 'l1', user_id: 'me' },
      { log_id: 'l1', user_id: 'other' },
    ];
    const result = aggregateLikes(likes, ['l1'], 'me');
    expect(result.l1.liked).toBe(true);
    expect(result.l1.count).toBe(2);
  });

  it('sets liked=false when current user has not liked', () => {
    const likes = [{ log_id: 'l1', user_id: 'other' }];
    const result = aggregateLikes(likes, ['l1'], 'me');
    expect(result.l1.liked).toBe(false);
  });

  it('handles null likesData gracefully', () => {
    const result = aggregateLikes(null, ['l1'], 'me');
    expect(result.l1).toEqual({ count: 0, liked: false });
  });

  it('ignores likes for unknown log IDs', () => {
    const likes = [{ log_id: 'unknown', user_id: 'u1' }];
    const result = aggregateLikes(likes, ['l1'], 'me');
    expect(result.l1.count).toBe(0);
    expect(result.unknown).toBeUndefined();
  });
});

// ── aggregateCommentCounts ───────────────────────────────────────────────────

describe('aggregateCommentCounts', () => {
  it('counts comments per log', () => {
    const comments = [
      { log_id: 'l1' }, { log_id: 'l1' }, { log_id: 'l1' },
      { log_id: 'l2' },
    ];
    const result = aggregateCommentCounts(comments);
    expect(result.l1).toBe(3);
    expect(result.l2).toBe(1);
  });

  it('returns empty object for no comments', () => {
    expect(aggregateCommentCounts([])).toEqual({});
  });

  it('handles null input', () => {
    expect(aggregateCommentCounts(null)).toEqual({});
  });
});

// ── reorderList (wishlist drag-and-drop) ────────────────────────────────────

describe('reorderList', () => {
  const list = [
    { id: 'a', name: 'First' },
    { id: 'b', name: 'Second' },
    { id: 'c', name: 'Third' },
    { id: 'd', name: 'Fourth' },
  ];

  it('moves item forward in the list', () => {
    const result = reorderList(list, 'a', 'c');
    expect(result.map(x => x.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves item backward in the list', () => {
    const result = reorderList(list, 'c', 'a');
    expect(result.map(x => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('returns same list when from and to are the same', () => {
    const result = reorderList(list, 'a', 'a');
    expect(result).toEqual(list);
  });

  it('returns same list when fromId is null', () => {
    expect(reorderList(list, null, 'b')).toEqual(list);
  });

  it('returns same list when toId is null', () => {
    expect(reorderList(list, 'a', null)).toEqual(list);
  });

  it('returns same list when fromId is not found', () => {
    expect(reorderList(list, 'x', 'b')).toEqual(list);
  });

  it('returns same list when toId is not found', () => {
    expect(reorderList(list, 'a', 'x')).toEqual(list);
  });

  it('does not mutate the original list', () => {
    const original = [...list];
    reorderList(list, 'a', 'c');
    expect(list).toEqual(original);
  });

  it('handles two-item list', () => {
    const small = [{ id: 'a' }, { id: 'b' }];
    const result = reorderList(small, 'b', 'a');
    expect(result.map(x => x.id)).toEqual(['b', 'a']);
  });

  it('moves last item to first position', () => {
    const result = reorderList(list, 'd', 'a');
    expect(result[0].id).toBe('d');
  });

  it('moves first item to last position', () => {
    const result = reorderList(list, 'a', 'd');
    const ids = result.map(x => x.id);
    expect(ids.indexOf('a')).toBeGreaterThan(ids.indexOf('d') - 1);
  });
});
