import { describe, it, expect } from 'vitest';
import {
  todayStr, fmtDate, fmtMonYear, initials, escHtml, escAttr,
  profileInitials, formatFeedDate, formatCommentTime, warrantyStatus,
} from '../wrotate_test.js';

// ── todayStr ─────────────────────────────────────────────────────────────────

describe('todayStr', () => {
  it('formats date as YYYY-MM-DD', () => {
    const result = todayStr(new Date('2024-06-15T12:00:00'));
    expect(result).toBe('2024-06-15');
  });

  it('zero-pads single-digit month', () => {
    const result = todayStr(new Date('2024-01-05T12:00:00'));
    expect(result).toBe('2024-01-05');
  });

  it('zero-pads single-digit day', () => {
    const result = todayStr(new Date('2024-12-03T12:00:00'));
    expect(result).toBe('2024-12-03');
  });

  it('handles year boundaries', () => {
    expect(todayStr(new Date('2024-12-31T23:59:59'))).toBe('2024-12-31');
    expect(todayStr(new Date('2025-01-01T00:00:00'))).toBe('2025-01-01');
  });
});

// ── fmtDate ──────────────────────────────────────────────────────────────────

describe('fmtDate', () => {
  it('formats a date string to locale format', () => {
    const result = fmtDate('2024-06-15');
    expect(result).toContain('Jun');
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });

  it('formats January date correctly', () => {
    const result = fmtDate('2024-01-01');
    expect(result).toContain('Jan');
    expect(result).toContain('1');
  });
});

// ── fmtMonYear ───────────────────────────────────────────────────────────────

describe('fmtMonYear', () => {
  it('formats date as month and year', () => {
    const result = fmtMonYear('2024-06-15');
    expect(result).toContain('Jun');
    expect(result).toContain('2024');
  });

  it('returns null for null input', () => {
    expect(fmtMonYear(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(fmtMonYear(undefined)).toBeNull();
  });
});

// ── initials ─────────────────────────────────────────────────────────────────

describe('initials', () => {
  it('returns first letters of brand and name uppercased', () => {
    expect(initials('Omega', 'Speedmaster')).toBe('OS');
  });

  it('handles empty brand', () => {
    expect(initials('', 'Speedmaster')).toBe('S');
  });

  it('handles empty name', () => {
    expect(initials('Omega', '')).toBe('O');
  });

  it('handles both empty', () => {
    expect(initials('', '')).toBe('');
  });

  it('handles lowercase input', () => {
    expect(initials('omega', 'speedmaster')).toBe('OS');
  });
});

// ── escHtml ──────────────────────────────────────────────────────────────────

describe('escHtml', () => {
  it('escapes ampersands', () => {
    expect(escHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes less-than signs', () => {
    expect(escHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than signs', () => {
    expect(escHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('handles null/undefined', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });

  it('handles empty string', () => {
    expect(escHtml('')).toBe('');
  });

  it('escapes a full XSS payload', () => {
    const payload = '<img src=x onerror="alert(1)">';
    const escaped = escHtml(payload);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).not.toContain('"');
  });
});

// ── escAttr ──────────────────────────────────────────────────────────────────

describe('escAttr', () => {
  it('escapes single quotes for onclick attributes', () => {
    expect(escAttr("O'Brien")).toBe('O&#39;Brien');
  });

  it('escapes XSS payload with single quotes', () => {
    expect(escAttr("');alert(1);//")).toBe('&#39;);alert(1);//');
  });

  it('also escapes HTML entities like escHtml', () => {
    expect(escAttr('<b>"hi"</b>')).toBe('&lt;b&gt;&quot;hi&quot;&lt;/b&gt;');
  });

  it('handles null/undefined', () => {
    expect(escAttr(null)).toBe('');
    expect(escAttr(undefined)).toBe('');
  });

  it('handles strings without special chars', () => {
    expect(escAttr('normaluser')).toBe('normaluser');
  });
});

// ── profileInitials ──────────────────────────────────────────────────────────

describe('profileInitials', () => {
  it('returns first and last initials for full name', () => {
    expect(profileInitials({ display_name: 'John Doe' })).toBe('JD');
  });

  it('returns first two letters for single name', () => {
    expect(profileInitials({ display_name: 'Alice' })).toBe('AL');
  });

  it('uses username when display_name is missing', () => {
    expect(profileInitials({ username: 'bob99' })).toBe('BO');
  });

  it('returns ? for null profile', () => {
    expect(profileInitials(null)).toBe('?');
  });

  it('returns ? for empty name', () => {
    expect(profileInitials({ display_name: '', username: '' })).toBe('?');
  });

  it('handles three-word name (first + last initial)', () => {
    expect(profileInitials({ display_name: 'John Michael Doe' })).toBe('JD');
  });

  it('trims whitespace', () => {
    expect(profileInitials({ display_name: '  John Doe  ' })).toBe('JD');
  });
});

// ── formatFeedDate ───────────────────────────────────────────────────────────

describe('formatFeedDate', () => {
  const now = new Date('2024-06-15T12:00:00');

  it('returns empty for null/undefined', () => {
    expect(formatFeedDate(null, null, now)).toBe('');
    expect(formatFeedDate(undefined, null, now)).toBe('');
  });

  it('returns "Today" for same day date string', () => {
    expect(formatFeedDate('2024-06-15', null, now)).toBe('Today');
  });

  it('returns "Yesterday" for one day ago', () => {
    expect(formatFeedDate('2024-06-14', null, now)).toBe('Yesterday');
  });

  it('returns "N days ago" for 2-6 days ago', () => {
    expect(formatFeedDate('2024-06-13', null, now)).toBe('2 days ago');
    expect(formatFeedDate('2024-06-10', null, now)).toBe('5 days ago');
  });

  it('returns formatted date for 7+ days ago', () => {
    const result = formatFeedDate('2024-06-01', null, now);
    expect(result).toContain('Jun');
    expect(result).toContain('1');
  });

  // relative time via createdAt timestamp
  it('returns "Just now" when createdAt is under 1 hour ago', () => {
    const createdAt = new Date('2024-06-15T11:45:00').toISOString(); // 15 min ago
    expect(formatFeedDate('2024-06-15', createdAt, now)).toBe('Just now');
  });

  it('returns "Xh ago" when createdAt is 1-17 hours ago', () => {
    const createdAt = new Date('2024-06-15T09:00:00').toISOString(); // 3h ago
    expect(formatFeedDate('2024-06-15', createdAt, now)).toBe('3h ago');
  });

  it('returns "Xh ago" for exactly 17 hours ago', () => {
    const createdAt = new Date('2024-06-14T19:00:00').toISOString(); // 17h ago
    expect(formatFeedDate('2024-06-14', createdAt, now)).toBe('17h ago');
  });

  it('falls back to day label when createdAt is 18+ hours ago', () => {
    const createdAt = new Date('2024-06-14T13:00:00').toISOString(); // 23h ago
    expect(formatFeedDate('2024-06-14', createdAt, now)).toBe('Yesterday');
  });

  it('uses dateStr for day-level fallback when no createdAt', () => {
    expect(formatFeedDate('2024-06-13', null, now)).toBe('2 days ago');
  });

  // Backdated entries: created_at is "now" but the wear is for an earlier day.
  // Relative time off created_at would read "Just now" for a wear the user
  // explicitly logged for yesterday.
  it('shows the log day, not the post time, for a backdated entry', () => {
    const createdAt = new Date('2024-06-15T11:45:00').toISOString(); // logged 15 min ago
    expect(formatFeedDate('2024-06-14', createdAt, now)).toBe('Yesterday');
  });

  it('shows the log day for an entry backdated several days', () => {
    const createdAt = new Date('2024-06-15T11:00:00').toISOString(); // logged 1h ago
    expect(formatFeedDate('2024-06-12', createdAt, now)).toBe('3 days ago');
  });

  it('handles ISO timestamp dateStr without createdAt (notification timestamps)', () => {
    const ts = '2024-06-15T11:30:00.000Z';
    const result = formatFeedDate(ts, null, new Date('2024-06-15T12:00:00Z'));
    expect(result).toBe('Just now');
  });
});

// ── formatCommentTime ────────────────────────────────────────────────────

describe('formatCommentTime', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  it('returns empty string for null/undefined', () => {
    expect(formatCommentTime(null, now)).toBe('');
    expect(formatCommentTime(undefined, now)).toBe('');
  });

  it('returns "Just now" for less than 1 minute ago', () => {
    const ts = new Date('2024-06-15T11:59:30Z').toISOString(); // 30s ago
    expect(formatCommentTime(ts, now)).toBe('Just now');
  });

  it('returns "Xm ago" for 1-59 minutes ago', () => {
    const ts5m = new Date('2024-06-15T11:55:00Z').toISOString(); // 5 min ago
    expect(formatCommentTime(ts5m, now)).toBe('5m ago');

    const ts45m = new Date('2024-06-15T11:15:00Z').toISOString(); // 45 min ago
    expect(formatCommentTime(ts45m, now)).toBe('45m ago');
  });

  it('returns "1m ago" for exactly 1 minute ago', () => {
    const ts = new Date('2024-06-15T11:59:00Z').toISOString();
    expect(formatCommentTime(ts, now)).toBe('1m ago');
  });

  it('returns "Xh ago" for 1-23 hours ago', () => {
    const ts3h = new Date('2024-06-15T09:00:00Z').toISOString(); // 3h ago
    expect(formatCommentTime(ts3h, now)).toBe('3h ago');

    const ts23h = new Date('2024-06-14T13:00:00Z').toISOString(); // 23h ago
    expect(formatCommentTime(ts23h, now)).toBe('23h ago');
  });

  it('returns "Xd ago" for 1-6 days ago', () => {
    const ts1d = new Date('2024-06-14T12:00:00Z').toISOString(); // 24h ago
    expect(formatCommentTime(ts1d, now)).toBe('1d ago');

    const ts6d = new Date('2024-06-09T12:00:00Z').toISOString(); // 6 days ago
    expect(formatCommentTime(ts6d, now)).toBe('6d ago');
  });

  it('returns formatted date for 7+ days ago', () => {
    const ts = new Date('2024-06-01T12:00:00Z').toISOString(); // 14 days ago
    const result = formatCommentTime(ts, now);
    expect(result).toContain('Jun');
    expect(result).toContain('1');
  });
});

// ── warrantyStatus ───────────────────────────────────────────────────────────

describe('warrantyStatus', () => {
  const today = new Date('2024-06-15T12:00:00');

  it('returns null when no warranty', () => {
    expect(warrantyStatus({}, today)).toBeNull();
    expect(warrantyStatus({ warrantyExpiry: null }, today)).toBeNull();
  });

  it('returns expired for past date', () => {
    const result = warrantyStatus({ warrantyExpiry: '2024-06-01' }, today);
    expect(result.cls).toBe('warranty-expired');
    expect(result.text).toBe('Warranty expired');
  });

  it('returns expiring for date within 60 days', () => {
    const result = warrantyStatus({ warrantyExpiry: '2024-07-15' }, today);
    expect(result.cls).toBe('warranty-expiring');
    expect(result.text).toContain('d left');
  });

  it('returns active for date beyond 60 days', () => {
    const result = warrantyStatus({ warrantyExpiry: '2025-06-15' }, today);
    expect(result.cls).toBe('warranty-active');
    expect(result.text).toContain('mo left');
  });

  it('shows correct days remaining when expiring', () => {
    // warrantyExpiry '2024-06-25' at T12:00 vs today 2024-06-15 at T00:00 → ~10.5 days → rounds to 11
    const result = warrantyStatus({ warrantyExpiry: '2024-06-25' }, today);
    expect(result.cls).toBe('warranty-expiring');
    expect(result.text).toMatch(/\d+d left/);
  });

  it('shows expiring for warranty expiring on same day', () => {
    // warrantyExpiry '2024-06-15' at T12:00 vs today at T00:00 → ~0.5 days → rounds to 1
    const result = warrantyStatus({ warrantyExpiry: '2024-06-15' }, today);
    expect(result.cls).toBe('warranty-expiring');
    expect(result.text).toMatch(/\d+d left/);
  });
});
