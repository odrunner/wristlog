// The one-shot OS notification dialog (2.6) is spent only after the user acted on a quiet
// (provisional) notification. Replaces the 2.3 primer gate (shouldShowPushPrimer).
import { describe, it, expect } from 'vitest';
import { shouldDeferredPushAsk } from '../wrotate_test.js';
const ok = { authStatus: 'provisional', openedFromPush: true, iosVersion: '2.6', asked: false };
describe('shouldDeferredPushAsk', () => {
  it('asks once, only on provisional, only when opened from a notification, only on 2.6+', () => {
    expect(shouldDeferredPushAsk(ok)).toBe(true);
    expect(shouldDeferredPushAsk({ ...ok, iosVersion: '2.10' })).toBe(true);
    expect(shouldDeferredPushAsk({ ...ok, authStatus: 'authorized' })).toBe(false);
    expect(shouldDeferredPushAsk({ ...ok, authStatus: 'denied' })).toBe(false);
    expect(shouldDeferredPushAsk({ ...ok, authStatus: 'notDetermined' })).toBe(false);
    expect(shouldDeferredPushAsk({ ...ok, openedFromPush: false })).toBe(false);
    expect(shouldDeferredPushAsk({ ...ok, iosVersion: '2.5' })).toBe(false);
    expect(shouldDeferredPushAsk({ ...ok, iosVersion: undefined })).toBe(false);
    expect(shouldDeferredPushAsk({ ...ok, asked: true })).toBe(false);
  });
});
