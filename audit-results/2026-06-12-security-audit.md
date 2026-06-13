# Security Audit — WRotate (June 12, 2026)

**Auditor:** Claude (automated deep-dive)
**Scope:** Edge functions (19, now with `lib.ts` splits), migrations `20260601_*` + `20260607_demo_views.sql`, remote tuning table (`timegrapher_tuning`), client JS (`index.html` broadcast preview / sweep / brand autocomplete), repo secret hygiene, RLS verification via live read-only DB queries.
**References:** `2026-05-30-security-audit.md`, `2026-05-31-security-audit.md` (CRITICAL demo_readonly RESTRICTIVE fix — re-verified below).

## Status Legend
🔴 Open · 🟡 Partial · 🟢 Fixed · ⚪️ Accepted

---

## Summary

Overall posture: **YELLOW, trending toward a single HIGH that needs prompt action.**

One **NEW HIGH** finding (🟢 **FIXED same day** — see NEW-1): the `admin_user_stats()` SECURITY DEFINER function had `EXECUTE` granted to `anon`/PUBLIC and **no internal admin guard**, so anyone with the public anon key could dump every user's id and per-feature activity counts. Verified live at audit time: `SET ROLE anon; SELECT count(*) FROM admin_user_stats();` returned **315 rows**. Guarded + revoked + re-verified on 2026-06-12.

Good news on the areas flagged for extra scrutiny in the brief:
- **Remote tuning table is safe.** `timegrapher_tuning` has RLS enabled with only a public `SELECT` policy and no write policy — a hostile user **cannot** write sweep/knob config that would run on other phones. Verified via `pg_policies` + `relrowsecurity`.
- **`20260607_demo_views.sql` creates a TABLE, not a view** (filename is misleading). No SQL views exist in the `public` schema at all (`information_schema.views` empty), so the "views bypass RLS unless security_invoker" risk does not apply. `demo_views` has RLS on, no client policies, and is read only through the guarded `admin_demo_views()` RPC. Verified-good.
- **Secret hygiene holds.** `AuthKey_GY99A337P8.p8` / `AuthKey_WMZMA9KUZ5.p8` are on disk but **not** git-tracked (`*.p8` gitignored); `dev-config.js` and `CLAUDE.md` gitignored and untracked. APNs key only lives in the `APNS_KEY_P8` secret (send-push), never committed.
- **May-31 CRITICAL re-verified FIXED:** `demo_readonly_*` write policies are RESTRICTIVE (spot-checked `feedback` → `demo_readonly_feedback_insert` is `RESTRICTIVE`).

---

## (a) Carried-Forward Items

| ID | Sev | Status | Note (June 12) |
|----|-----|--------|----------------|
| **2026-05-31 CRITICAL** demo_readonly permissive | CRIT | 🟢 **RE-VERIFIED FIXED** | `pg_policies` shows `demo_readonly_*` write policies as `RESTRICTIVE` (e.g. `feedback`). |
| N39 | MEDIUM | 🔴 **STILL OPEN** | `resend-webhook/index.ts` — `WEBHOOK_SECRET` declared (line 5) but never used. `isValidPayload()` only checks `type`/`data` exist; handler does a service-role insert into `email_events` for any POST. No Svix signature check. |
| N40 | MEDIUM | 🔴 **STILL OPEN** | `send-report` still passes admin `html` straight to Resend via `buildResendBody()`; `grep sanitize` = 0 hits in both `index.ts` and `lib.ts`. Admin-gated (Bearer→getUser→`internal_accounts`), so defense-in-depth only. |
| N9 | MEDIUM | 🟡 By design | `share-collection`/`share-post` use `SUPABASE_SERVICE_ROLE_KEY` to render public OG pages; queries are scoped to public/non-moderated rows. Accept. |
| N10 | MEDIUM | 🔴 STILL OPEN | `share-collection/lib.ts:47` SVG `<image href="${esc(w.image)}">` — `esc()` escapes `&<>"` but does not validate URL scheme. `<image>` won't execute JS, low practical risk; carried. |
| N32 | MEDIUM | 🔴 STILL OPEN | `send-email`/`send-push` have no per-user rate limiting. Both are DB-webhook-triggered and confirm the record exists first, limiting abuse. Carried. |
| S7 | MEDIUM | 🔴 STILL OPEN | `page_visits` policy "Anyone can insert page visits" (`anon`, `with_check: path IS NOT NULL`) — unauthenticated insert, no rate limit. Confirmed in `pg_policies`. |
| N4 | LOW | 🔴 STILL OPEN | `search-watch-image/index.ts` `scrapePageForImage()` fetches with `redirect:"follow"` and no private-IP check. Auth-gated; URLs derived from Claude/brand patterns. |
| N17/N18/N19/N24 | MEDIUM | 🔴 Carried | Client-side feedback/review/confidence sinks — not re-deep-checked this session; no regressions observed. |
| N41 | LOW | 🔴 STILL OPEN | CSP (`index.html:9`) still has no `frame-ancestors` and no `X-Frame-Options`. |
| N42 | LOW | 🔴 STILL OPEN — **line moved to 19419** | `escHtml(b)` used inside a single-quoted JS string in an `onmousedown` handler; `escHtml` doesn't escape `'`. Same pattern at `18635` (`selectBrand('${escHtml(b)}')`) and `20924` (`selectWlBrand(...)`). Brand list is internal/validated → low. |
| N43 | LOW | 🔴 STILL OPEN | CSP `connect-src` still lists `https://corsproxy.io` + `https://api.allorigins.win` (open proxies). |
| N44 | LOW | 🔴 Carried | `dev-config.js` (gitignored, untracked) holds the `official@wrotate.com` password on the dev host. Not re-read this session. |
| N34 | LOW | 🟡 Carried | Supabase access token in gitignored `CLAUDE.md`. |

---

## (b) New Findings

### NEW-1 — `admin_user_stats()` exposes all users' activity to anonymous callers 🟢 FIXED 2026-06-12
- **Status:** FIXED 2026-06-12 — `supabase/migrations/20260612_guard_admin_user_stats.sql`: converted to plpgsql with the standard `is_admin` guard, pinned `SET search_path = public`, and `REVOKE EXECUTE FROM public, anon` (`authenticated` keeps EXECUTE because the admin page calls the RPC as the signed-in admin; the guard rejects non-admins). Verified live: `SET ROLE anon` → `permission denied`; authenticated testuser → `Not authorized`; admin → 315 rows as before.
- **Severity:** High — broken access control / data exposure.
- **Files:** `supabase/migrations/20260601_repeat_user_cross_feature.sql:43-59` and `20260601_exclude_measurement_from_wears.sql:10-21` (the two places that `CREATE OR REPLACE FUNCTION public.admin_user_stats()`).
- **Evidence:**
  - `pg_proc`: `prosecdef = true`, `proconfig = null`, `proacl = {=X/postgres, anon=X, authenticated=X, service_role=X}` — the leading `=X` grants `EXECUTE` to **PUBLIC**.
  - `prosrc` is a plain `SELECT … FROM profiles p LEFT JOIN …` with **no `IF NOT EXISTS (… is_admin …) RAISE EXCEPTION`** guard (unlike `admin_traffic_stats` / `admin_user_detail`, which both have the guard).
  - Live proof: `SET ROLE anon; SELECT count(*) FROM public.admin_user_stats();` → **315 rows** (every profile's `user_id`, `watches`, `wears`, `price_checks`, `enhances`, `recent_active_days`). Internal accounts are not even excluded.
- **Reachability:** It lives in `public` and is granted to `anon`, so it is a live PostgREST RPC: `POST /rest/v1/rpc/admin_user_stats` with the public anon key (embedded at `index.html:~4727`) returns the full table to anyone.
- **Fix:**
  ```sql
  REVOKE EXECUTE ON FUNCTION public.admin_user_stats() FROM public, anon, authenticated;
  -- keep service_role / the admin RPCs that call it
  ```
  And/or add the standard guard to the body:
  ```sql
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    THEN RAISE EXCEPTION 'Not authorized'; END IF;
  ```
  (Body-only fix requires converting it from `LANGUAGE sql` to `plpgsql`.) Prefer the REVOKE — the admin page already calls it through a path that runs as a privileged role, and the two other admin RPCs use the internal guard. Re-test `SET ROLE anon` returns 0 / permission denied afterward.

### NEW-2 — SECURITY DEFINER admin functions lack `search_path` pinning 🔴 MEDIUM
- **Severity:** Medium — privilege-escalation hardening gap.
- **Evidence (`pg_proc.proconfig`):** `admin_user_stats`, `admin_user_detail`, `admin_traffic_stats`, and `admin_active_days` all have `proconfig = null` (no `SET search_path`). Only `admin_demo_views()` pins `search_path=public` (`20260607_demo_views.sql:28`). A SECURITY DEFINER function with an unpinned `search_path` can be hijacked if an attacker can create objects in a schema that precedes `public` on the caller's `search_path`.
- **Mitigation in place:** Supabase's default role `search_path` and locked-down `CREATE` on `public` reduce practical risk, but pinning is the documented best practice and the codebase already does it for `admin_demo_views`.
- **Fix:** Add `SET search_path = public` (or `= ''` with fully-qualified names) to each of the four functions. `admin_active_days` already `REVOKE`s execute from public/anon/authenticated — good; keep that and add the pin.

### NEW-3 — `extract-url-meta` SSRF guard bypassable via redirect 🔴 MEDIUM (admin-only)
- **Severity:** Medium, gated to admin → effectively Low unless an admin account is compromised.
- **File:** `supabase/functions/extract-url-meta/index.ts:64-72` with `lib.ts` `validateUrl()`/`isBlockedHost()`.
- **Evidence:** `validateUrl()` correctly blocks `localhost`, `127.*`, `10.*`, `192.168.*`, `169.254.*`, `172.16-31.*`, `.internal`, `.local` — but only on the **initial** URL. `fetch(url, { redirect: "follow" })` then follows 3xx redirects with no per-hop re-validation, so an attacker-controlled `https://evil.example/r` that 302-redirects to `http://169.254.169.254/…` or an internal host is fetched and its body returned to the admin. The function is `is_admin`-gated, which is the main mitigation.
- **Fix:** Use `redirect: "manual"` and re-run `validateUrl()` on each `Location` hop (cap hops), or resolve+pin the IP and reject private ranges before each fetch. The same pattern exists in `search-watch-image` (already tracked as N4) — fix both.

---

## (c) Summary Table

| Finding | Sev | Status | File |
|---------|-----|--------|------|
| NEW-1 `admin_user_stats()` callable by anon, no guard | **HIGH** | 🟢 FIXED 2026-06-12 | `migrations/20260612_guard_admin_user_stats.sql` |
| NEW-2 SECURITY DEFINER funcs no `search_path` pin | MEDIUM | 🟡 Partial (admin_user_stats pinned 2026-06-12) | admin_user_detail / admin_traffic_stats / admin_active_days |
| NEW-3 `extract-url-meta` SSRF via redirect-follow | MEDIUM | 🔴 New (admin-gated) | `extract-url-meta/index.ts:64` |
| N39 `resend-webhook` no signature verify | MEDIUM | 🔴 Open | `resend-webhook/index.ts:5` |
| N40 `send-report` no HTML sanitize | MEDIUM | 🔴 Open | `send-report/index.ts:38` |
| N32 send-email/send-push no rate limit | MEDIUM | 🔴 Open | send-email, send-push |
| S7 `page_visits` anon insert, no rate limit | MEDIUM | 🔴 Open | RLS policy |
| N10 SVG `<image href>` no scheme check | MEDIUM | 🔴 Open | `share-collection/lib.ts:47` |
| N4 `search-watch-image` SSRF | LOW | 🔴 Open | `search-watch-image/index.ts` |
| N41 no `frame-ancestors` | LOW | 🔴 Open | `index.html:9` |
| N42 `escHtml` in single-quote JS attr | LOW | 🔴 Open | `index.html:19419/18635/20924` |
| N43 open CORS proxies in CSP | LOW | 🔴 Open | `index.html:9` |
| N44 dev-config.js creds | LOW | 🔴 Carried | `dev-config.js` (gitignored) |
| 2026-05-31 demo_readonly permissive | CRIT | 🟢 Re-verified FIXED | `migrations/20260531_demo_readonly_restrictive.sql` |

### Verified-Good (no action)
- **Remote tuning table** `timegrapher_tuning` — RLS on, SELECT-only policy, no write policy. Hostile sweep/knob writes blocked. Read at `index.html:21983` (sweep cfg) and `22249` (engine tuning); admin Mic-Sweep button is display-gated. ✅
- **`demo_views`** — RLS on, no client policies; only `admin_demo_views()` (SECURITY DEFINER, `search_path` pinned, internal `is_admin` guard) reads aggregates; demo-login writes a SHA-256 **hashed** IP, never raw. No SQL views in `public`. ✅
- **`.p8` APNs keys / `dev-config.js` / `CLAUDE.md`** — gitignored, not tracked. ✅
- **Edge-function auth** — `delete-user` (self only via user JWT), `watch-value`/`identify-watch`/`search-watch-image` (Bearer→getUser), `extract-url-meta` (admin), `send-report` (internal_accounts), `send-broadcast` (hard-coded ADMIN_USER_ID). Webhook functions (`send-email`, `send-push`, `new-user-alert`, `report-notify`, `feedback-to-github`, `auto-add-brand`) re-verify the record exists in the DB before acting, and escape user content in emails. ✅
- **Broadcast preview** renders admin HTML in a `sandbox`ed `<iframe srcdoc>` (`index.html:13901`, `14510`) with quotes escaped; server applies `sanitizeHtml()` before send. Admin self-content only. ✅

---

## Priority Actions
1. ~~**NEW-1 (HIGH)**~~ — ✅ DONE 2026-06-12: guard + `search_path` pin + REVOKE deployed and verified live (`20260612_guard_admin_user_stats.sql`).
2. **NEW-2 (MEDIUM)** — Pin `SET search_path = public` on the remaining three unpinned SECURITY DEFINER admin functions (`admin_user_detail`, `admin_traffic_stats`, `admin_active_days`; `admin_user_stats` pinned 2026-06-12).
3. **NEW-3 (MEDIUM)** — `redirect:"manual"` + per-hop private-IP re-validation in `extract-url-meta` (and `search-watch-image`/N4).
4. **N39 (MEDIUM)** — Verify Svix signature in `resend-webhook` before insert.
5. **N40 (MEDIUM)** — Apply `sanitizeHtml()` to `send-report` `html`.
6. **N41/N43 (LOW)** — Add `frame-ancestors 'self'`; move client URL-unfurl server-side and drop the open proxies from CSP.
7. **N42 (LOW)** — Use `escAttr()` at `index.html:19419/18635/20924`.
