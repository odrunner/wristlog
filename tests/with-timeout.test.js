import { describe, it, expect } from 'vitest';
import { withTimeout } from '../wrotate_test.js';

describe('withTimeout', () => {
  it('resolves when promise completes before timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000);
    expect(result).toBe('ok');
  });

  it('rejects when promise takes longer than timeout', async () => {
    const slow = new Promise(resolve => setTimeout(() => resolve('late'), 500));
    await expect(withTimeout(slow, 10)).rejects.toThrow('Query timed out');
  });

  it('passes through rejections from the original promise', async () => {
    const failing = Promise.reject(new Error('network error'));
    await expect(withTimeout(failing, 1000)).rejects.toThrow('network error');
  });

  it('uses 10s default timeout', async () => {
    // Just verify it doesn't throw immediately with a fast promise
    const result = await withTimeout(Promise.resolve(42));
    expect(result).toBe(42);
  });
});
