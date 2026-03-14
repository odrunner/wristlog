# Security Audit — WRotate
**Date:** March 12, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (14,569 lines), sw.js (66 lines)
**Previous audit:** March 9, 2026 (reliability-focused)

---

## Summary

The codebase has strong security fundamentals: consistent `escHtml()`/`escAttr()` usage, CSP header, parameterized Supabase queries, OAuth token cleanup, and client-side admin guards backed by (assumed) RLS. However, several medium-severity issues were found, primarily around XSS in `onerror` handlers and a data-leak in the feed query for "close friends" visibility posts.

---

## Critical Findings

*None.*

---

## High Severity

### H1. XSS in `profileInitials()` onerror handler — unescaped display name

**File:** index.html, line 4012
**Code:**
```js
return `<img src="${escHtml(p.avatar_url)}" ... onerror="this.replaceWith(document.createTextNode('${fb}'))">`;
```
Where `fb = (p.display_name||p.username||'').slice(0,2).toUpperCase()`.

**Issue:** `fb` is placed inside a single-quoted JS string in an `onerror` handler without any escaping. If a user sets their display name to start with a single quote (e.g., `'`), the generated `onerror` becomes `...document.createTextNode('''))` which breaks out of the string. While the 2-character + uppercase constraint limits payload size, it can still cause JS errors and potentially be chained.

**Fix:** Use `escAttr()` on `fb`:
```js
const fb = escAttr((p.display_name||p.username||'').slice(0,2).toUpperCase());
```

### H2. XSS in `openDeleteClubModal` onclick — `escHtml` used instead of `escAttr`

**File:** index.html, line 5662
**Code:**
```js
onclick="openDeleteClubModal('${clubId}','${escHtml(club.name)}')"
```

**Issue:** `escHtml()` does not escape single quotes. A club name containing `'` (e.g., `O'Clock Club`) will break out of the single-quoted JS string in the onclick handler, enabling arbitrary JS execution. Club names are user-controlled input.

**Fix:** Replace `escHtml(club.name)` with `escAttr(club.name)`.

### H3. Close-friends posts leaked to non-friend followers (data exposure)

**File:** index.html, lines 6652-6654
**Code:**
```js
db.from('logs').select(FEED_LOG_COLS)
  .in('user_id', followingArr)
  .in('visibility', ['followers', 'friends'])
```

**Issue:** The feed query (Q3) fetches posts with `friends` visibility from ALL followed users, not just close friends. While the client-side filter at line 6714 (`if (log.visibility === 'friends') return friendships.has(log.user_id)`) hides them from the UI, the data is still transmitted to the client. A user who follows someone but is NOT their close friend can see these posts by inspecting network responses or browser dev tools.

**Fix:** Either:
1. Split Q3 into two queries: one for `followers` visibility (from all followed users) and one for `friends` visibility (only from users in `friendships` set), OR
2. Add RLS policies on the `logs` table that enforce friends-only visibility server-side.

---

## Medium Severity

### M1. Admin operations rely on client-side guard only

**File:** index.html, lines 8782-8785, 8897, 8908, 8932
**Code:**
```js
const ADMIN_USER_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';
if (currentUser?.id !== ADMIN_USER_ID) return;
```

**Issue:** Admin functions (suspend user, confirm content removal, restore content, view reports/feedback) are gated only by a client-side UUID check. The actual Supabase operations (e.g., `db.from('profiles').update({ is_suspended: true })`) rely on RLS policies to enforce access. If the RLS policies on `profiles`, `content_reports`, and `feedback` tables don't restrict write access to admin users, any authenticated user could call these endpoints directly.

**Recommendation:** Verify that RLS policies on `profiles` (for `is_suspended` updates), `content_reports`, and `feedback` tables restrict mutations to the admin user. Consider using a Supabase Edge Function for admin operations to centralize the authorization check server-side.

### M2. Suspension check is client-side only

**File:** index.html, line 14296
**Code:**
```js
if (myProfile?.is_suspended) { /* show suspended UI */ }
```

**Issue:** The suspension enforcement happens only on the client. A suspended user can bypass this by modifying the JS or using the Supabase API directly. RLS policies should prevent suspended users from performing any mutations (inserting posts, comments, likes, etc.).

**Recommendation:** Add RLS `WITH CHECK` clauses on `logs`, `comments`, `likes`, `follows`, etc. that deny inserts/updates when `auth.uid()` has `is_suspended = true` in the `profiles` table.

### M3. `uid()` uses predictable values

**File:** index.html, line 8632
**Code:**
```js
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
```

**Issue:** IDs generated with `Date.now() + Math.random()` are not cryptographically random. While `crypto.randomUUID()` is used for club IDs (line 5345), other entities (watches, logs, straps, receipts) use `uid()`. This allows ID prediction/enumeration.

**Fix:** Use `crypto.randomUUID()` everywhere (already used for clubs), with `uid()` as the fallback only for browsers that don't support it.

### M4. CORS proxy usage enables SSRF-adjacent behavior

**File:** index.html, lines 11780-11781, 13577-13579
**Code:**
```js
`https://corsproxy.io/?${encodeURIComponent(w.url)}`
`https://api.allorigins.win/raw?url=${encodeURIComponent(w.url)}`
```

**Issue:** The "Fetch details" feature sends user-supplied URLs through third-party CORS proxies. These proxies will fetch any URL, including internal network addresses. While the risk is on the proxy side (not your server), the fetched HTML is parsed with `DOMParser` and values are extracted. If a malicious URL returns crafted HTML, the extracted metadata (name, price, image URL) could contain unexpected content. The `DOMParser` approach is safe against script execution, but extracted `src`/`href` values are used in the app without URL validation.

**Recommendation:** Validate that extracted image URLs start with `https://` before using them. Consider adding a URL allowlist for the fetch-details feature.

### M5. Implicit OAuth flow — tokens in URL fragment

**File:** index.html, lines 3667-3668
**Code:**
```js
flowType: 'implicit',
detectSessionInUrl: true,
```

**Issue:** The implicit OAuth flow exposes access tokens in the URL fragment (`#access_token=...`). While the app cleans up the URL (lines 14263-14264), the token is briefly visible in browser history and could be leaked via the Referer header before cleanup. PKCE flow is more secure but the code comments explain why it's not used (GitHub Pages limitation).

**Recommendation:** Document this as an accepted risk. If possible, migrate to PKCE with a lightweight auth proxy or Supabase's built-in PKCE support for SPAs.

---

## Low Severity

### L1. `onerror` handler on club avatar with unescaped initials

**File:** index.html, line 5968
**Code:**
```js
`<img src="${escHtml(c.image_url)}" onerror="this.textContent='${initStr}'">`
```
Where `initStr = (c.name || '?').slice(0, 2).toUpperCase()`.

**Issue:** Same pattern as H1 but with only 2 characters and forced uppercase, making exploitation impractical. Still a code hygiene issue.

**Fix:** `escAttr()` the initStr: `onerror="this.textContent='${escAttr(initStr)}'"`

### L2. `uid()` used for receipt IDs

**File:** index.html, lines 12113, 12254
**Code:**
```js
const rId = Date.now().toString(36) + Math.random().toString(36).slice(2);
```

**Issue:** Same as M3 but specifically for receipt IDs. Predictable IDs could allow enumeration of receipts if RLS is misconfigured.

### L3. Notification poll not paused on tab hide

**File:** index.html (from previous audit, still open)

**Issue:** The notification polling interval continues when the tab is in the background, wasting bandwidth and battery. Not a security issue but contributes to unnecessary API calls.

**Fix:** Use `document.addEventListener('visibilitychange', ...)` to pause/resume polling.

### L4. `escHtml` used for wishlist ID in onclick (safe but fragile)

**File:** index.html, line 4709
**Code:**
```js
onclick="cycleWishPrivacy('${escHtml(w.id)}')"
```

**Issue:** `escHtml` doesn't escape single quotes, but `w.id` is generated by `uid()` which only produces alphanumeric + base36 characters. Safe in practice but fragile — if ID generation changes, this becomes exploitable.

**Fix:** Use `escAttr(w.id)` for consistency.

---

## Status of Previous Audit Findings (March 9, 2026)

| # | Finding | Status |
|---|---------|--------|
| 1 | 10 MB photo size limit | **Fixed** (commit 2eb1437) |
| 2 | Pending deletes cleared on sign-out | **Fixed** (commit 2eb1437) |
| 3 | `uid()` uses Date.now+Math.random | **Still open** (see M3 above) |
| 4 | Track photo blob URL leak on error path | **Still open** (negligible) |
| 5 | Notif poll not paused on tab hide | **Still open** (see L3 above) |

---

## Positive Security Practices

- **CSP header** deployed (line 9) with restrictive `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`
- **`escHtml()` + `escAttr()`** used consistently across ~200+ innerHTML assignments
- **`sanitizeSearch()`** strips PostgREST special chars before `.ilike()` / `.or()` calls
- **Parameterized Supabase queries** — no raw SQL string concatenation
- **OAuth token cleanup** — URL fragment stripped immediately after auth redirect
- **Double-submit protection** — save buttons disabled during async operations
- **Session timeout fallback** — 10s getSession timeout prevents indefinite hang
- **`rel="noopener noreferrer"`** on all external links
- **Service worker** properly scoped to same-origin only, doesn't cache API/auth requests
- **Content moderation** — profanity filter (`checkContent()`), report system, moderation statuses

---

## Recommended Priority Actions

1. **Fix H1 + H2 immediately** — straightforward `escAttr()` replacements
2. **Fix H3** — either split the feed query or add RLS policy for friends-visibility enforcement
3. **Verify admin RLS policies** (M1) — ensure `profiles.is_suspended` updates are admin-only server-side
4. **Add RLS enforcement for suspended users** (M2) — prevent API-level bypass
5. **Migrate `uid()` to `crypto.randomUUID()`** (M3) — one-line change
