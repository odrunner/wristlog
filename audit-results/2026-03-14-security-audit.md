# Security Audit — WRotate
**Date:** March 14, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~14,600 lines), sw.js (66 lines)
**Previous security audit:** March 12, 2026

---

## Summary

This audit builds on the March 12, 2026 security audit. Two of the three previous high-severity findings (H1 and H3) have been fixed. H2 has also been fixed (now uses `escAttr`). Several new issues were found, primarily around missing `escHtml()` on `src` attributes for user-owned watch image URLs, unescaped CSS `background` values, and an unescaped `initials()` output inside an `onerror` handler. The codebase continues to demonstrate strong security fundamentals overall.

---

## Status of Previous Audit Findings (March 12, 2026)

| # | Finding | Status |
|---|---------|--------|
| H1 | XSS in `profileInitials()` onerror — unescaped display name | **Fixed** (line 4047 now uses `escAttr`) |
| H2 | XSS in `openDeleteClubModal` onclick — escHtml not escAttr | **Fixed** (line 5709 now uses `escAttr`) |
| H3 | Close-friends posts leaked to non-friend followers | **Fixed** (lines 6724-6733: Q3b now only queries friends in `friendships` set) |
| M1 | Admin operations rely on client-side guard only | **Still open** — see M1 below |
| M2 | Suspension check is client-side only | **Still open** — see M2 below |
| M3 | `uid()` uses Date.now+Math.random | **Still open** — see M3 below |
| M4 | CORS proxy enables SSRF-adjacent behavior | **Still open** — see M4 below |
| M5 | Implicit OAuth flow — tokens in URL fragment | **Still open** (accepted risk, documented) |
| L1 | Club avatar onerror unescaped initials | **Still open** — see NEW H1 below (expanded) |
| L2 | `uid()` for receipt IDs | **Still open** (same as M3) |
| L3 | Notification poll not paused on tab hide | **Still open** |
| L4 | `escHtml` for wishlist ID in onclick | **Still open** (safe in practice) |

---

## Critical Findings

*None.*

---

## High Severity

### H1. XSS in `previewWatch()` onerror handler — unescaped `initials()` output — **FIXED 2026-03-14**

**File:** index.html, line 13438
**Code:**
```js
onerror="this.parentElement.style.background='${escHtml(w.color||'#c9a84c')}';this.replaceWith(Object.assign(document.createElement('div'),{className:'wpm-hero-avatar',textContent:'${initials(w.brand||'',w.name||'')}'}))">
```

**Issue:** The `initials(w.brand, w.name)` output is placed inside a single-quoted JS string within an `onerror` handler. The `initials()` function (line 8891: `((b[0]||'') + (n[0]||'')).toUpperCase()`) returns 2 characters from user-controlled brand/name fields. If a watch brand or name starts with a single quote (`'`), the onerror handler's JS string breaks, enabling script injection. While uppercase conversion limits the character set, `'` and `\` survive `.toUpperCase()`.

**Fix:** Use `escAttr()` on the initials output:
```js
textContent:'${escAttr(initials(w.brand||'',w.name||''))}'
```

### H2. Missing `escHtml()` on `w.image` in multiple `src` attributes (6 locations) — **FIXED 2026-03-14**

**File:** index.html, lines 9466, 9540, 10369, 11373, 11596, 13144

**Code examples:**
```js
// Line 9466
src="${w.image}"
// Line 9540
src="${w.image}"
// Line 10369
src="${w.image}"
// Line 11373
src="${w.image}"
// Line 11596
src="${w.image}"
// Line 13144
src="${w.image}"
```

**Issue:** These 6 locations inject `w.image` directly into `src` attributes without `escHtml()`. The `w.image` field is populated either from Supabase Storage URLs (safe) or from the CORS proxy "Fetch details" feature, which extracts image URLs from arbitrary external web pages. A crafted image URL containing `"` could break out of the `src` attribute and inject arbitrary HTML attributes or content. Other `w.image` usages in the codebase correctly use `escHtml(w.image)` (e.g., lines 4655, 7129, 7741, 8602, 9795, 10267).

**Fix:** Add `escHtml()` to all 6 locations:
```js
src="${escHtml(w.image)}"
```

### H3. Missing `escHtml()` on `u.avatar` in admin stats user rows — **FIXED 2026-03-14**

**File:** index.html, line 9211
**Code:**
```js
const initHTML = u.avatar
  ? `<img src="${u.avatar}" style="...">`
  : `<div ...>${(u.name[0]||'?').toUpperCase()}</div>`;
```

**Issue:** `u.avatar` (from `p.avatar_url`, a user-controlled profile field) is inserted into an `<img src>` attribute without escaping. A malicious avatar URL containing `"` could break out of the attribute. This is admin-only UI, so exploitation requires the admin to view the admin stats page, but the avatar_url is fully user-controlled via profile edit.

**Fix:**
```js
? `<img src="${escHtml(u.avatar)}" style="...">`
```

---

## Medium Severity

### M1. Admin operations rely on client-side guard only (CARRIED FORWARD) — **VERIFIED SECURE 2026-03-14**

**File:** index.html, lines 8988, 9002, 9122, 9143
**Status:** Already secured at database level. RLS policies on `profiles`, `content_reports`, `feedback`, `logs`, and `comments` all use `EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)` checks. Client-side guard is UI-only convenience.

### M2. Suspension enforcement is client-side only (CARRIED FORWARD) — **FIXED 2026-03-14**

**File:** Supabase RLS migration `add_suspension_rls_to_social_tables`
**Status:** Fixed. Added RLS `WITH CHECK` policies blocking suspended users from INSERT on: `likes`, `comment_likes`, `follows`, `follow_requests`, `friend_requests`, `clubs`, `club_join_requests`, `notifications`. Previously only `logs` and `comments` had suspension enforcement.

### M3. `uid()` uses predictable values (CARRIED FORWARD)

**File:** index.html, line 8632 area
**Status:** Still open from previous audit.

**Issue:** `Date.now() + Math.random()` is not cryptographically random.

**Fix:** Use `crypto.randomUUID()` with `uid()` as fallback.

### M4. CORS proxy usage without URL validation on extracted values (CARRIED FORWARD) — **FIXED 2026-03-14**

**File:** index.html — `sanitizeImageUrl()` helper + 4 call sites
**Status:** Fixed. Added `sanitizeImageUrl(url, baseUrl)` that only allows `https://`, `//`, or `/path` schemes — blocks `javascript:`, `data:`, `http:`, and all other schemes. Applied to all 4 image extraction locations (watch modal, wishlist modal, wishlist fetch details, wishlist get photo). Both og:image/twitter:image meta tags and `<img>` fallback scans now go through the sanitizer.

### M5. Unescaped `w.color` in CSS `background` property (9 locations) — **FIXED 2026-03-14**

**File:** index.html, lines 7130, 8603, 9467, 9541, 10271, 10370, 11374, 11597, 13145

**Code example:**
```js
style="background:${w.color}"
```

**Issue:** `w.color` is injected directly into inline `style` attributes without escaping. While the UI uses a fixed color palette picker, the value stored in Supabase is user-controlled. If a user manipulates their data via the API (bypassing the UI), they could inject a value like `red;position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999` to overlay content, or use `url(https://attacker.com/pixel.gif)` for tracking. In the other places `w.color` is used, `escHtml()` is correctly applied (e.g., lines 4656, 4691, 7144).

**Fix:** Use `escHtml()` consistently:
```js
style="background:${escHtml(w.color || '#c9a84c')}"
```

### M6. Club card onerror handler with unescaped `initStr` (from previous L1, upgraded) — **FIXED 2026-03-14**

**File:** index.html, line 6015
**Code:**
```js
<img src="${escHtml(c.image_url)}" onerror="this.textContent='${initStr}'">
```
Where `initStr = (c.name || '?').slice(0, 2).toUpperCase()`.

**Issue:** `initStr` is derived from `c.name`, a user-controlled club name. It's placed inside a single-quoted JS string in an `onerror` handler without escaping. A club name starting with `'` (e.g., `'Omega`) produces `initStr = "'O"`. The onerror becomes `this.textContent=''O'` which breaks the JS string. While the 2-char uppercase limit constrains the payload, it can cause JS errors and the pattern is inherently fragile.

**Fix:**
```js
onerror="this.textContent='${escAttr(initStr)}'"
```

---

## Low Severity

### L1. Console error messages may leak internal state

**File:** index.html, ~40 locations

**Issue:** Error messages from Supabase queries are logged to the console (e.g., `console.error('[WristLog] watches SELECT error:', wRes.error.message, wRes.error)`). Some of these include the full error object which may contain query details, table names, or RLS policy hints. This is standard debug practice but could aid an attacker in understanding the backend schema.

**Recommendation:** In production, consider reducing error log verbosity to just the message string, not the full error object.

### L2. DOMParser-parsed JSON-LD executed via `JSON.parse`

**File:** index.html, lines 13824-13827, 13964-13967

**Code:**
```js
const jsonLds = [...doc.querySelectorAll('script[type="application/ld+json"]')]
  .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
```

**Issue:** JSON-LD content from fetched external pages is parsed with `JSON.parse()`. While `JSON.parse()` itself is safe (no code execution), the parsed values (product name, price, SKU) are later used as watch metadata. A malicious page could craft JSON-LD with values containing HTML/JS payloads. These values are generally passed through `escHtml()` when rendered, but the chain from fetch-to-render is long and fragile.

**Recommendation:** Sanitize extracted string values at the point of extraction (strip HTML tags, limit length).

### L3. `window.open()` with data URI for receipt viewer

**File:** index.html, lines 12413-12418

**Code:**
```js
const win = window.open();
if (r.type === 'application/pdf' || r.data.startsWith('data:application/pdf')) {
  const embed = win.document.createElement('embed');
  embed.src = r.data;
```

**Issue:** Receipt data (base64 data-URIs) is rendered in a new window via `window.open()`. The data comes from the user's own local watch data. If local storage were compromised, a malicious data-URI could be injected. Low risk because receipts are user-owned data not shared between users.

### L4. Notification poll not paused on tab hide (CARRIED FORWARD)

**File:** index.html
**Status:** Still open from previous audit.

---

## Positive Security Practices (Confirmed/Unchanged)

- **CSP meta tag** (line 9): `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-src` limited to Google accounts
- **`escHtml()` + `escAttr()`** used consistently across ~200+ innerHTML assignments
- **`sanitizeSearch()`** strips PostgREST special chars before `.ilike()` / `.or()` calls
- **Parameterized Supabase queries** — no raw SQL string concatenation
- **OAuth token cleanup** — URL fragment stripped at lines 14497-14498
- **Double-submit protection** — buttons disabled during async operations
- **Session timeout fallback** — 10s `withTimeout()` wrapper prevents hung queries
- **`rel="noopener noreferrer"`** on external links
- **Service worker** properly scoped to same-origin only
- **Content moderation** — profanity filter, report system, moderation statuses
- **Image validation** — file type and size checks (line 12158-12173)
- **`toast()` uses `textContent`** — not vulnerable to XSS (line 8931)
- **Comment body escaping** — `renderCommentBody()` escapes HTML before processing @mentions (line 8185)
- **H3 from previous audit fixed** — close-friends feed query now properly scoped to actual friends (line 6725)

---

## Recommended Priority Actions

1. **Fix H2 immediately** — add `escHtml()` to 6 bare `w.image` usages in `src` attributes (straightforward)
2. **Fix H1 + M6** — `escAttr()` the `initials()` output in onerror handlers (2 locations)
3. **Fix H3** — `escHtml()` the `u.avatar` in admin stats (1 location)
4. **Fix M5** — `escHtml()` the 9 bare `w.color` usages in `style` attributes
5. **Verify admin RLS policies** (M1) — confirm server-side enforcement
6. **Add RLS enforcement for suspended users** (M2)
7. **Migrate `uid()` to `crypto.randomUUID()`** (M3)
