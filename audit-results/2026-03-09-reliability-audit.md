# Reliability Audit — WRotate v2.34.09.20.27
**Date:** March 9, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (13,730 lines, 842 KB), wristlog.js (49 KB)

## Overall Assessment: SOLID

---

## 1. Error Handling — Strong

- **55+ try/catch blocks** covering all critical paths (auth, cloudSync, loadUserData, loadFeed, photo uploads, save operations)
- **Individual query fault-tolerance** in `loadUserData()`: each Supabase query wrapped in `_q()` so one table failure doesn't block others
- **Global error handlers**: Both `window.onerror` and `unhandledrejection` caught with user-visible toast + console logging
- **Feed fallback**: If multi-query feed approach fails, falls back to own-posts-only
- **Photo upload errors** consistently show `toast('Photo upload failed — ' + e.message)`
- **localStorage errors** handled via `safeSetJSON()` wrapper (survives quota exceeded / private browsing)

## 2. Race Conditions & Async Flows — Strong

- **`_syncInFlight` guard** prevents concurrent cloudSync calls
- **bootApp idempotency guard**: `if (currentUser?.id === user.id) return;` prevents double-boot from getSession + onAuthStateChange
- **`feedLoading` stuck-timer**: If stuck true for >15s, force-reset prevents permanent feed lockout
- **`_feedSafety` master timeout**: 15s fallback renders error state if loadFeed() hangs
- **Social loader safety net**: 8s timeout fires `_fireSocial()` even if loaders hang
- **`_socialFired` flag**: Ensures `_socialReady()` runs exactly once
- **Session timeout**: 10s fallback shows auth screen if getSession() hangs
- **OAuth safety net**: 5s timeout shows login if onAuthStateChange never fires
- **Dirty set snapshot**: cloudSync snapshots IDs before await, so mutations during sync stay in live set

## 3. Null/Undefined Safety — Good

- Optional chaining (`?.`, `??`) used throughout
- Fallback defaults: `(wRes.data || [])`, `(w.color || '#c9a84c')` patterns everywhere
- Profile fallbacks: `p?.display_name || p?.username || 'User'`
- `escHtml(s)` handles null: `(s || '').replace(...)`

## 4. Memory Leaks — Good

- **`URL.revokeObjectURL()`** called consistently — 30+ revoke calls matching createObjectURL calls
- **Event listener cleanup**: removeEventListener for scroll, touchmove, touchend, touchcancel, paste
- **`{ once: true }` pattern** for single-fire listeners
- **Timer cleanup in `clearUserState()`**: clearInterval for notification poll, clearTimeout for sync retry and reminder
- **`rebuildLogsByWatch()`** creates fresh Map each time

## 5. Network Failure Resilience — Strong

- **`withTimeout()` wrapper** (default 10s, up to 15s for loadUserData)
- **`AbortSignal.timeout()`** on all fetch calls (8-12s)
- **Offline detection**: `window.addEventListener('offline/online')` with banner + auto-sync on reconnect
- **cloudSync skips when offline**: `if (!navigator.onLine) return;`
- **Exponential backoff retry**: Failed syncs retry 2s -> 4s -> 8s -> 16s -> 32s -> 60s cap
- **Pending deletes queue persisted to localStorage**: Offline deletes survive browser restart
- **Dirty tracking**: Only changed items synced
- **Supabase thenable-to-Promise conversion**: Wraps queries in `Promise.resolve()` because thenables lack `.catch()`

## 6. Input Validation — Good

- **`validateImageFile()`** checks MIME type, file extension fallback, and 10 MB size limit
- **Brand/name required fields** enforced in `saveWatch()` with `showFieldError()`
- **Date + watch selection required** in `saveLog()`
- **5 MB file size limit** for club images
- **Double-submit protection**: All save buttons disable immediately, re-enable in `finally` blocks

## 7. XSS Protection — Good

- **`escHtml()`** used consistently for all user-generated content in innerHTML
- **`escAttr()`** used for user data in HTML attribute contexts (onclick handlers)
- **No raw user text in innerHTML**
- System-generated UUIDs (hex+hyphens only) used without escaping — safe

## 8. Session & Auth — Robust

- Dual auth path: getSession() + onAuthStateChange with idempotency guard
- OAuth URL cleanup: Strips access_token from URL bar after redirect
- Session expiry handling: SIGNED_OUT clears all state, shows auth screen
- `clearUserState()` thorough: clears 25+ state variables, all Sets/Maps, all intervals/timers

## 9. Data Integrity — Good

- Dirty tracking: Only modified records synced
- Pending deletes processed BEFORE upserts
- Flush pending changes before loading
- Local cache as backup after cloud load
- Optimistic UI with background sync

---

## Fixes Applied (commit 2eb1437)

1. **10 MB photo size limit** added to `validateImageFile()` — rejects oversized files with toast showing actual size
2. **Pending deletes cleared on sign-out** — `clearUserState()` now resets `_pendingDeletes` to prevent stale queue leaking across account switches

## Remaining Suggestions (not bugs)

| # | Area | Severity | Note |
|---|------|----------|------|
| 1 | `uid()` uses Date.now+Math.random | Negligible | crypto.randomUUID() more robust |
| 2 | Track photo blob URL leak on error path | Negligible | clearTrackPhoto() not called on upload error return |
| 3 | Notif poll not paused on tab hide | Negligible | Wastes bandwidth when backgrounded |
