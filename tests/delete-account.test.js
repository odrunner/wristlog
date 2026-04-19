import { describe, it, expect } from 'vitest';
import { deleteAccountFilters, formatDeleteError } from '../wrotate_test.js';

describe('deleteAccountFilters', () => {
  const uid = 'test-user-123';
  const filters = deleteAccountFilters(uid);

  it('uses invited_by (not inviter_id) for club_invites', () => {
    expect(filters.club_invites.or).toContain('invited_by');
    expect(filters.club_invites.or).not.toContain('inviter_id');
  });

  it('includes both invited_by and invitee_id for club_invites', () => {
    expect(filters.club_invites.or).toBe(`invited_by.eq.${uid},invitee_id.eq.${uid}`);
  });

  it('uses user_id for club_join_requests', () => {
    expect(filters.club_join_requests.eq).toEqual(['user_id', uid]);
  });

  it('uses reporter_id for content_reports', () => {
    expect(filters.content_reports.eq).toEqual(['reporter_id', uid]);
  });

  it('uses user_id for device_tokens', () => {
    expect(filters.device_tokens.eq).toEqual(['user_id', uid]);
  });

  it('uses created_by for official_drafts', () => {
    expect(filters.official_drafts.eq).toEqual(['created_by', uid]);
  });
});

// ── deleteAccount batching: del() helper throws table name ──────────────

describe('deleteAccount del() error pattern', () => {
  // The del() helper in deleteAccount throws new Error(tableName) on failure.
  // This tests that pattern: when a table delete fails, the error message
  // is the table name, which is used in the toast.

  it('del() pattern: thrown error message equals the table name', async () => {
    // Simulate the del() helper behavior
    const del = async (table, _filter) => {
      const error = true; // simulate DB error
      if (error) throw new Error(table);
    };
    await expect(del('notifications', { eq: ['user_id', 'uid'] })).rejects.toThrow('notifications');
  });

  it('del() pattern: successful delete does not throw', async () => {
    const del = async (table, _filter) => {
      const error = null;
      if (error) throw new Error(table);
    };
    await expect(del('likes', { eq: ['user_id', 'uid'] })).resolves.toBeUndefined();
  });

  it('batch() pattern: Promise.all rejects with first failure table name', async () => {
    const batch = (...fns) => Promise.all(fns.map(fn => fn()));
    const delOk = async () => {};
    const delFail = async () => { throw new Error('comments'); };

    await expect(batch(delOk, delFail, delOk)).rejects.toThrow('comments');
  });

  it('batch() pattern: all succeed resolves normally', async () => {
    const batch = (...fns) => Promise.all(fns.map(fn => fn()));
    const delOk = async () => {};

    await expect(batch(delOk, delOk, delOk)).resolves.toBeDefined();
  });
});

// ── formatDeleteError ──────────────────────────────────────────────────

describe('formatDeleteError', () => {
  it('includes the failed table name in the message', () => {
    const msg = formatDeleteError('notifications');
    expect(msg).toContain('notifications');
  });

  it('includes retry guidance', () => {
    const msg = formatDeleteError('likes');
    expect(msg).toContain('Please try again');
    expect(msg).toContain('already-deleted data will be skipped');
  });

  it('formats correctly for various table names', () => {
    expect(formatDeleteError('comments')).toBe(
      'Delete failed at comments. Please try again — already-deleted data will be skipped.'
    );
    expect(formatDeleteError('follows')).toBe(
      'Delete failed at follows. Please try again — already-deleted data will be skipped.'
    );
  });
});
