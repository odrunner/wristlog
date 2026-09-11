// The one-shot OS notification dialog (2.6). 'dialog' only after the user acted on a quiet
// (provisional) notification; 'card' = the one-time benefit card at the next wear log / kept
// reading while delivery is still quiet (2026-09-11); null otherwise. Replaces the 2.3 primer
// gate (shouldShowPushPrimer) and the tap-only rule (shouldDeferredPushAsk).
import { describe, it, expect } from 'vitest';
import { deferredPushAskMode } from '../wrotate_test.js';
const base = { authStatus: 'provisional', openedFromPush: false, iosVersion: '2.6', asked: false, cardSeen: false };
describe('deferredPushAskMode', () => {
  it('opened from a quiet notification → spend the dialog directly', () => {
    expect(deferredPushAskMode({ ...base, openedFromPush: true })).toBe('dialog');
    expect(deferredPushAskMode({ ...base, openedFromPush: true, cardSeen: true })).toBe('dialog');
    expect(deferredPushAskMode({ ...base, openedFromPush: true, iosVersion: '2.10' })).toBe('dialog');
  });
  it('otherwise the benefit card, once', () => {
    expect(deferredPushAskMode(base)).toBe('card');
    expect(deferredPushAskMode({ ...base, cardSeen: true })).toBe(null);
  });
  it('never once the dialog has been spent', () => {
    expect(deferredPushAskMode({ ...base, asked: true })).toBe(null);
    expect(deferredPushAskMode({ ...base, asked: true, openedFromPush: true })).toBe(null);
  });
  it('only while provisional', () => {
    for (const s of ['authorized', 'denied', 'notDetermined', undefined]) {
      expect(deferredPushAskMode({ ...base, authStatus: s })).toBe(null);
      expect(deferredPushAskMode({ ...base, authStatus: s, openedFromPush: true })).toBe(null);
    }
  });
  it('only on 2.6+', () => {
    expect(deferredPushAskMode({ ...base, iosVersion: '2.5' })).toBe(null);
    expect(deferredPushAskMode({ ...base, iosVersion: '2.5', openedFromPush: true })).toBe(null);
    expect(deferredPushAskMode({ ...base, iosVersion: undefined })).toBe(null);
  });
});
