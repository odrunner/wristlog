# WRotate Security Audit — 2026-06-29

Read-only audit of ~195 commits since the 2026-06-22 full audit. No code modified at audit time. Every claim references code read or live DB queries.

Previous cycle: `2026-06-22-security-audit.md`. That cycle closed all Critical/High/Medium items (resend-webhook signature, run-campaign auth, SSRF, trusted-row send-email/push, search_path pinning, atomic rate limiting, constant-time HMAC).

> **UPDATE 2026-06-29:** M-1 and M-2 (search_path regressions) **FIXED + DEPLOYED** same day — re-pinned via `ALTER FUNCTION`, source migration files updated with inline `SET search_path`. Live `proconfig` confirms the pin on both. The two Low items (test password, admin-only redirect SSRF) remain backlog.

## Findings Table

| Sev | New/Carried | Finding | Location | Fix |
|-----|-------------|---------|----------|-----|
| **Medium** | NEW (regression) | `admin_user_detail` lost its `search_path` pin — `CREATE OR REPLACE` without re-declaring `SET search_path` dropped the 2026-06-22 hardening. Live `proconfig: null`. | `sql/2026-06-29-admin-user-detail-watch-created-at.sql:5` (today) | `ALTER FUNCTION public.admin_user_detail(uuid) SET search_path = pg_catalog, public;` or inline `SET` in the body. |
| **Medium** | NEW (regression) | `admin_last_active` lost its `search_path` pin — same `CREATE OR REPLACE` regression. Live `proconfig: null`. | `sql/2026-06-28-last-active-engagement.sql:21` | `ALTER FUNCTION public.admin_last_active() SET search_path = pg_catalog, public;` |
| **Low** | CARRIED | Test-account password hardcoded in checked-in scripts (test-only account, no real-user data). | `scripts/weekly-measurement-review.py:29`, `rollout-check.py:26`, `nightly-analysis.py:24`, `smoke-test-functions.js:9` | Move `AUTH_PASS` to env/`dev-config`. Low urgency. |
| **Low** | CARRIED | Residual redirect-based SSRF in `extract-url-meta` (`redirect:"follow"` after the private-IP check). Gated **admin-only**. | `supabase/functions/extract-url-meta/index.ts:66-71` | Re-validate final resolved host or `redirect:"manual"`. |

**No new Critical or High findings.** The major new surfaces are properly locked down.

## Detail — M-1 / M-2: search_path pin dropped on two SECURITY DEFINER admin RPCs (NEW regression)

The 2026-06-22 hardening ran `ALTER FUNCTION ... SET search_path = pg_catalog, public` on `admin_user_detail` and `admin_last_active` to stop a user-writable `pg_temp` shadowing objects in a SECURITY DEFINER context (`sql/2026-06-22-audit-hardening.sql:8,10`).

Two later migrations redefined these functions with `CREATE OR REPLACE FUNCTION ... AS $function$ ... $function$` and **no `SET search_path` clause** (`sql/2026-06-28-last-active-engagement.sql`; `sql/2026-06-29-admin-user-detail-watch-created-at.sql`). `CREATE OR REPLACE` resets per-function config unless re-specified, so the pin was silently lost.

Verified live:
```
admin_user_detail  → proconfig: null, prosecdef: true
admin_last_active  → proconfig: null, prosecdef: true
admin_active_days  → search_path=pg_catalog, public   (untouched, still pinned)
admin_traffic_stats→ search_path=pg_catalog, public   (untouched, still pinned)
```

Severity Medium, not High: both still enforce the admin guard (`IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN RAISE EXCEPTION`). Exploitation needs an attacker who can create objects on the search path AND get an admin to invoke the RPC. But it re-opens the class the 06-22 audit closed.

**Standing rule (second occurrence of this pattern):** any redefinition of a SECURITY DEFINER function must carry `SET search_path` inline. The featured-post RPCs do this correctly (`sql/2026-06-27-featured-post.sql:27,78,93`).

## New surfaces verified CLEAN (no findings)

- **Add-from-Photo (wishlist + collection)** — `openWishlistPhoto`/`wlPhotoIdentify` (index.html:21862,21882). Image resized + base64'd **client-side**, POSTed to `identify-watch`; no server-side URL fetch → no SSRF. `identify-watch` requires Bearer + `getUser` and is atomically rate-limited via `bump_rate_limit` (100/hr). Identified fields go to input `.value`, never `innerHTML` → no XSS. Inserts via parameterized client.
- **Badge posts (inline folding)** — feed ribbon coerces each ref with `Number(r)` against the hardcoded `BADGE_BY_REF` table; unknown/forged ref renders nothing. Displayed name is trusted-local + `escHtml`'d. `badge_refs` is on the user's own `logs` row → no cross-user impersonation/injection.
- **Edit-post occasion & strap** — `use_case` chosen from a fixed five-chip set; `saveEditPost` writes via parameterized client; rendered through `escHtml` (index.html:9747). Strap name/material `escHtml`'d. No stored XSS.
- **Featured posts** — all six RPCs carry the admin guard, pin `SET search_path = public`, `REVOKE ... FROM public, anon` then `GRANT ... TO authenticated` only read+admin endpoints. `featured_current` returns only public, non-removed posts. `featured_posts` table: RLS enabled, 0 policies → RPC-only access.
- **Weekly measurement-review engine** — PostgREST params built from internal constants + DB-sourced UUIDs, not user input → no injection. Embedded key is the public anon JWT (safe to commit). No service-role key.

## Carried-forward status (from 2026-06-22)

| 06-22 item | Status now | Evidence |
|---|---|---|
| #1 resend-webhook signature | **FIXED, enforcing** | Live unsigned POST → 401 |
| #2 run-campaign auth | **FIXED** | `x-campaign-secret`/admin gate, fails-closed |
| #5/#27 search-watch-image SSRF + atomic rate limit | **FIXED** | `isSafeFetchUrl`; `bump_rate_limit` |
| #10 search_path on admin RPCs | **PARTIAL REGRESSION** | `admin_active_days`/`admin_traffic_stats` pinned; **`admin_user_detail` + `admin_last_active` lost the pin** (M-1/M-2) |
| #11 send-email/send-push trusted-row | **FIXED** | unchanged |
| #26 email-unsubscribe constant-time HMAC | **FIXED** | `timingSafeEqual` |
| identify-watch / watch-value atomic rate limit | **FIXED** | both call `bump_rate_limit` |

New `send-wear-reminders` is correctly secret-gated and **fails closed** when the secret is unset.

## Recommendation
Re-pin `search_path` on `admin_user_detail` and `admin_last_active` (M-1/M-2) — one SQL statement each. Low items are backlog-grade. No Critical/High exposure in the new surface.
