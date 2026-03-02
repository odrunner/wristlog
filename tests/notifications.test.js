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
} from '../wristlog.js';

// ── notificationBody ──────────────────────────────────────────────────────────

describe('notificationBody', () => {
  const ALL_TYPES = [
    'follow', 'follow_request', 'follow_accepted',
    'like', 'comment', 'comment_also', 'mention',
    'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
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
  it('like — "liked your wear log"', () => {
    expect(notificationBody('like', 'Steve')).toBe('Steve liked your wear log');
  });
  it('comment — "commented on your wear log"', () => {
    expect(notificationBody('comment', 'Steve')).toBe('Steve commented on your wear log');
  });
  it('comment_also — "also commented on a post..."', () => {
    const body = notificationBody('comment_also', 'Steve');
    expect(body).toContain('Steve');
    expect(body).toContain('also commented');
  });
  it('mention — "mentioned you in a comment"', () => {
    expect(notificationBody('mention', 'Steve')).toBe('Steve mentioned you in a comment');
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

  it('all 11 types produce non-empty body', () => {
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
  it('mention is NOT actionable', () => {
    expect(notificationIsActionable('mention')).toBe(false);
  });
  it('club_join_accepted is NOT actionable', () => {
    expect(notificationIsActionable('club_join_accepted')).toBe(false);
  });
  it('club_promoted is NOT actionable', () => {
    expect(notificationIsActionable('club_promoted')).toBe(false);
  });

  it('exactly 3 types are actionable', () => {
    const ALL_TYPES = [
      'follow', 'follow_request', 'follow_accepted',
      'like', 'comment', 'comment_also', 'mention',
      'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
    ];
    const actionable = ALL_TYPES.filter(notificationIsActionable);
    expect(actionable).toHaveLength(3);
    expect(actionable).toContain('follow_request');
    expect(actionable).toContain('club_join_request');
    expect(actionable).toContain('club_invite');
  });
});

// ── notificationScrollsToPost ─────────────────────────────────────────────────

describe('notificationScrollsToPost', () => {
  it('like scrolls to post', () => expect(notificationScrollsToPost('like')).toBe(true));
  it('comment scrolls to post', () => expect(notificationScrollsToPost('comment')).toBe(true));
  it('comment_also scrolls to post', () => expect(notificationScrollsToPost('comment_also')).toBe(true));
  it('mention scrolls to post', () => expect(notificationScrollsToPost('mention')).toBe(true));

  it('follow does NOT scroll to post', () => expect(notificationScrollsToPost('follow')).toBe(false));
  it('follow_request does NOT scroll to post', () => expect(notificationScrollsToPost('follow_request')).toBe(false));
  it('club_join_request does NOT scroll to post', () => expect(notificationScrollsToPost('club_join_request')).toBe(false));
  it('club_join_accepted does NOT scroll to post', () => expect(notificationScrollsToPost('club_join_accepted')).toBe(false));
  it('club_invite does NOT scroll to post', () => expect(notificationScrollsToPost('club_invite')).toBe(false));
  it('club_promoted does NOT scroll to post', () => expect(notificationScrollsToPost('club_promoted')).toBe(false));

  it('exactly 4 types scroll to post', () => {
    const ALL_TYPES = [
      'follow', 'follow_request', 'follow_accepted',
      'like', 'comment', 'comment_also', 'mention',
      'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
    ];
    expect(ALL_TYPES.filter(notificationScrollsToPost)).toHaveLength(4);
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
  it('follow does NOT open club', () => expect(notificationOpensClub('follow')).toBe(false));
});

// ── notificationOpensProfile ──────────────────────────────────────────────────

describe('notificationOpensProfile', () => {
  it('follow opens profile', () => expect(notificationOpensProfile('follow')).toBe(true));
  it('follow_accepted opens profile', () => expect(notificationOpensProfile('follow_accepted')).toBe(true));

  it('follow_request does NOT open profile (has Accept/Decline buttons)', () => {
    expect(notificationOpensProfile('follow_request')).toBe(false);
  });
  it('like does NOT open profile', () => expect(notificationOpensProfile('like')).toBe(false));
  it('comment does NOT open profile', () => expect(notificationOpensProfile('comment')).toBe(false));
  it('mention does NOT open profile', () => expect(notificationOpensProfile('mention')).toBe(false));
});

// ── notificationRequiresRefId ─────────────────────────────────────────────────

describe('notificationRequiresRefId', () => {
  // Feed types — ref_id is the log/post ID
  it('like requires ref_id', () => expect(notificationRequiresRefId('like')).toBe(true));
  it('comment requires ref_id', () => expect(notificationRequiresRefId('comment')).toBe(true));
  it('comment_also requires ref_id', () => expect(notificationRequiresRefId('comment_also')).toBe(true));
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

  it('exactly 8 types require ref_id', () => {
    const ALL_TYPES = [
      'follow', 'follow_request', 'follow_accepted',
      'like', 'comment', 'comment_also', 'mention',
      'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
    ];
    expect(ALL_TYPES.filter(notificationRequiresRefId)).toHaveLength(8);
  });
});

// ── navigation coverage — every type has exactly one nav action ───────────────

describe('notification navigation coverage — every type routes somewhere', () => {
  const ALL_TYPES = [
    'follow', 'follow_request', 'follow_accepted',
    'like', 'comment', 'comment_also', 'mention',
    'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
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
  it('every type that scrolls to a post also requires ref_id', () => {
    const ALL_TYPES = [
      'follow', 'follow_request', 'follow_accepted',
      'like', 'comment', 'comment_also', 'mention',
      'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
    ];
    ALL_TYPES.filter(notificationScrollsToPost).forEach(type => {
      expect(notificationRequiresRefId(type), `${type} scrolls to post but ref_id not required`).toBe(true);
    });
  });

  it('every type that opens a club also requires ref_id', () => {
    const ALL_TYPES = [
      'follow', 'follow_request', 'follow_accepted',
      'like', 'comment', 'comment_also', 'mention',
      'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
    ];
    ALL_TYPES.filter(notificationOpensClub).forEach(type => {
      expect(notificationRequiresRefId(type), `${type} opens club but ref_id not required`).toBe(true);
    });
  });

  it('follow types do NOT require ref_id', () => {
    ['follow', 'follow_request', 'follow_accepted'].forEach(type => {
      expect(notificationRequiresRefId(type)).toBe(false);
    });
  });
});
