import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// Remove a follower (2026-08-31): on your own Followers list each row carries a
// Remove control. Removing deletes the follows row (them → you) with no
// notification; a profile that approves its followers then needs a fresh
// request from them. The re-follow shortcuts that assumed "accepted once,
// accepted forever" must route through the privacy rule or the kick is moot.

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function fnBody(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start === -1) start = html.indexOf(`function ${name}(`);
  if (start === -1) return '';
  return html.slice(start, html.indexOf('\n}', start));
}

describe('Followers list — Remove control', () => {
  it('own followers list renders a Remove control, others\' lists do not', () => {
    const fn = fnBody('openFollowersModal');
    expect(fn).toContain('currentUser.id');
    expect(fn).toContain('removable');
  });

  it('userCardHtml only emits the Remove button when asked', () => {
    const fn = fnBody('userCardHtml');
    expect(fn).toContain('confirmRemoveFollower(');
    expect(fn).toMatch(/removable\s*\?/);
  });

  it('confirmRemoveFollower arms first and calls removeFollower on the second tap', () => {
    const fn = fnBody('confirmRemoveFollower');
    expect(fn).toContain('dataset.confirming');
    expect(fn).toContain("'Remove?'");
    expect(fn).toContain('removeFollower(');
  });

  it('removeFollower deletes exactly the follower → me row and sends no notification', () => {
    const fn = fnBody('removeFollower');
    expect(fn).toMatch(/from\('follows'\)\.delete\(\)[\s\S]*\.eq\('follower_id', userId\)[\s\S]*\.eq\('following_id', currentUser\.id\)/);
    expect(fn).not.toContain("from('notifications')");
  });

  it('removeFollower breaks a close friendship (mutual follow is gone)', () => {
    const fn = fnBody('removeFollower');
    expect(fn).toContain("from('friend_requests').delete()");
    expect(fn).toContain('friendships.delete(userId)');
  });
});

describe('Re-follow after unfollow honours privacy', () => {
  it('confirmUnfollow does not rewire the button to a direct followUser', () => {
    const fn = fnBody('confirmUnfollow');
    expect(fn).not.toContain('followUser(userId, this)');
    expect(fn).toContain('followByPrivacy(userId, this)');
  });

  it('followByPrivacy looks the profile up and routes through followNeedsRequest', () => {
    const fn = fnBody('followByPrivacy');
    expect(fn).toContain("select('profile_privacy')");
    expect(fn).toContain('followNeedsRequest(');
    expect(fn).toContain('sendFollowRequest(userId, btn)');
    expect(fn).toContain('followUser(userId, btn)');
  });
});
