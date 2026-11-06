import { describe, it, expect } from 'vitest';
import { dmValidateBody, dmInboxToState, dmGroupMessages, dmErrorText, dmCanMessage } from '../wrotate_test.js';

describe('dmValidateBody', () => {
  it('rejects empty and whitespace', () => {
    expect(dmValidateBody('', false)).toEqual({ ok: false, error: 'empty' });
    expect(dmValidateBody('   \n', false)).toEqual({ ok: false, error: 'empty' });
    expect(dmValidateBody(null, false)).toEqual({ ok: false, error: 'empty' });
  });
  it('allows empty when a log is attached', () => {
    expect(dmValidateBody('  ', true)).toEqual({ ok: true, body: '' });
  });
  it('trims and accepts exactly 2000, rejects 2001', () => {
    expect(dmValidateBody('  hi ', false)).toEqual({ ok: true, body: 'hi' });
    expect(dmValidateBody('a'.repeat(2000), false).ok).toBe(true);
    expect(dmValidateBody('a'.repeat(2001), false)).toEqual({ ok: false, error: 'too_long' });
  });
});

describe('dmInboxToState', () => {
  it('defaults null / missing', () => {
    const empty = { unread: 0, requestsIn: [], requestsOut: [], conversations: [] };
    expect(dmInboxToState(null)).toEqual(empty);
    expect(dmInboxToState({ unread: null, requests_in: null, requests_out: 'x', conversations: undefined })).toEqual(empty);
  });
  it('defaults a null/missing first and sorts conversations newest first', () => {
    const s = dmInboxToState({
      unread: 3,
      requests_in: [{ id: 'a', first: null }, { id: 'b' }, { id: 'c', first: { body: 'yo' } }],
      requests_out: [{ id: 'o' }],
      conversations: [
        { id: 'old', last_message_at: '2026-01-01T00:00:00Z' },
        { id: 'new', last_message_at: '2026-03-01T00:00:00Z' },
        { id: 'none' },
      ],
    });
    expect(s.unread).toBe(3);
    expect(s.requestsIn.map((x) => x.first)).toEqual([null, null, { body: 'yo' }]);
    expect(s.requestsOut).toEqual([{ id: 'o' }]);
    expect(s.conversations.map((c) => c.id)).toEqual(['new', 'old', 'none']);
  });
});

describe('dmGroupMessages', () => {
  const L = (y, mo, d, h) => new Date(y, mo - 1, d, h, 0, 0).toISOString();
  it('empty list', () => {
    expect(dmGroupMessages([], 'me')).toEqual([]);
    expect(dmGroupMessages(null, 'me')).toEqual([]);
  });
  it('groups by day, sorts ascending, marks own, drops bad dates', () => {
    const out = dmGroupMessages([
      { id: '3', sender_id: 'me', body: 'c', created_at: L(2026, 2, 2, 10) },
      { id: '1', sender_id: 'u', body: 'a', shared_log_id: 'L1', created_at: L(2026, 2, 1, 9) },
      { id: '2', sender_id: 'me', created_at: L(2026, 2, 1, 23) },
      { id: 'x', sender_id: 'u', body: 'bad', created_at: 'nope' },
      null,
    ], 'me');
    expect(out.map((i) => i.kind)).toEqual(['day', 'msg', 'msg', 'day', 'msg']);
    expect(out[0].date).toBe('2026-02-01');
    expect(out[3].date).toBe('2026-02-02');
    expect(out[1]).toMatchObject({ id: '1', own: false, body: 'a', sharedLogId: 'L1', senderId: 'u' });
    expect(out[2]).toMatchObject({ id: '2', own: true, body: '', sharedLogId: null });
  });
});

describe('dmErrorText', () => {
  it('maps every code', () => {
    expect(dmErrorText('dm_blocked')).toBe("Couldn't send.");
    expect(dmErrorText('dm_not_allowed')).toBe("They aren't accepting message requests.");
    expect(dmErrorText('dm_rate_limited')).toBe("You're sending too fast. Try again later.");
    expect(dmErrorText('dm_pending')).toBe('Your request is waiting for a reply.');
    expect(dmErrorText('dm_declined')).toBe('This request was declined.');
    expect(dmErrorText('dm_bad_body')).toBe('Message is empty or too long.');
    expect(dmErrorText('dm_self')).toBe("You can't message yourself.");
  });
  it('collapses the rest into the default', () => {
    for (const c of ['dm_not_participant', 'dm_suspended', 'dm_not_enabled', 'dm_not_found', 'dm_not_pending', 'dm_bad_log', 'dm_bad_reason', 'weird', undefined]) {
      expect(dmErrorText(c)).toBe("Couldn't send. Try again.");
    }
  });
});

describe('dmCanMessage', () => {
  it('follows dm_privacy', () => {
    expect(dmCanMessage({ dm_privacy: 'everyone' }, false, false)).toBe(true);
    expect(dmCanMessage({ dm_privacy: 'following' }, true, true)).toBe(true);
    expect(dmCanMessage({ dm_privacy: 'following' }, true, false)).toBe(false);
    expect(dmCanMessage({ dm_privacy: 'nobody' }, true, true)).toBe(false);
  });
  it('missing or unknown means everyone', () => {
    expect(dmCanMessage({}, false, false)).toBe(true);
    expect(dmCanMessage(null, false, false)).toBe(true);
    expect(dmCanMessage({ dm_privacy: 'x' }, false, false)).toBe(true);
  });
});
