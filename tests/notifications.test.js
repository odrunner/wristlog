import { describe, it, expect } from 'vitest';
import {
  notificationBody,
  notificationIsActionable,
  notificationScrollsToPost,
  notificationOpensClub,
  notificationOpensProfile,
  notificationRequiresRefId,
  formatBadgeCount,
  buildCommentAlsoTargets,
  buildBadgeNotificationRows,
  notificationOpensBadgeWall,
  notifStaysUnreadOnPanelOpen,
  mergeBadgeNotifs,
} from '../wrotate_test.js';

// ── notificationBody ──────────────────────────────────────────────────────────

describe('notificationBody', () => {
  const ALL_TYPES = [
    'follow', 'follow_request', 'follow_accepted',
    'like', 'comment', 'comment_also', 'comment_like', 'mention',
    'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
    'friend_request', 'friend_accepted',
  ];

  it('uses actor name in every known type', () => {
    ALL_TYPES.forEach(type => {
      const body = notificationBody(type, 'Muge');
      expect(body, `type=${type}`).toContain('Muge');
    });
  });

  it('falls back to "Someone" when actorName is missing', () => {
    ALL_TYPES.forEach(type => {
      expect(notificationBody(type, null)).toContain('Someone');
      expect(notificationBody(type, undefined)).toContain('Someone');
      expect(notificationBody(type, '')).toContain('Someone');
    });
  });

  it('returns empty string for unknown type', () => {
    expect(notificationBody('unknown_type', 'Alice')).toBe('');
    expect(notificationBody('', 'Alice')).toBe('');
  });

  // Exact body text per type
  it('follow — "started following you"', () => {
    expect(notificationBody('follow', 'Steve')).toBe('Steve started following you');
  });
  it('follow_request — "wants to follow you"', () => {
    expect(notificationBody('follow_request', 'Steve')).toBe('Steve wants to follow you');
  });
  it('follow_accepted — "accepted your follow request"', () => {
    expect(notificationBody('follow_accepted', 'Steve')).toBe('Steve accepted your follow request');
  });
  it('like — "liked your post"', () => {
    expect(notificationBody('like', 'Steve')).toBe('Steve liked your post');
  });
  it('comment — "commented on your post"', () => {
    expect(notificationBody('comment', 'Steve')).toBe('Steve commented on your post');
  });
  it('comment_also — "also commented on a post..."', () => {
    const body = notificationBody('comment_also', 'Steve');
    expect(body).toContain('Steve');
    expect(body).toContain('also commented');
  });
  it('comment_like — "liked your comment"', () => {
    expect(notificationBody('comment_like', 'Steve')).toBe('Steve liked your comment');
  });
  // A mention can come from a comment OR a post caption (both write ref_id = log id),
  // and the row has no way to tell them apart — so the copy stays surface-neutral.
  it('mention — "mentioned you"', () => {
    expect(notificationBody('mention', 'Steve')).toBe('Steve mentioned you');
  });
  it('club_join_request — "wants to join your club"', () => {
    expect(notificationBody('club_join_request', 'Steve')).toBe('Steve wants to join your club');
  });
  it('club_join_accepted — "approved your club request"', () => {
    expect(notificationBody('club_join_accepted', 'Steve')).toBe('Steve approved your club request');
  });
  it('club_invite — "invited you to join a club"', () => {
    expect(notificationBody('club_invite', 'Steve')).toBe('Steve invited you to join a club');
  });
  it('club_promoted — "made you an owner of a club"', () => {
    expect(notificationBody('club_promoted', 'Steve')).toBe('Steve made you an owner of a club');
  });

  // Friend types
  it('friend_request — "wants to be close friends"', () => {
    expect(notificationBody('friend_request', 'Muge')).toBe('Muge wants to be close friends');
  });
  it('friend_accepted — "You and X are now close friends"', () => {
    expect(notificationBody('friend_accepted', 'Muge')).toBe('You and Muge are now close friends');
  });

  it('all 14 active types produce non-empty body', () => {
    ALL_TYPES.forEach(type => {
      expect(notificationBody(type, 'X'), `type=${type}`).not.toBe('');
    });
  });
});

// ── notificationIsActionable ──────────────────────────────────────────────────

describe('notificationIsActionable', () => {
  it('follow_request is actionable', () => {
    expect(notificationIsActionable('follow_request')).toBe(true);
  });
  it('club_join_request is actionable', () => {
    expect(notificationIsActionable('club_join_request')).toBe(true);
  });
  it('club_invite is actionable', () => {
    expect(notificationIsActionable('club_invite')).toBe(true);
  });

  // Non-actionable types must NOT be protected from auto-read
  it('follow is NOT actionable', () => {
    expect(notificationIsActionable('follow')).toBe(false);
  });
  it('follow_accepted is NOT actionable', () => {
    expect(notificationIsActionable('follow_accepted')).toBe(false);
  });
  it('like is NOT actionable', () => {
    expect(notificationIsActionable('like')).toBe(false);
  });
  it('comment is NOT actionable', () => {
    expect(notificationIsActionable('comment')).toBe(false);
  });
  it('comment_also is NOT actionable', () => {
    expect(notificationIsActionable('comment_also')).toBe(false);
  });
  it('comment_like is NOT actionable', () => {
    expect(notificationIsActionable('comment_like')).toBe(false);
  });
  it('mention is NOT actionable', () => {
    expect(notificationIsActionable('mention')).toBe(false);
  });
  it('club_join_accepted is NOT actionable', () => {
    expect(notificationIsActionable('club_join_accepted')).toBe(false);
  });
  it('club_promoted is NOT actionable', () => {
    expect(notificationIsActionable('club_promoted')).toBe(false);
  });
  // Friend types
  it('friend_request IS actionable (has Accept/Decline)', () => {
    expect(notificationIsActionable('friend_request')).toBe(true);
  });
  it('friend_accepted is NOT actionable', () => {
    expect(notificationIsActionable('friend_accepted')).toBe(false);
  });

  it('exactly 4 types are actionable across all 14 active types', () => {
    const ALL_TYPES = [
      'follow', 'follow_request', 'follow_accepted',
      'like', 'comment', 'comment_also', 'comment_like', 'mention',
      'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
      'friend_request', 'friend_accepted',
    ];
    const actionable = ALL_TYPES.filter(notificationIsActionable);
    expect(actionable).toHaveLength(4);
    expect(actionable).toContain('follow_request');
    expect(actionable).toContain('club_join_request');
    expect(actionable).toContain('club_invite');
    expect(actionable).toContain('friend_request');
  });
});

// ── notificationScrollsToPost ─────────────────────────────────────────────────

describe('notificationScrollsToPost', () => {
  it('like scrolls to post', () => expect(notificationScrollsToPost('like')).toBe(true));
  it('comment scrolls to post', () => expect(notificationScrollsToPost('comment')).toBe(true));
  it('comment_also scrolls to post', () => expect(notificationScrollsToPost('comment_also')).toBe(true));
  it('comment_like scrolls to post', () => expect(notificationScrollsToPost('comment_like')).toBe(true));
  it('mention scrolls to post', () => expect(notificationScrollsToPost('mention')).toBe(true));

  it('follow does NOT scroll to post', () => expect(notificationScrollsToPost('follow')).toBe(false));
  it('follow_request does NOT scroll to post', () => expect(notificationScrollsToPost('follow_request')).toBe(false));
  it('club_join_request does NOT scroll to post', () => expect(notificationScrollsToPost('club_join_request')).toBe(false));
  it('club_join_accepted does NOT scroll to post', () => expect(notificationScrollsToPost('club_join_accepted')).toBe(false));
  it('club_invite does NOT scroll to post', () => expect(notificationScrollsToPost('club_invite')).toBe(false));
  it('club_promoted does NOT scroll to post', () => expect(notificationScrollsToPost('club_promoted')).toBe(false));
  it('friend_request does NOT scroll to post', () => expect(notificationScrollsToPost('friend_request')).toBe(false));
  it('friend_accepted does NOT scroll to post', () => expect(notificationScrollsToPost('friend_accepted')).toBe(false));

  it('exactly 5 types scroll to post across all 14 active types', () => {
    const ALL_TYPES = [
      'follow', 'follow_request', 'follow_accepted',
      'like', 'comment', 'comment_also', 'comment_like', 'mention',
      'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
      'friend_request', 'friend_accepted',
    ];
    expect(ALL_TYPES.filter(notificationScrollsToPost)).toHaveLength(5);
  });
});

// ── notificationOpensClub ─────────────────────────────────────────────────────

describe('notificationOpensClub', () => {
  it('club_join_accepted opens club', () => expect(notificationOpensClub('club_join_accepted')).toBe(true));
  it('club_promoted opens club', () => expect(notificationOpensClub('club_promoted')).toBe(true));

  it('club_invite does NOT open club (has action buttons instead)', () => {
    expect(notificationOpensClub('club_invite')).toBe(false);
  });
  it('club_join_request does NOT open club (has action buttons instead)', () => {
    expect(notificationOpensClub('club_join_request')).toBe(false);
  });
  it('like does NOT open club', () => expect(notificationOpensClub('like')).toBe(false));
  it('comment_like does NOT open club', () => expect(notificationOpensClub('comment_like')).toBe(false));
  it('follow does NOT open club', () => expect(notificationOpensClub('follow')).toBe(false));
  it('friend_request does NOT open club', () => expect(notificationOpensClub('friend_request')).toBe(false));
  it('friend_accepted does NOT open club', () => expect(notificationOpensClub('friend_accepted')).toBe(false));
});

// ── notificationOpensProfile ──────────────────────────────────────────────────

describe('notificationOpensProfile', () => {
  it('follow opens profile', () => expect(notificationOpensProfile('follow')).toBe(true));
  it('follow_accepted opens profile', () => expect(notificationOpensProfile('follow_accepted')).toBe(true));
  it('friend_accepted opens profile', () => expect(notificationOpensProfile('friend_accepted')).toBe(true));

  it('follow_request does NOT open profile (has Accept/Decline buttons)', () => {
    expect(notificationOpensProfile('follow_request')).toBe(false);
  });
  it('friend_request does NOT open profile (has Accept/Decline buttons)', () => {
    expect(notificationOpensProfile('friend_request')).toBe(false);
  });
  it('like does NOT open profile', () => expect(notificationOpensProfile('like')).toBe(false));
  it('comment does NOT open profile', () => expect(notificationOpensProfile('comment')).toBe(false));
  it('comment_like does NOT open profile', () => expect(notificationOpensProfile('comment_like')).toBe(false));
  it('mention does NOT open profile', () => expect(notificationOpensProfile('mention')).toBe(false));
  it('club_join_request does NOT open profile', () => expect(notificationOpensProfile('club_join_request')).toBe(false));
  it('club_join_accepted does NOT open profile', () => expect(notificationOpensProfile('club_join_accepted')).toBe(false));

  it('exactly 3 types open profile across all 14 active types', () => {
    const ALL_TYPES = [
      'follow', 'follow_request', 'follow_accepted',
      'like', 'comment', 'comment_also', 'comment_like', 'mention',
      'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
      'friend_request', 'friend_accepted',
    ];
    const openers = ALL_TYPES.filter(notificationOpensProfile);
    expect(openers).toHaveLength(3);
    expect(openers).toContain('follow');
    expect(openers).toContain('follow_accepted');
    expect(openers).toContain('friend_accepted');
  });
});

// ── notificationRequiresRefId ─────────────────────────────────────────────────

describe('notificationRequiresRefId', () => {
  // Feed types — ref_id is the log/post ID
  it('like requires ref_id', () => expect(notificationRequiresRefId('like')).toBe(true));
  it('comment requires ref_id', () => expect(notificationRequiresRefId('comment')).toBe(true));
  it('comment_also requires ref_id', () => expect(notificationRequiresRefId('comment_also')).toBe(true));
  it('comment_like requires ref_id', () => expect(notificationRequiresRefId('comment_like')).toBe(true));
  it('mention requires ref_id', () => expect(notificationRequiresRefId('mention')).toBe(true));

  // Club types — ref_id is the club ID
  it('club_join_request requires ref_id', () => expect(notificationRequiresRefId('club_join_request')).toBe(true));
  it('club_join_accepted requires ref_id', () => expect(notificationRequiresRefId('club_join_accepted')).toBe(true));
  it('club_invite requires ref_id', () => expect(notificationRequiresRefId('club_invite')).toBe(true));
  it('club_promoted requires ref_id', () => expect(notificationRequiresRefId('club_promoted')).toBe(true));

  // Follow types — ref_id is NOT needed
  it('follow does NOT require ref_id', () => expect(notificationRequiresRefId('follow')).toBe(false));
  it('follow_request does NOT require ref_id', () => expect(notificationRequiresRefId('follow_request')).toBe(false));
  it('follow_accepted does NOT require ref_id', () => expect(notificationRequiresRefId('follow_accepted')).toBe(false));

  // Friend types — ref_id is NOT needed (tap opens actor profile via actor_id)
  it('friend_request does NOT require ref_id', () => expect(notificationRequiresRefId('friend_request')).toBe(false));
  it('friend_accepted does NOT require ref_id', () => expect(notificationRequiresRefId('friend_accepted')).toBe(false));

  it('exactly 9 types require ref_id across all 14 active types', () => {
    const ALL_TYPES = [
      'follow', 'follow_request', 'follow_accepted',
      'like', 'comment', 'comment_also', 'comment_like', 'mention',
      'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
      'friend_request', 'friend_accepted',
    ];
    expect(ALL_TYPES.filter(notificationRequiresRefId)).toHaveLength(9);
  });
});

// ── navigation coverage — every type has exactly one nav action ───────────────

describe('notification navigation coverage — every type routes somewhere', () => {
  const ALL_TYPES = [
    'follow', 'follow_request', 'follow_accepted',
    'like', 'comment', 'comment_also', 'comment_like', 'mention',
    'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
    'friend_request', 'friend_accepted',
  ];

  it('every type is handled by exactly one nav category (no gaps, no overlap)', () => {
    ALL_TYPES.forEach(type => {
      const scrolls  = notificationScrollsToPost(type);
      const club     = notificationOpensClub(type);
      const profile  = notificationOpensProfile(type);
      const action   = notificationIsActionable(type);
      const categories = [scrolls, club, profile, action].filter(Boolean).length;
      // Each type must belong to exactly one category
      expect(categories, `type=${type} should have exactly 1 nav category`).toBe(1);
    });
  });

  it('friend_request is actionable (not post, not club, not profile)', () => {
    expect(notificationIsActionable('friend_request')).toBe(true);
    expect(notificationScrollsToPost('friend_request')).toBe(false);
    expect(notificationOpensClub('friend_request')).toBe(false);
    expect(notificationOpensProfile('friend_request')).toBe(false);
  });

  it('friend_accepted routes to profile (not post, not club, not actionable)', () => {
    expect(notificationOpensProfile('friend_accepted')).toBe(true);
    expect(notificationScrollsToPost('friend_accepted')).toBe(false);
    expect(notificationOpensClub('friend_accepted')).toBe(false);
    expect(notificationIsActionable('friend_accepted')).toBe(false);
  });
});

// ── formatBadgeCount ──────────────────────────────────────────────────────────

describe('formatBadgeCount', () => {
  it('returns null when count is 0 (badge hidden)', () => {
    expect(formatBadgeCount(0)).toBeNull();
  });
  it('returns null for negative counts', () => {
    expect(formatBadgeCount(-1)).toBeNull();
    expect(formatBadgeCount(-100)).toBeNull();
  });
  it('returns "1" for count of 1', () => {
    expect(formatBadgeCount(1)).toBe('1');
  });
  it('returns "9" for count of 9', () => {
    expect(formatBadgeCount(9)).toBe('9');
  });
  it('returns "9+" for count of 10', () => {
    expect(formatBadgeCount(10)).toBe('9+');
  });
  it('returns "9+" for large counts', () => {
    expect(formatBadgeCount(100)).toBe('9+');
    expect(formatBadgeCount(999)).toBe('9+');
  });
  it('returns string (not number) for counts 1-9', () => {
    expect(typeof formatBadgeCount(5)).toBe('string');
  });
});

// ── buildCommentAlsoTargets ───────────────────────────────────────────────────

describe('buildCommentAlsoTargets', () => {
  it('includes likers and previous commenters', () => {
    const result = buildCommentAlsoTargets(['u1', 'u2'], ['u3'], 'me', 'owner');
    expect(result).toContain('u1');
    expect(result).toContain('u2');
    expect(result).toContain('u3');
  });

  it('excludes the current commenter', () => {
    const result = buildCommentAlsoTargets(['me', 'u1'], ['u2'], 'me', 'owner');
    expect(result).not.toContain('me');
  });

  it('excludes the post owner (who gets a separate comment notification)', () => {
    const result = buildCommentAlsoTargets(['owner', 'u1'], ['u2'], 'me', 'owner');
    expect(result).not.toContain('owner');
  });

  it('deduplicates users who both liked and commented', () => {
    const result = buildCommentAlsoTargets(['u1', 'u2'], ['u1', 'u3'], 'me', 'owner');
    const u1count = result.filter(id => id === 'u1').length;
    expect(u1count).toBe(1);
  });

  it('returns empty array when everyone is excluded', () => {
    // Only liker is the current user
    expect(buildCommentAlsoTargets(['me'], [], 'me', 'owner')).toHaveLength(0);
  });

  it('returns empty array when there are no likers or commenters', () => {
    expect(buildCommentAlsoTargets([], [], 'me', 'owner')).toHaveLength(0);
  });

  it('handles user who is both liker and commenter — deduplicated and included once', () => {
    const result = buildCommentAlsoTargets(['u1'], ['u1'], 'me', 'owner');
    expect(result).toEqual(['u1']);
  });

  it('excludes current user even if they are in both lists', () => {
    const result = buildCommentAlsoTargets(['me'], ['me'], 'me', 'owner');
    expect(result).toHaveLength(0);
  });

  it('handles post owner who also liked their own post — excluded', () => {
    const result = buildCommentAlsoTargets(['owner', 'u1'], ['owner'], 'me', 'owner');
    expect(result).not.toContain('owner');
    expect(result).toContain('u1');
  });

  it('handles empty liker list with commenters', () => {
    const result = buildCommentAlsoTargets([], ['u1', 'u2'], 'me', 'owner');
    expect(result).toEqual(expect.arrayContaining(['u1', 'u2']));
    expect(result).toHaveLength(2);
  });

  it('handles empty commenter list with likers', () => {
    const result = buildCommentAlsoTargets(['u1', 'u2'], [], 'me', 'owner');
    expect(result).toEqual(expect.arrayContaining(['u1', 'u2']));
    expect(result).toHaveLength(2);
  });

  it('correctly handles large sets', () => {
    const likers     = Array.from({ length: 20 }, (_, i) => `liker${i}`);
    const commenters = Array.from({ length: 10 }, (_, i) => `commenter${i}`);
    const result = buildCommentAlsoTargets(likers, commenters, 'me', 'owner');
    expect(result).toHaveLength(30); // 20 likers + 10 commenters, no overlap
    expect(result).not.toContain('me');
    expect(result).not.toContain('owner');
  });
});

// ── ref_id contract — types that scroll to post also require ref_id ───────────

describe('ref_id contract', () => {
  const ALL_TYPES = [
    'follow', 'follow_request', 'follow_accepted',
    'like', 'comment', 'comment_also', 'comment_like', 'mention',
    'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
    'friend_request', 'friend_accepted',
  ];

  it('every type that scrolls to a post also requires ref_id', () => {
    ALL_TYPES.filter(notificationScrollsToPost).forEach(type => {
      expect(notificationRequiresRefId(type), `${type} scrolls to post but ref_id not required`).toBe(true);
    });
  });

  it('every type that opens a club also requires ref_id', () => {
    ALL_TYPES.filter(notificationOpensClub).forEach(type => {
      expect(notificationRequiresRefId(type), `${type} opens club but ref_id not required`).toBe(true);
    });
  });

  it('follow types do NOT require ref_id', () => {
    ['follow', 'follow_request', 'follow_accepted'].forEach(type => {
      expect(notificationRequiresRefId(type)).toBe(false);
    });
  });

  it('friend types do NOT require ref_id (profile opened via actor_id)', () => {
    ['friend_request', 'friend_accepted'].forEach(type => {
      expect(notificationRequiresRefId(type)).toBe(false);
    });
  });
});

// ── Notification state rendering (Issue #25 fix) ──────────────────────────────
// follow_request and friend_request have three display states:
// pending (default), accepted (_accepted=true), declined (_declined=true)
// The rendering logic in index.html uses these flags to change body text
// and hide action buttons. These tests verify the body text contracts.

describe('notification follow_request state rendering', () => {
  it('pending state shows "wants to follow you"', () => {
    const body = notificationBody('follow_request', 'Alice');
    expect(body).toBe('Alice wants to follow you');
  });

  it('pending follow_request is actionable (shows Accept/Decline)', () => {
    expect(notificationIsActionable('follow_request')).toBe(true);
  });

  it('follow_request body does not contain "accepted" or "declined" in default state', () => {
    const body = notificationBody('follow_request', 'Alice');
    expect(body).not.toContain('accepted');
    expect(body).not.toContain('declined');
  });
});

describe('notification friend_request state rendering', () => {
  it('pending state shows "wants to be close friends"', () => {
    const body = notificationBody('friend_request', 'Bob');
    expect(body).toBe('Bob wants to be close friends');
  });

  it('pending friend_request is actionable (shows Accept/Decline)', () => {
    expect(notificationIsActionable('friend_request')).toBe(true);
  });

  it('friend_accepted shows confirmed friendship text', () => {
    const body = notificationBody('friend_accepted', 'Bob');
    expect(body).toBe('You and Bob are now close friends');
  });

  it('friend_accepted is NOT actionable (no buttons)', () => {
    expect(notificationIsActionable('friend_accepted')).toBe(false);
  });
});

// ── Comment draft preservation pattern (Issue #27 fix) ────────────────────────
// The feed re-render saves comment input values to a map keyed by input ID,
// then restores them after DOM rebuild. This tests the save/restore logic.

describe('comment draft save/restore pattern', () => {
  it('save map captures input values keyed by ID', () => {
    // Simulates the save logic from renderFeed()
    const drafts = {};
    const inputs = [
      { id: 'comment-input-abc', value: 'great watch!' },
      { id: 'comment-input-def', value: '' },
      { id: 'comment-input-ghi', value: 'nice collection' },
    ];
    inputs.forEach(inp => {
      if (inp.value) drafts[inp.id] = inp.value;
    });

    expect(Object.keys(drafts)).toHaveLength(2);
    expect(drafts['comment-input-abc']).toBe('great watch!');
    expect(drafts['comment-input-ghi']).toBe('nice collection');
    expect(drafts['comment-input-def']).toBeUndefined();
  });

  it('restore assigns saved values back to matching inputs', () => {
    const drafts = {
      'comment-input-abc': 'great watch!',
      'comment-input-ghi': 'nice collection',
    };
    // Simulates the restore logic — create mock inputs
    const restored = {};
    Object.entries(drafts).forEach(([id, val]) => {
      restored[id] = val; // In real code: document.getElementById(id).value = val
    });

    expect(restored['comment-input-abc']).toBe('great watch!');
    expect(restored['comment-input-ghi']).toBe('nice collection');
  });

  it('empty inputs are not saved (no wasted storage)', () => {
    const drafts = {};
    const inputs = [
      { id: 'comment-input-1', value: '' },
      { id: 'comment-input-2', value: '' },
    ];
    inputs.forEach(inp => {
      if (inp.value) drafts[inp.id] = inp.value;
    });
    expect(Object.keys(drafts)).toHaveLength(0);
  });

  it('draft with only whitespace is still preserved', () => {
    const drafts = {};
    const inputs = [{ id: 'comment-input-1', value: '   ' }];
    inputs.forEach(inp => {
      if (inp.value) drafts[inp.id] = inp.value;
    });
    // Whitespace is truthy, so it gets saved (user may be typing)
    expect(drafts['comment-input-1']).toBe('   ');
  });
});

describe('badge_earned notifications', () => {
  it('renders the badge name in the body', () => {
    expect(notificationBody('badge_earned', null, { badgeName: 'First Watch' }))
      .toBe('You earned the First Watch badge 🏅');
  });

  it('falls back when the badge name is unknown', () => {
    expect(notificationBody('badge_earned', null, {}))
      .toBe('You earned a new badge 🏅');
  });

  it('builds one self-addressed, actor-less row per badge', () => {
    const rows = buildBadgeNotificationRows(
      [{ ref: 1, name: 'First Watch' }, { ref: 20, name: 'Five in the Box' }],
      'user-123',
    );
    expect(rows).toEqual([
      { user_id: 'user-123', type: 'badge_earned', actor_id: null, ref_id: '1', is_read: false },
      { user_id: 'user-123', type: 'badge_earned', actor_id: null, ref_id: '20', is_read: false },
    ]);
  });

  it('routes badge taps to the badge wall, not posts/clubs/profiles', () => {
    expect(notificationOpensBadgeWall('badge_earned')).toBe(true);
    expect(notificationOpensBadgeWall('follow')).toBe(false);
  });

  // The badge row replaced the red count dot on the profile avatar, so it has to
  // behave like that dot did: it stays lit until the user reaches the badge wall,
  // rather than being wiped by the panel's auto mark-all-read on open.
  it('survives the panel auto mark-all-read; every other type does not', () => {
    expect(notifStaysUnreadOnPanelOpen('badge_earned')).toBe(true);
    for (const t of ['follow', 'like', 'comment', 'mention', 'system',
                     'club_invite', 'friend_request', 'follow_accepted']) {
      expect(notifStaysUnreadOnPanelOpen(t)).toBe(false);
    }
  });

  it('leaves only badge rows unread when the panel auto-marks on open', () => {
    const notifs = [
      { id: 'a', type: 'follow', is_read: false },
      { id: 'b', type: 'badge_earned', is_read: false },
      { id: 'c', type: 'like', is_read: false },
      { id: 'd', type: 'badge_earned', is_read: true },
    ];
    // Mirrors the markAllNotifsRead(includeBadges) filter in index.html.
    const auto = notifs.filter(n => !n.is_read && !notifStaysUnreadOnPanelOpen(n.type));
    expect(auto.map(n => n.id)).toEqual(['a', 'c']);
    const explicit = notifs.filter(n => !n.is_read);
    expect(explicit.map(n => n.id)).toEqual(['a', 'b', 'c']);
  });
});

// The bell fetch is a 30-row recency window. Because badge rows are the
// persistent nudge, an old one has to survive being buried under newer traffic —
// otherwise the indicator dies while the row is still unread in the DB.
describe('mergeBadgeNotifs', () => {
  const recent = [
    { id: 'r1', type: 'follow', created_at: '2026-07-27T10:00:00Z' },
    { id: 'r2', type: 'like',   created_at: '2026-07-26T10:00:00Z' },
  ];

  it('adds an unread badge row that fell outside the recency window', () => {
    const buried = [{ id: 'b1', type: 'badge_earned', is_read: false, created_at: '2026-06-01T10:00:00Z' }];
    const out = mergeBadgeNotifs(recent, buried);
    expect(out.map(n => n.id)).toEqual(['r1', 'r2', 'b1']);
  });

  it('keeps chronological order rather than pinning old badges to the top', () => {
    const buried = [{ id: 'b1', type: 'badge_earned', is_read: false, created_at: '2026-07-26T20:00:00Z' }];
    expect(mergeBadgeNotifs(recent, buried).map(n => n.id)).toEqual(['r1', 'b1', 'r2']);
  });

  it('does not duplicate a badge row already in the window', () => {
    const dup = [{ id: 'r2', type: 'like', created_at: '2026-07-26T10:00:00Z' }];
    expect(mergeBadgeNotifs(recent, dup).map(n => n.id)).toEqual(['r1', 'r2']);
  });

  it('returns the window untouched when the top-up is empty or failed', () => {
    expect(mergeBadgeNotifs(recent, [])).toBe(recent);
    expect(mergeBadgeNotifs(recent, null)).toBe(recent);
    expect(mergeBadgeNotifs(recent, undefined)).toBe(recent);
  });

  it('survives a missing recency window', () => {
    const b = [{ id: 'b1', type: 'badge_earned', created_at: '2026-06-01T10:00:00Z' }];
    expect(mergeBadgeNotifs(null, b).map(n => n.id)).toEqual(['b1']);
    expect(mergeBadgeNotifs(undefined, [])).toEqual([]);
  });
});
