import { describe, it, expect } from 'vitest';
import { getMentionQuery, extractMentionedUsernames, renderCommentBody } from '../wristlog.js';

// ── getMentionQuery ───────────────────────────────────────────────────────────

describe('getMentionQuery', () => {
  it('returns empty string immediately after @', () => {
    expect(getMentionQuery('Hello @', 7)).toBe('');
  });

  it('returns partial username being typed', () => {
    expect(getMentionQuery('Hey @jo', 7)).toBe('jo');
  });

  it('returns full username before cursor', () => {
    expect(getMentionQuery('cc @mugedogan', 13)).toBe('mugedogan');
  });

  it('handles dotted usernames like steven.armato', () => {
    expect(getMentionQuery('great @steven.ar', 16)).toBe('steven.ar');
  });

  it('returns full dotted username', () => {
    expect(getMentionQuery('hi @steven.armato', 17)).toBe('steven.armato');
  });

  it('returns null when no @ before cursor', () => {
    expect(getMentionQuery('hello world', 11)).toBeNull();
  });

  it('returns null when @ is followed by a space (mention ended)', () => {
    expect(getMentionQuery('hi @mugedogan ', 14)).toBeNull();
  });

  it('returns null when cursor is before the @', () => {
    expect(getMentionQuery('@mugedogan', 0)).toBeNull();
  });

  it('handles @ in the middle of text', () => {
    expect(getMentionQuery('nice shot @oz', 13)).toBe('oz');
  });

  it('returns null for empty string', () => {
    expect(getMentionQuery('', 0)).toBeNull();
  });

  it('respects cursor position — ignores @ after cursor', () => {
    // cursor at 5, @mention starts at 6 — should return null
    expect(getMentionQuery('hello @muge', 5)).toBeNull();
  });

  it('handles multiple @ signs — uses the one closest to cursor', () => {
    expect(getMentionQuery('cc @oz and @mu', 14)).toBe('mu');
  });

  it('ignores completed mention when cursor is mid-text after a space', () => {
    // "@mugedogan " was completed, then user typed more
    expect(getMentionQuery('@mugedogan nice', 15)).toBeNull();
  });
});

// ── extractMentionedUsernames ────────────────────────────────────────────────

describe('extractMentionedUsernames', () => {
  it('extracts a single username', () => {
    expect(extractMentionedUsernames('hey @mugedogan!')).toEqual(['mugedogan']);
  });

  it('extracts dotted usernames', () => {
    expect(extractMentionedUsernames('nice @steven.armato')).toEqual(['steven.armato']);
  });

  it('extracts multiple usernames', () => {
    const result = extractMentionedUsernames('hey @mugedogan and @ozgur');
    expect(result).toContain('mugedogan');
    expect(result).toContain('ozgur');
    expect(result).toHaveLength(2);
  });

  it('deduplicates repeated mentions', () => {
    const result = extractMentionedUsernames('@mugedogan and @mugedogan again');
    expect(result).toEqual(['mugedogan']);
  });

  it('returns empty array when no mentions', () => {
    expect(extractMentionedUsernames('just a normal comment')).toEqual([]);
  });

  it('returns empty array for null or empty input', () => {
    expect(extractMentionedUsernames(null)).toEqual([]);
    expect(extractMentionedUsernames('')).toEqual([]);
  });

  it('handles mention at end of string', () => {
    expect(extractMentionedUsernames('great photo @ozgur')).toEqual(['ozgur']);
  });

  it('handles mention at start of string', () => {
    expect(extractMentionedUsernames('@ozgur nice watch!')).toEqual(['ozgur']);
  });

  it('handles mixed dotted and plain usernames', () => {
    const result = extractMentionedUsernames('@steven.armato and @ozgur');
    expect(result).toContain('steven.armato');
    expect(result).toContain('ozgur');
    expect(result).toHaveLength(2);
  });
});

// ── renderCommentBody ────────────────────────────────────────────────────────

describe('renderCommentBody', () => {
  it('returns empty string for null/empty body', () => {
    expect(renderCommentBody(null)).toBe('');
    expect(renderCommentBody('')).toBe('');
  });

  it('returns plain text unchanged (no mentions)', () => {
    expect(renderCommentBody('nice watch!')).toBe('nice watch!');
  });

  it('wraps @username in mention-link span', () => {
    const result = renderCommentBody('hey @mugedogan!');
    expect(result).toContain('class="mention-link"');
    expect(result).toContain('@mugedogan');
    expect(result).toContain("onclick=\"viewUserByUsername('mugedogan')\"");
  });

  it('handles dotted username', () => {
    const result = renderCommentBody('cc @steven.armato');
    expect(result).toContain('@steven.armato');
    expect(result).toContain("viewUserByUsername('steven.armato')");
  });

  it('wraps multiple mentions independently', () => {
    const result = renderCommentBody('hey @mugedogan and @ozgur');
    expect(result).toContain("viewUserByUsername('mugedogan')");
    expect(result).toContain("viewUserByUsername('ozgur')");
  });

  it('escapes HTML in non-mention text', () => {
    const result = renderCommentBody('<script>alert(1)</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes HTML before linkifying so injected @ in tags are safe', () => {
    const result = renderCommentBody('<b>@evil</b>');
    expect(result).not.toContain('<b>');
    expect(result).toContain('&lt;b&gt;');
  });

  it('uses custom onClickFn when provided', () => {
    const result = renderCommentBody('@ozgur', 'openProfile');
    expect(result).toContain("openProfile('ozgur')");
  });

  it('does not double-escape ampersands in plain text', () => {
    const result = renderCommentBody('nice & clean');
    expect(result).toBe('nice &amp; clean');
  });
});
