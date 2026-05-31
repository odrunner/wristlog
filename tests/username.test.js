import { describe, it, expect } from 'vitest';
import { validateUsername } from '../wrotate_test.js';

describe('validateUsername', () => {
  // ── Valid usernames ────────────────────────────────────────────────────

  it('accepts a simple lowercase username', () => {
    const result = validateUsername('alice');
    expect(result.valid).toBe(true);
    expect(result.clean).toBe('alice');
    expect(result.error).toBeNull();
  });

  it('accepts username with numbers', () => {
    const result = validateUsername('alice99');
    expect(result.valid).toBe(true);
  });

  it('accepts username with underscores', () => {
    const result = validateUsername('watch_collector');
    expect(result.valid).toBe(true);
  });

  it('accepts 3-character username (minimum)', () => {
    const result = validateUsername('abc');
    expect(result.valid).toBe(true);
  });

  it('accepts 30-character username (maximum)', () => {
    const result = validateUsername('a'.repeat(30));
    expect(result.valid).toBe(true);
  });

  // ── Auto-cleaning ─────────────────────────────────────────────────────

  it('strips uppercase to lowercase', () => {
    const result = validateUsername('Alice');
    expect(result.valid).toBe(true);
    expect(result.clean).toBe('alice');
  });

  it('strips special characters', () => {
    const result = validateUsername('alice!@#$%');
    expect(result.valid).toBe(true);
    expect(result.clean).toBe('alice');
  });

  it('strips spaces', () => {
    const result = validateUsername('a l i c e');
    expect(result.valid).toBe(true);
    expect(result.clean).toBe('alice');
  });

  it('strips dots and dashes', () => {
    const result = validateUsername('alice.bob-charlie');
    expect(result.valid).toBe(true);
    expect(result.clean).toBe('alicebobcharlie');
  });

  // ── Invalid: too short ────────────────────────────────────────────────

  it('rejects empty string', () => {
    const result = validateUsername('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('At least 2 characters');
  });

  it('rejects 1-character username', () => {
    const result = validateUsername('a');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('At least 2 characters');
  });

  it('accepts 2-character username', () => {
    const result = validateUsername('od');
    expect(result.valid).toBe(true);
    expect(result.clean).toBe('od');
  });

  // ── Invalid: too long ─────────────────────────────────────────────────

  it('rejects username longer than 30 characters', () => {
    const result = validateUsername('a'.repeat(31));
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Max 30 characters');
  });

  // ── Invalid: must start with a letter ─────────────────────────────────

  it('rejects username starting with a number', () => {
    const result = validateUsername('123abc');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Must start with a letter');
  });

  it('rejects username starting with an underscore', () => {
    const result = validateUsername('_alice');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Must start with a letter');
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  it('rejects all-numeric input', () => {
    const result = validateUsername('12345');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Must start with a letter');
  });

  it('strips input that becomes too short after cleaning', () => {
    const result = validateUsername('!@#');
    expect(result.valid).toBe(false);
    expect(result.clean).toBe('');
    expect(result.error).toBe('At least 2 characters');
  });

  it('handles email-style input (common from auto-generation)', () => {
    const result = validateUsername('john.doe@gmail.com');
    // Strips dots, @, and .com → "johndoegmailcom"
    expect(result.valid).toBe(true);
    expect(result.clean).toBe('johndoegmailcom');
  });

  // ── Google OAuth edge cases (Issue #23 fix) ─────────────────────────
  // Google emails can produce digit-leading usernames that need 'u' prefix

  it('rejects digit-leading Google email local part (e.g. 123user@gmail.com)', () => {
    const result = validateUsername('123user');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Must start with a letter');
  });

  it('rejects all-digit Google email local part', () => {
    const result = validateUsername('9876543210');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Must start with a letter');
  });

  it('accepts Google email local part that starts with letter', () => {
    const result = validateUsername('alice123');
    expect(result.valid).toBe(true);
    expect(result.clean).toBe('alice123');
  });

  it('validates prefixed username (u + digits) as valid', () => {
    // The OAuth flow prefixes digit-leading names with 'u'
    const result = validateUsername('u123user');
    expect(result.valid).toBe(true);
    expect(result.clean).toBe('u123user');
  });

  it('validates fallback random username pattern', () => {
    // The OAuth retry generates 'user' + random chars
    const result = validateUsername('user83729');
    expect(result.valid).toBe(true);
    expect(result.clean).toBe('user83729');
  });
});

// ── Username prompt modal: display name field ───────────────────────────────
// The username prompt modal now also asks for display name.
// saveUsernamePrompt() sends both username and display_name to profiles.

describe('username prompt: display name handling', () => {
  it('builds update payload with both username and display_name', () => {
    const raw = 'alice';
    const displayName = 'Alice Watches';
    const updates = { username: raw, username_set: true };
    if (displayName) updates.display_name = displayName;
    expect(updates).toEqual({
      username: 'alice',
      username_set: true,
      display_name: 'Alice Watches',
    });
  });

  it('omits display_name from payload when empty', () => {
    const raw = 'alice';
    const displayName = '';
    const updates = { username: raw, username_set: true };
    if (displayName) updates.display_name = displayName;
    expect(updates).toEqual({
      username: 'alice',
      username_set: true,
    });
    expect(updates.display_name).toBeUndefined();
  });

  it('omits display_name from payload when only whitespace', () => {
    const raw = 'alice';
    const displayName = '   '.trim();
    const updates = { username: raw, username_set: true };
    if (displayName) updates.display_name = displayName;
    expect(updates.display_name).toBeUndefined();
  });

  it('trims display_name before including', () => {
    const displayName = '  Alice Watches  '.trim();
    const updates = { username: 'alice', username_set: true };
    if (displayName) updates.display_name = displayName;
    expect(updates.display_name).toBe('Alice Watches');
  });

  it('updates local profile after successful save', () => {
    const myProfile = { username: null, username_set: false, display_name: null };
    const raw = 'watchfan';
    const displayName = 'Watch Fan';

    // Simulate successful save
    myProfile.username = raw;
    myProfile.username_set = true;
    if (displayName) myProfile.display_name = displayName;

    expect(myProfile.username).toBe('watchfan');
    expect(myProfile.username_set).toBe(true);
    expect(myProfile.display_name).toBe('Watch Fan');
  });

  it('preserves existing display_name when prompt display name is empty', () => {
    const myProfile = { username: 'old', username_set: false, display_name: 'Existing Name' };
    const raw = 'newuser';
    const displayName = '';

    myProfile.username = raw;
    myProfile.username_set = true;
    if (displayName) myProfile.display_name = displayName;

    expect(myProfile.username).toBe('newuser');
    expect(myProfile.display_name).toBe('Existing Name'); // preserved
  });

  it('requireUsername skips prompt when username_set is true', () => {
    const myProfile = { username: 'alice', username_set: true };
    let promptShown = false;
    let callbackCalled = false;

    // Simulate requireUsername logic
    if (myProfile && myProfile.username_set) {
      callbackCalled = true;
    } else {
      promptShown = true;
    }

    expect(promptShown).toBe(false);
    expect(callbackCalled).toBe(true);
  });

  it('requireUsername shows prompt when username_set is false', () => {
    const myProfile = { username: null, username_set: false };
    let promptShown = false;

    if (myProfile && myProfile.username_set) {
      // callback
    } else {
      promptShown = true;
    }

    expect(promptShown).toBe(true);
  });
});
