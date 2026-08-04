import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Regression (@OD, 2026-08-04): "camera -> send to rotate failed again even
// though it said 'open rotate for next steps'". The iOS share extension saves
// the photo and deletes its own copy, then the native app dispatches
// handleSharedImage(base64) as soon as the *page* finishes loading — which on a
// cold start is before auth restores, so currentUser is still null. The old
// handler did `if (!currentUser) return;` and silently dropped the only copy of
// the photo. It must instead queue the image and process it once the user is
// confirmed in bootApp().
describe('shared image survives the boot/auth race', () => {
  it('handleSharedImage stashes the photo instead of dropping it when the user is not ready', () => {
    const i = html.indexOf('function handleSharedImage(base64)');
    expect(i).toBeGreaterThan(-1);
    const body = html.slice(i, i + 300);
    // No silent drop: the not-ready branch must retain the base64, not just return.
    expect(body).toMatch(/_pendingSharedImage\s*=\s*base64/);
    expect(body).not.toMatch(/if\s*\(\s*!currentUser\s*\)\s*return\s*;/);
  });

  it('bootApp drains the queued shared image once currentUser is set', () => {
    const i = html.indexOf('async function bootApp(');
    expect(i).toBeGreaterThan(-1);
    const body = html.slice(i, html.indexOf('\n}\n', i));
    expect(body).toContain('drainPendingSharedImage()');
  });

  it('drainPendingSharedImage clears the pending slot and hands off to the identify flow', () => {
    const i = html.indexOf('function drainPendingSharedImage(');
    expect(i).toBeGreaterThan(-1);
    const body = html.slice(i, i + 300);
    expect(body).toMatch(/_pendingSharedImage\s*=\s*null/);
    expect(body).toContain('handleSharedImageV2(');
  });
});
