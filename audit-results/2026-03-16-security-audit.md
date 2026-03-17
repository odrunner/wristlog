# Security Audit — WRotate
**Date:** March 16, 2026
**Auditor:** Claude (automated)
**Scope:** index.html (~14,800 lines), sw.js, Supabase RLS policies, storage policies, database functions
**Previous security audit:** March 14, 2026

---

## Summary

This audit builds on the March 14, 2026 security audit. **All previous H1–H3 and M1–M6 findings remain fixed.** The codebase shows strong security fundamentals — consistent `escHtml()`/`escAttr()` usage, proper RLS policies, and parameterized queries. One new medium-severity issue was found (unescaped `cardImg` in collection view), plus findings related to the upcoming public feed feature and storage configuration. The Supabase Security Advisor now shows only one informational item.

---

## Status of Previous Audit Findings (March 14, 2026)

| # | Finding | Status |
|---|---------|--------|
| H1 | XSS in `previewWatch()` onerror — unescaped initials | **FIXED** (2026-03-14) |
| H2 | Missing `escHtml()` on `w.image` in 6 `src` attributes | **FIXED** (2026-03-14) |
| H3 | Missing `escHtml()` on `u.avatar` in admin stats | **FIXED** (2026-03-14) |
| M1 | Admin operations client-side guard only | **VERIFIED SECURE** (2026-03-14) — RLS enforces |
| M2 | Suspension enforcement client-side only | **FIXED** (2026-03-14) — RLS `WITH CHECK` added |
| M3 | `uid()` uses predictable values | **FIXED** (2026-03-14) — uses `crypto.randomUUID()` |
| M4 | CORS proxy without URL validation | **FIXED** (2026-03-14) — `sanitizeImageUrl()` added |
| M5 | Unescaped `w.color` in CSS `background` (9 locations) | **FIXED** (2026-03-14) — all use `escHtml()` |
| M6 | Club card onerror unescaped `initStr` | **FIXED** (2026-03-14) — uses `escAttr()` |
| L1 | Console error messages leak internal state | **Still open** — low risk |
| L2 | DOMParser JSON-LD chain from fetch-to-render | **Still open** — low risk |
| L3 | `window.open()` with data URI for receipts | **Still open** — low risk |
| L4 | Notification poll not paused on tab hide | **Still open** — low risk |

---

## Critical Findings

*None.*

---

## High Severity

*None.*

---

## Medium Severity

### M1 (NEW). Missing `escHtml()` on `cardImg` in collection card `src` attribute

**File:** index.html, line 10573
**Code:**
```js
const cardImg = collPhotoMode === 'post'
  ? (wLogs.filter(l => l.photoUrl).sort(...)[0]?.photoUrl || w.image)
  : w.image;
// ...
<img loading="lazy" src="${cardImg}" alt="${escHtml(w.brand)} ${escHtml(w.name)}" ...>
```

**Issue:** When `collPhotoMode === 'post'`, `cardImg` can be a `photoUrl` from a log entry (Supabase storage URL) or `w.image` (which can come from the CORS proxy "Fetch details" feature). While `w.image` URLs from the CORS proxy now go through `sanitizeImageUrl()`, the value stored in the database is still user-controlled. A crafted image URL containing `"` could break out of the `src` attribute. The `alt` attribute correctly uses `escHtml()`, but `src` does not.

**Fix:**
```js
<img loading="lazy" src="${escHtml(cardImg)}" ...>
```

### M2 (NEW). `page_visits` INSERT policy allows unrestricted anonymous inserts

**Supabase RLS policy:** `"Anyone can insert page visits"` — `WITH CHECK (path IS NOT NULL)`

**Issue:** The `page_visits` table allows any user (including anonymous/unauthenticated via the anon key) to insert rows with minimal validation — only `path IS NOT NULL`. An attacker who knows the Supabase anon key (exposed in client-side JS) could flood this table with arbitrary data, potentially:
- Inflating traffic/funnel metrics with fake data
- Filling up database storage
- Degrading admin dashboard accuracy

The client-side code has a 30-minute dedup check (`lastVisit < 1800000`), but this is easily bypassed.

**Fix options:**
1. Add a rate limit via Supabase Edge Function or pg rate-limiting extension
2. Add server-side dedup (unique constraint on session fingerprint + path + time window)
3. Add a `check` constraint limiting `utm_source` to known values

### M3 (NEW). Storage upload policy allows any authenticated user to upload to `clubs/` folder

**Policy:** `"Users upload own files"` — includes `(storage.foldername(name))[1] = 'clubs'`

**Issue:** The upload policy for the `media` bucket requires files to be in user-specific folders (e.g., `avatars/{uid}`, `watches/{uid}/`, `logs/{uid}/`), EXCEPT for the `clubs/` folder which allows any authenticated user to upload any file. This means:
- User A could upload files to club folders they don't own
- No per-user path enforcement for club uploads

**Fix:** Restrict club uploads to club members:
```sql
((storage.foldername(name))[1] = 'clubs' AND EXISTS (
  SELECT 1 FROM club_members
  WHERE club_id = (storage.foldername(name))[2]::uuid
  AND user_id = auth.uid()
))
```

### M4 (NEW). `rate_limits` table has RLS enabled but no policies

**Supabase Security Advisor:** `rls_enabled_no_policy` on `public.rate_limits`

**Issue:** The `rate_limits` table has RLS enabled but zero policies defined. This means NO user (including the app itself via the anon key) can read/write this table via the API. If this table is meant to be used for server-side rate limiting only (via service role), this is fine. But if client-side code needs to access it, it's broken. Either way, the Supabase linter flags it as a potential misconfiguration.

**Fix:** Either:
1. Drop the table if unused, or
2. Add appropriate policies if it's needed, or
3. Move to a different schema (e.g., `private`) if it's only for server-side use

### M5 (CARRIED FORWARD). Implicit OAuth flow — tokens in URL fragment

**Status:** Accepted risk, documented in previous audits. Supabase JS SDK uses implicit flow by default, placing the access token in the URL fragment (`#access_token=...`). The code does strip it at lines 14497-14498.

### M6 (NEW). CSP allows `'unsafe-inline'` for both script-src and style-src

**File:** index.html, line 9
**Code:**
```html
script-src 'self' https://cdn.jsdelivr.net https://accounts.google.com 'unsafe-inline';
style-src 'self' 'unsafe-inline';
```

**Issue:** `'unsafe-inline'` in `script-src` significantly weakens the CSP. If an attacker finds any XSS vector (e.g., through innerHTML or onerror handlers), the CSP will not block inline script execution. This is a common tradeoff for single-file SPAs with inline scripts and ~30 inline event handlers, but it nullifies a key defense-in-depth layer.

**Recommendation (long-term):** Extract inline scripts to external files and use nonces or hashes.

### M7 (NEW). `wttr.in` weather API not in CSP `connect-src`

**File:** index.html, line 9 (CSP) and line ~11698 (fetch call)
**Code:**
```js
fetch('https://wttr.in/?format=j1')
```

**Issue:** The CSP `connect-src` does not include `https://wttr.in`. This fetch should be blocked by the CSP. Either the weather feature is silently broken, or CSP enforcement is inconsistent on some browsers for meta-tag CSPs.

**Fix:** Add `https://wttr.in` to `connect-src`, or remove the weather feature if unused.

---

## Low Severity

### L1. Storage buckets have no file size limit (2 of 3)

**Buckets:** `watch-photos` and `wear-photos` — both have `file_size_limit: null`

**Issue:** The `media` bucket correctly limits uploads to 5MB, but the legacy `watch-photos` and `wear-photos` buckets have no file size limit. If these buckets still accept uploads, a user could upload arbitrarily large files.

**Recommendation:** Add file size limits (e.g., 10MB) to both legacy buckets, or disable uploads if they're no longer used.

### L2. Storage buckets have no MIME type restrictions (2 of 3)

**Buckets:** `watch-photos` and `wear-photos` — both have `allowed_mime_types: null`

**Issue:** The `media` bucket correctly restricts to `image/jpeg, image/png, image/webp, image/gif, application/pdf`, but the legacy buckets accept any file type.

**Recommendation:** Add MIME type restrictions or disable uploads if unused.

### L3. All 3 storage buckets are publicly readable

**Buckets:** `watch-photos`, `wear-photos`, `media` — all have `public: true`

**Issue:** All storage buckets are publicly readable, meaning anyone with a file URL can access it — including photos from private posts. The Supabase storage policy `"Public read"` allows `SELECT` on all objects in the `media` bucket. While URLs contain UUIDs (making them hard to guess), if a URL is leaked or shared, the photo is accessible even if the post was set to private.

**Note:** This is actually *required* for the upcoming public feed feature (public post photos need to be publicly accessible). However, for private posts, this means photo privacy relies on URL obscurity rather than access control.

**Recommendation (future):** Consider signed URLs for private post photos, or accept URL-obscurity as sufficient.

### L4 (CARRIED FORWARD). Console error messages may leak internal state

**Status:** Still open from previous audit. ~40 `console.error` calls include full Supabase error objects.

### L5 (CARRIED FORWARD). DOMParser JSON-LD chain from fetch-to-render

**Status:** Still open from previous audit. Low risk — values generally pass through `escHtml()`.

### L6 (CARRIED FORWARD). Notification poll not paused on tab hide

**Status:** Still open from previous audit.

### L7. `dev-config.js` contains test account credentials

**File:** dev-config.js (gitignored, localhost-only)

**Issue:** Test account credentials are stored in a local file. The file is in `.gitignore` and only loaded on localhost (line 14736 checks hostname). Low risk, but if gitignore were accidentally modified, credentials would be committed.

### L8. Duplicate/overlapping RLS policies on multiple tables

**Tables affected:** `clubs`, `club_members`, `club_invites`, `club_join_requests`, `follows`, `friend_requests`, `likes`, `comments`, `notifications`, `profiles`, `watches`, `wishlist`

**Issue:** Many tables have duplicate policies for the same operation (e.g., `clubs` has both `"Anyone can read clubs"` with `qual: true` AND `"clubs_select"` with `qual: auth.uid() IS NOT NULL`). Since PERMISSIVE policies are OR'd together, the more permissive policy always wins, making the restrictive one dead code. This creates confusion about intended access rules:
- `clubs`: anon SELECT allowed by "Anyone can read clubs" but `clubs_select` tries to require auth
- `follows`: 4 separate SELECT policies, all PERMISSIVE — the `qual: true` one makes the others irrelevant
- `club_members`: "Anyone can read club members" with `qual: true` makes `cm_select` (which requires auth or membership) irrelevant

**Risk:** The overlapping policies make it hard to reason about actual access rules. If the intent was to restrict anonymous access (e.g., requiring auth for clubs), the `qual: true` policy overrides that intent.

**Recommendation:** Audit each table's policies, remove duplicates, and ensure the remaining policies reflect the actual intended access level.

---

## Supabase Security Advisor Results

| Level | Finding | Status |
|-------|---------|--------|
| INFO | `rate_limits` table has RLS enabled but no policies | See M4 above |

**Previous advisor finding:** `handle_profile_deletion` mutable search_path — **FIXED** (2026-03-14, `SET search_path = public, auth` added)

All SECURITY DEFINER functions now have explicit `search_path`:
- `handle_new_user` → `search_path = public` ✅
- `handle_profile_deletion` → `search_path = public, auth` ✅
- `is_club_member` → `search_path = public` ✅
- `notify_friend_request` → `search_path = public` ✅
- `notify_report_inserted` → `search_path = public, extensions` ✅
- `rls_auto_enable` → `search_path = pg_catalog` ✅

---

## Positive Security Practices (Confirmed)

- ✅ **CSP meta tag** — `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`
- ✅ **`escHtml()` + `escAttr()`** — consistent across ~200+ innerHTML assignments
- ✅ **All onerror handlers** now use `escAttr()` for dynamic values (verified all 30 occurrences)
- ✅ **All `style="background:${...}"` values** now use `escHtml()` (verified all 7 occurrences)
- ✅ **`sanitizeSearch()`** — strips PostgREST special chars
- ✅ **`sanitizeImageUrl()`** — blocks `javascript:`, `data:`, `http:` schemes
- ✅ **Parameterized Supabase queries** — no raw SQL concatenation
- ✅ **OAuth token cleanup** — URL fragment stripped
- ✅ **RLS on all 23 tables** — no tables without RLS
- ✅ **All SECURITY DEFINER functions** have explicit `search_path`
- ✅ **Suspended user enforcement** at RLS level on all social tables
- ✅ **Content moderation** — report system, moderation statuses, profanity filter
- ✅ **`rel="noopener noreferrer"`** on external links
- ✅ **Auto-RLS event trigger** — new tables automatically get RLS enabled
- ✅ **Image validation** — client-side file type and size checks
- ✅ **`toast()` uses `textContent`** — not vulnerable to XSS

---

## Pre-Public-Feed Security Considerations

Before implementing the public feed on the landing page, these security items should be addressed:

1. **Anonymous read access to `logs` table**: Currently, the `"Others can read shared logs"` policy requires `auth.uid()` for follower/friend checks. Public posts (`visibility = 'public'`) can be read by any authenticated user, but NOT by anonymous users. A new anon-friendly policy will be needed:
   ```sql
   CREATE POLICY "anon_read_public_logs" ON logs
   FOR SELECT TO anon
   USING (visibility = 'public' AND moderation_status IS NULL);
   ```

2. **Anonymous read access to `profiles`**: Already covered — `"Public profiles are viewable by everyone"` with `qual: true` applies to anon role.

3. **Anonymous read access to `comments`**: `"Anyone can read comments"` uses `auth.uid() = user_id OR moderation_status IS NULL` — this works for anon since `auth.uid()` will be NULL but `moderation_status IS NULL` covers public comments.

4. **Anonymous read access to `likes`**: `"Anyone can read likes"` with `qual: true` — works for anon.

5. **Anonymous read access to `watches`**: The `"Others can read shared watches"` policy requires auth for follower/friend checks, but allows `watch_privacy = 'public'` or `NULL`. However, this policy targets `{public}` role. A separate anon policy may be needed for watches on public posts.

6. **Storage photos**: Already publicly readable (all buckets are `public: true`) — no change needed.

7. **Login modal must not expose auth tokens**: Ensure the login modal triggered by like/comment/post actions doesn't leak state.

---

## Recommended Priority Actions

1. **Fix M1** — Add `escHtml()` to `cardImg` in collection card (1 line change)
2. **Address M2** — Add rate limiting or constraints to `page_visits` inserts
3. **Fix M3** — Tighten club storage upload policy
4. **Clean up M4** — Add policy to `rate_limits` or drop table
5. **Fix M7** — Add `https://wttr.in` to CSP `connect-src` or remove weather feature
6. **Address L8** — Audit and deduplicate overlapping RLS policies (reduces confusion for public feed work)
7. **Before public feed**: Add anon SELECT policies for `logs` and `watches` tables
