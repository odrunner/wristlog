import { describe, it, expect, afterEach } from 'vitest';
import { nativeAtLeast, nativePlatform } from '../wrotate_test.js';

// Platform-neutral capability gate for the Android port (Plan 2, Task 1).
// nativeAtLeast reads _nativeAppVersion, falling back to _iosAppVersion so
// existing iOS builds keep passing with no native change; nativePlatform
// labels the running shell.
describe('nativeAtLeast', () => {
  afterEach(() => { delete globalThis.window; });

  it('is true when _nativeAppVersion meets the floor', () => {
    globalThis.window = { _nativeAppVersion: '2.10' };
    expect(nativeAtLeast('2.3')).toBe(true);
  });

  it('is false when _nativeAppVersion is below the floor', () => {
    globalThis.window = { _nativeAppVersion: '2.1' };
    expect(nativeAtLeast('2.3')).toBe(false);
  });

  it('falls back to _iosAppVersion when _nativeAppVersion is unset', () => {
    globalThis.window = { _iosAppVersion: '2.3' };
    expect(nativeAtLeast('2.3')).toBe(true);
  });

  it('is false when neither version is set', () => {
    globalThis.window = {};
    expect(nativeAtLeast('2.3')).toBe(false);
  });
});

describe('nativePlatform', () => {
  afterEach(() => { delete globalThis.window; });

  it('returns the explicit _nativePlatform when set', () => {
    globalThis.window = { _nativePlatform: 'android' };
    expect(nativePlatform()).toBe('android');
  });

  it('infers ios when only _iosAppVersion is set', () => {
    globalThis.window = { _iosAppVersion: '2.10' };
    expect(nativePlatform()).toBe('ios');
  });

  it('returns web when nothing native is set', () => {
    globalThis.window = {};
    expect(nativePlatform()).toBe('web');
  });
});
