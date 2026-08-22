import { describe, it, expect } from 'vitest';
import { groupCommentsByToken } from '../wrotate_test.js';

describe('groupCommentsByToken', () => {
  it('groups by token preserving order and skips soft-deleted rows', () => {
    const rows = [
      { id: '1', token: 'a', name: 'X', body: 'b1', created_at: '2026-08-22T09:00:00Z' },
      { id: '2', token: 'b', name: 'Y', body: 'b2', created_at: '2026-08-22T09:01:00Z' },
      { id: '3', token: 'a', name: 'Z', body: 'b3', created_at: '2026-08-22T09:02:00Z', deleted_at: '2026-08-22T10:00:00Z' },
      { id: '4', token: 'a', name: 'W', body: 'b4', created_at: '2026-08-22T09:03:00Z' },
      null,
    ];
    const g = groupCommentsByToken(rows);
    expect([...g.keys()]).toEqual(['a', 'b']);
    expect(g.get('a').map(r => r.id)).toEqual(['1', '4']);
    expect(g.get('b').map(r => r.id)).toEqual(['2']);
  });
  it('returns an empty map for no rows', () => {
    expect(groupCommentsByToken(null).size).toBe(0);
    expect(groupCommentsByToken([]).size).toBe(0);
  });
});
