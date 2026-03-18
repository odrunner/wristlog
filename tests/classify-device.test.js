import { describe, it, expect } from 'vitest';
import { classifyDevice } from '../wrotate_test.js';

describe('classifyDevice', () => {
  it('returns unknown for null/undefined/empty', () => {
    expect(classifyDevice(null)).toBe('unknown');
    expect(classifyDevice(undefined)).toBe('unknown');
    expect(classifyDevice('')).toBe('unknown');
  });

  it('detects iPhone as mobile', () => {
    expect(classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('mobile');
  });

  it('detects Android phone as mobile', () => {
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile')).toBe('mobile');
  });

  it('detects iPod as mobile', () => {
    expect(classifyDevice('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)')).toBe('mobile');
  });

  it('detects BlackBerry as mobile', () => {
    expect(classifyDevice('Mozilla/5.0 (BlackBerry; U; BlackBerry 9900)')).toBe('mobile');
  });

  it('detects Opera Mini as mobile', () => {
    expect(classifyDevice('Opera/9.80 (Android; Opera Mini/7.6) Presto/2.12')).toBe('mobile');
  });

  it('detects iPad as tablet', () => {
    expect(classifyDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('tablet');
  });

  it('detects Android tablet (no Mobile keyword) as tablet', () => {
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 13; SM-X800) AppleWebKit/537.36')).toBe('tablet');
  });

  it('detects desktop Chrome', () => {
    expect(classifyDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')).toBe('desktop');
  });

  it('detects desktop Firefox', () => {
    expect(classifyDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0')).toBe('desktop');
  });
});
