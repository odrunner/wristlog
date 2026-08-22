import { describe, it, expect } from 'vitest';
import { buildRoute } from '../supabase/functions/send-push/lib.ts';
import {
  notificationScrollsToPost,
  notificationOpensClub,
  notificationOpensProfile,
  notificationOpensBadgeWall,
  notificationOpensShareLinks,
} from '../wrotate_test.js';

// Tapping a push must land in the same place as tapping the equivalent row in
// the in-app notification panel. The two routing tables live in different
// languages and different repos-in-one (edge function vs index.html), so this
// pins them together — the whole point of the fix is that a tap stops going
// nowhere, and silent drift here would quietly reintroduce that.

const ALL_TYPES = [
  'follow', 'follow_request', 'follow_accepted',
  'like', 'comment', 'comment_also', 'comment_like', 'mention',
  'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
  'friend_request', 'friend_accepted',
  'badge_earned', 'system', 'share_comment',
];

describe('push route agrees with the in-app panel', () => {
  it('routes to the post exactly when the panel scrolls to the post', () => {
    ALL_TYPES.forEach(type => {
      const isPost = buildRoute(type, 'log-1', 'actor-1').route === 'post';
      expect(isPost, `type=${type}`).toBe(notificationScrollsToPost(type));
    });
  });

  it('routes to a profile exactly when the panel opens a profile', () => {
    ALL_TYPES.forEach(type => {
      const isProfile = buildRoute(type, 'log-1', 'actor-1').route === 'profile';
      expect(isProfile, `type=${type}`).toBe(notificationOpensProfile(type));
    });
  });

  it('routes to a club exactly when the panel opens a club', () => {
    ALL_TYPES.forEach(type => {
      const isClub = buildRoute(type, 'club-1', 'actor-1').route === 'club';
      expect(isClub, `type=${type}`).toBe(notificationOpensClub(type));
    });
  });

  it('routes to the badge wall exactly when the panel does', () => {
    ALL_TYPES.forEach(type => {
      const isBadges = buildRoute(type, null, null).route === 'badges';
      expect(isBadges, `type=${type}`).toBe(notificationOpensBadgeWall(type));
    });
  });

  it('sends the actionable request types to the bell', () => {
    // These have Accept/Decline buttons and no click target in the panel, so the
    // bell is the only place the tap can usefully land.
    ['follow_request', 'friend_request', 'club_invite', 'club_join_request', 'system']
      .forEach(type => {
        expect(buildRoute(type, 'ref-1', 'actor-1'), `type=${type}`)
          .toEqual({ route: 'bell', id: null });
      });
  });

  it('never emits a route without the id it needs', () => {
    ALL_TYPES.forEach(type => {
      // Nothing resolvable to point at — must degrade to the bell, never to a
      // navigation call with an empty argument.
      expect(buildRoute(type, null, null).route, `type=${type}`)
        .toMatch(/^(bell|badges)$/);
    });
  });

  it('an unrecognised future type still lands somewhere', () => {
    expect(buildRoute('some_new_type', 'ref', 'actor')).toEqual({ route: 'bell', id: null });
  });
});

// 2.6: routes the native switch does not know are handed to JS openPushRoute(route, id).
// The two server-side reminder types route here; anything else must still land on the bell.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
describe('openPushRoute (JS fallback for new routes)', () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
  const fn = html.slice(html.indexOf('function openPushRoute(route, id) {'), html.indexOf('\n}\n', html.indexOf('function openPushRoute(route, id) {')));
  it("handles 'track' (log-again banner) and 'measure' (timegrapher, watch preselected)", () => {
    expect(fn).toContain("route === 'track'");
    expect(fn).toContain('maybeShowLogAgainBanner(true, id || null)');
    expect(fn).toContain("route === 'measure'");
    expect(fn).toContain('openMeasureModal()');
  });
  it('falls back to the bell', () => {
    expect(fn).toContain('openNotifPanel()');
  });

  // A share-link comment opens the Shared-links modal in the panel (not a post,
  // profile or club), so the push can only usefully land on the bell.
  it('share_comment opens the Shared-links modal in the panel and goes to the bell on push', () => {
    expect(notificationOpensShareLinks('share_comment')).toBe(true);
    expect(notificationOpensShareLinks('comment')).toBe(false);
    expect(buildRoute('share_comment', 'c1', null)).toEqual({ route: 'bell', id: null });
  });
});
