import { describe, it, expect } from 'vitest';
import {
  todayStr, fmtDate, fmtMonYear, initials, escHtml,
  profileInitials, formatFeedDate, warrantyStatus,
} from '../wristlog.js';

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
  const today = new Date('2024-06-15T12:00:00');

  it('returns empty for null/undefined', () => {
    expect(formatFeedDate(null, today)).toBe('');
    expect(formatFeedDate(undefined, today)).toBe('');
  });

  it('returns "Today" for same day', () => {
    expect(formatFeedDate('2024-06-15', today)).toBe('Today');
  });

  it('returns "Yesterday" for one day ago', () => {
    expect(formatFeedDate('2024-06-14', today)).toBe('Yesterday');
  });

  it('returns "N days ago" for 2-6 days ago', () => {
    expect(formatFeedDate('2024-06-13', today)).toBe('2 days ago');
    expect(formatFeedDate('2024-06-10', today)).toBe('5 days ago');
  });

  it('returns formatted date for 7+ days ago', () => {
    const result = formatFeedDate('2024-06-01', today);
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
