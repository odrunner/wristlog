import { describe, it, expect } from 'vitest';
import { canDeleteComment } from '../wrotate_test.js';

// A user can delete a comment if they wrote it, OR if they own the post it's on
// (Instagram/Strava model). See docs/superpowers/specs/2026-05-31-delete-comment-design.md

describe('canDeleteComment', () => {
  const me = 'user-1';
  const other = 'user-2';

  it('lets a user delete their own comment on someone else\'s post', () => {
    const comment = { user_id: me };
    const post = { user_id: other };
    expect(canDeleteComment(comment, post, me)).toBe(true);
  });

  it('lets the post owner delete another user\'s comment on their post', () => {
    const comment = { user_id: other };
    const post = { user_id: me };
    expect(canDeleteComment(comment, post, me)).toBe(true);
  });

  it('lets the post owner delete their own comment on their own post', () => {
    const comment = { user_id: me };
    const post = { user_id: me };
    expect(canDeleteComment(comment, post, me)).toBe(true);
  });

  it('does not let a user delete someone else\'s comment on someone else\'s post', () => {
    const comment = { user_id: other };
    const post = { user_id: other };
    expect(canDeleteComment(comment, post, me)).toBe(false);
  });

  it('returns false when there is no logged-in user', () => {
    const comment = { user_id: me };
    const post = { user_id: me };
    expect(canDeleteComment(comment, post, null)).toBe(false);
    expect(canDeleteComment(comment, post, undefined)).toBe(false);
  });

  it('returns false for missing comment or post', () => {
    expect(canDeleteComment(null, { user_id: me }, me)).toBe(false);
    expect(canDeleteComment({ user_id: me }, null, me)).toBe(false);
  });
});
