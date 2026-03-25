import { describe, it, expect } from 'vitest';
import { deleteAccountFilters } from '../wrotate_test.js';

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
