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
