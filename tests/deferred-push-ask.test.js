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

// Experiment push_ask_repeat (2026-11-26): the card may return, up to three times, 14 days apart.
describe('deferredPushAskMode — repeat (push_ask_repeat treatment)', () => {
  const DAY = 86400000, now = 1800000000000;
  const rep = { ...base, repeat: true, now };
  it('shows the card even when the old one-time card was already seen', () => {
    expect(deferredPushAskMode({ ...rep, cardSeen: true })).toBe('card');
    expect(deferredPushAskMode({ ...rep, cardSeen: true, cardCount: 0, lastCardAt: 0 })).toBe('card');
  });
  it('waits 14 days between cards', () => {
    expect(deferredPushAskMode({ ...rep, cardCount: 1, lastCardAt: now - 13 * DAY })).toBe(null);
    expect(deferredPushAskMode({ ...rep, cardCount: 1, lastCardAt: now - 14 * DAY })).toBe('card');
    expect(deferredPushAskMode({ ...rep, cardCount: 2, lastCardAt: now - 30 * DAY })).toBe('card');
  });
  it('stops after three cards', () => {
    expect(deferredPushAskMode({ ...rep, cardCount: 3, lastCardAt: now - 90 * DAY })).toBe(null);
  });
  it('the earlier rules still win: asked, not provisional, old build, opened from push', () => {
    expect(deferredPushAskMode({ ...rep, asked: true })).toBe(null);
    expect(deferredPushAskMode({ ...rep, authStatus: 'authorized' })).toBe(null);
    expect(deferredPushAskMode({ ...rep, iosVersion: '2.5' })).toBe(null);
    expect(deferredPushAskMode({ ...rep, openedFromPush: true, cardCount: 3 })).toBe('dialog');
  });
  it('control is unchanged by the extra fields', () => {
    expect(deferredPushAskMode({ ...base, cardSeen: true, cardCount: 0, lastCardAt: 0, now })).toBe(null);
  });
});
