# Security Audit — WRotate (June 22, 2026)

**Auditor:** Claude (automated deep-dive)
**Scope:** All 19 edge functions (`--no-verify-jwt`, self-auth), client XSS sinks in `index.html`, SECURITY DEFINER admin RPCs + search_path pinning, repo secret hygiene, SSRF in URL-fetching functions, rate limiting / abuse on email-push-broadcast paths.
**Reference:** `2026-06-12-security-audit.md` (prior audit — NEW-1 admin_user_stats fixed, NEW-2/NEW-3 + several MEDIUM/LOW carried).

## Status Legend
🔴 Open · 🟡 Partial · 🟢 Fixed · ⚪️ Accepted

---

## Summary

Overall posture: **YELLOW.** No anon-callable data-dump like June's NEW-1 (that fix re-verified). But the email/webhook surface has grown (`run-campaign`, `resend-webhook`, `send-broadcast`) and two functions in that surface are effectively unauthenticated, which I'm rating higher than the prior audit did:

- **CRIT — `resend-webhook` does a service-role insert with no signature check.** Prior audit logged this as N39 MEDIUM ("WEBHOOK_SECRET declared but never used"). Re-reading it: any anonymous POST shaped `{type,data}` writes attacker-controlled rows into `email_events`, which feed the admin engagement dashboards. That's unauthenticated write to a metrics table via the public function URL → I'm raising it to **HIGH/CRIT**.
- **HIGH — `run-campaign` (NEW function since June 12) has no auth at all.** `Deno.serve(async (_req) => ...)` ignores the request entirely. Any anonymous caller can force the daily drip campaign to fire and burn Resend quota.
- **HIGH — `feedback-to-github` webhook has no shared secret AND injects raw user text into an issue whose `auto-bug` label triggers Claude Code to write a fix.** Prompt-injection-into-automated-codegen path, forgeable by anyone who reaches the URL with a guessed/known record id.
- **HIGH — SSRF in `search-watch-image`** (carried N4, re-confirmed): any authenticated user, `redirect:"follow"`, no private-IP check → cloud-metadata / internal-host reachable. 200/hr.

Verified good: secrets still untracked (`*.p8`, `dev-config.js`, `CLAUDE.md` all gitignored, `git ls-files` shows none tracked); no `service_role` in client; client XSS sinks consistently route user content through `escHtml`/`escAttr` (both helpers present, `index.html:6115-6120`); `delete-user` and `watch-value` are clean (self-scoped JWT, no IDOR); `admin_user_stats` June fix re-verified (guard + search_path + REVOKE in `20260612_guard_admin_user_stats.sql`).

---

## Counts by Severity

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 3 |
| Medium | 6 |
| Low | 6 |

---

## Carried-Forward Status

| Prior ID | Sev (then) | Status now | Note |
|----------|-----------|-----------|------|
| NEW-1 admin_user_stats anon-callable | HIGH | 🟢 **RE-VERIFIED FIXED** | `20260612_guard_admin_user_stats.sql`: is_admin guard + `SET search_path=public` + `REVOKE … FROM public, anon`. |
| NEW-2 SECURITY DEFINER no search_path pin | MEDIUM | 🔴 **STILL OPEN** | `admin_user_stats` + `admin_demo_views` pin it; `admin_user_detail` (20260531), `admin_last_active`, `admin_active_days`, `admin_traffic_stats` (20260421) do **not**. See C/F-M1. |
| NEW-3 / N4 SSRF redirect-follow | MEDIUM/LOW | 🔴 **STILL OPEN — raised** | `extract-url-meta` (admin) MEDIUM; `search-watch-image` (any user, 200/hr) raised to **HIGH** (H4). |
| N39 resend-webhook no sig verify | MEDIUM | 🔴 **OPEN — RAISED to CRIT** | See C1. `RESEND_WEBHOOK_SECRET` still loaded (`index.ts:5`), still never used; insert at `:26`. |
| N40 send-report no HTML sanitize | MEDIUM | 🔴 STILL OPEN | Admin-gated (Bearer→getUser→internal_accounts); defense-in-depth only. |
| N32 send-email/send-push no rate limit | MEDIUM | 🔴 STILL OPEN | Both webhook-triggered + record-existence check; see M2 (record-verify gap is the bigger issue). |
| N10 share-collection SVG `<image href>` no scheme check | MEDIUM | 🔴 STILL OPEN | `<image>` won't execute JS; low practical risk; carried. |
| S7 page_visits anon insert no rate limit | MEDIUM | 🔴 STILL OPEN | Not re-queried this session; no change expected. |
| N41 no frame-ancestors / X-Frame-Options | LOW | 🔴 STILL OPEN | CSP `index.html:9` still lacks `frame-ancestors`. |
| N42 escHtml in single-quote JS attr | LOW | 🔴 **STILL OPEN** | `escAttr` helper now exists (`:6119`) but the two brand-autocomplete sinks still call `escHtml` inside single-quoted onmousedown: `index.html:18769` `selectBrand('${escHtml(b)}')` and `:21058` `selectWlBrand('${escHtml(b)}')`. Brand list internal → low. |
| N43 open CORS proxies in CSP | LOW | 🔴 STILL OPEN | `corsproxy.io` + `api.allorigins.win` still in `connect-src` (`index.html:9`); used at `:17868, :17947, :21139, :21279`. |
| N44 dev-config.js creds | LOW | 🔴 Carried | gitignored, untracked; on dev host only. |
| N34 Supabase token in CLAUDE.md | LOW | 🟡 Carried | gitignored, untracked. |
| 2026-05-31 demo_readonly permissive | CRIT | 🟢 Re-verified FIXED | `20260531_demo_readonly_restrictive.sql`. |

---

## New / Re-Rated Findings

### C1 — `resend-webhook` inserts to `email_events` with service role and NO signature check 🔴 CRITICAL (re-rated up from N39)
- **File:** `supabase/functions/resend-webhook/index.ts:5` (secret loaded), `:13-26` (validate shape → service-role insert).
- **Description:** `WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET")` is declared at line 5 and **never referenced again**. `isValidPayload()` only checks `type`/`data` exist. Any anonymous POST of that shape causes `supabase.from("email_events").insert(row)` at line 26 with the service role. The function is deployed `--no-verify-jwt`, so the Supabase gateway does not gate it either — the URL is wide open.
- **Impact:** Unauthenticated write to `email_events`. An attacker can fabricate delivered/opened/clicked/bounced events for arbitrary recipient addresses, **poisoning the admin email-engagement dashboards** (which the founder reads to make product decisions), or spam-insert rows to bloat the table. No read leak, but integrity + availability impact on a metrics table.
- **Fix:** Verify the Svix signature before inserting — read `svix-id`, `svix-timestamp`, `svix-signature` headers, recompute HMAC-SHA256 over `${id}.${timestamp}.${body}` with `RESEND_WEBHOOK_SECRET`, constant-time compare. Reject on mismatch with 401.
- **Confidence:** High (read directly).

### H1 — `run-campaign` has no authentication 🔴 HIGH (NEW — function added since June 12)
- **File:** `supabase/functions/run-campaign/index.ts:37` — `Deno.serve(async (_req: Request) => {` ignores the request; no JWT check, no admin check, no shared-secret header.
- **Description:** The function fetches active `email_campaigns`, finds users in the signup window, and batch-sends drip emails via Resend using the service role (`:39`). Reachable anonymously at the public function URL (`--no-verify-jwt`).
- **Impact:** Any anonymous caller can force the day's drip-campaign batch to send, burning Resend quota and potentially emailing users prematurely. Per-campaign send-tracking dedup (`:159-166`) prevents *duplicate* sends to a given user but not forced-early sends or quota abuse.
- **Fix:** Require a shared-secret header (`Authorization: Bearer <CRON_SECRET>`) checked against an env var, or an admin JWT. Whatever cron/scheduler invokes it should pass that secret.
- **Confidence:** High (read directly).

### H2 — `feedback-to-github`: no webhook secret + raw user text into auto-fix issue 🔴 HIGH (re-rated from N-webhook-family)
- **Files:** `supabase/functions/feedback-to-github/index.ts:35-43` (record-existence check only, no shared secret); `feedback-to-github/lib.ts:61` (`record.details` injected raw) and `:65` (`auto-bug` label "will trigger Claude Code to analyze and attempt a fix").
- **Description:** Like the other DB-webhook functions, this only re-fetches by `record.id` to confirm the row exists — there is no shared secret, so with `--no-verify-jwt` anyone who reaches the URL with a known/guessed feedback UUID can replay it. The created GitHub issue embeds the user-supplied `details` verbatim, and the `auto-bug` label kicks off an automated Claude Code fix pipeline.
- **Impact:** Prompt-injection into an automated code-writing pipeline (attacker-controlled text → issue body → Claude Code attempts a "fix"), plus issue-spam on the repo. The codegen automation amplifies impact well beyond ordinary feedback handling.
- **Fix:** Add a shared-secret/HMAC header check (same fix as M2 family). Treat `details` as untrusted in the auto-fix pipeline (the human-in-the-loop should review before any code is written/merged).
- **Confidence:** High for the no-secret + raw-injection facts; Medium on practical exploitability (requires a valid record id and reaching the function URL).

### H3 — SSRF in `search-watch-image` (any authenticated user) 🔴 HIGH (carried N4, re-rated)
- **Files:** `supabase/functions/search-watch-image/index.ts:182,195` (`fetch` with `redirect:"follow"`), `lib.ts:57-66` (`looksLikeProductUrl` only counts path segments — not a host allowlist).
- **Description:** A client-supplied product URL is fetched with redirect-following and no private-IP / scheme validation. Reachable by any logged-in user at 200/hr.
- **Impact:** SSRF to `http://169.254.169.254/...` (cloud metadata), `127.0.0.1`, and internal hosts; response body returned to the caller. Higher reachability than `extract-url-meta` (which is admin-gated).
- **Fix:** Resolve the host, reject private/link-local/loopback IP ranges (incl. IPv6 `[::1]`, decimal/octal encodings), use `redirect:"manual"` and re-validate each `Location` hop (cap hops).
- **Confidence:** High.

### M1 — SECURITY DEFINER admin functions lack `search_path` pinning 🔴 MEDIUM (carried NEW-2)
- **Files (no `SET search_path`):** `admin_user_detail` (`20260531_admin_last_active.sql:16`, also redefined `20260531_user_presence.sql:40`), `admin_last_active` (`20260531_admin_last_active.sql:107`), `admin_active_days` (`20260601_repeat_user_cross_feature.sql:15`), and `admin_traffic_stats` (`20260421_admin_dod_counts.sql`). Only `admin_user_stats` (`20260612`) and `admin_demo_views` (`20260607:28`) pin it.
- **Impact:** Privilege-escalation hardening gap — a SECURITY DEFINER function with an unpinned search_path can be hijacked if an attacker can create objects in a schema preceding `public`. Mitigated by Supabase's locked-down `CREATE` on `public`.
- **Fix:** Add `SET search_path = public` to each. (`admin_active_days` already REVOKEs execute from public/anon/authenticated — good; keep that.)
- **Confidence:** High.

### M2 — Webhook functions trust the request body; only verify record *exists* (IDOR-ish) 🔴 MEDIUM (NEW angle)
- **Files:** `send-email/index.ts:54-61`, `send-push/index.ts:120-128`, plus `auto-add-brand`, `new-user-alert`, `report-notify`, `feedback-to-github` (record-existence check pattern).
- **Description:** Each re-fetches the row by `record.id` only, confirming it exists, then acts on the **request body's** fields (`user_id`/`type`/`actor_id`) rather than the stored row's fields. With `--no-verify-jwt` and no shared secret, a caller who knows a valid notification/feedback UUID can replay the webhook or steer a push/email to a chosen user/type.
- **Impact:** Email/push directed to chosen recipients, replayed admin alerts, re-added brands. Constrained by UUID-guessing (unguessable in practice) but the trust-the-body pattern is the root issue.
- **Fix:** Add a shared-secret header on all DB-webhook functions; act on the **stored row's** fields, not the request body's.
- **Confidence:** Medium.

### M3 — Unescaped `display_name` in `run-campaign` drip emails 🔴 MEDIUM (NEW)
- **File:** `run-campaign/lib.ts` `personalizeBody` substitutes `{{name}}` with raw `display_name` into HTML with no escaping (contrast `send-email` which escapes via `esc()`).
- **Impact:** HTML injection into outbound campaign emails via a user's own display name. Low blast radius (their own email), but inconsistent with the rest of the email pipeline.
- **Fix:** Escape `display_name` before substitution.
- **Confidence:** Medium.

### M4 — `extract-url-meta` SSRF via redirect (admin-gated) 🔴 MEDIUM (carried NEW-3)
- **File:** `extract-url-meta/index.ts:66-72` — initial URL validated against private hosts, but `redirect:"follow"` lets a public URL 30x-redirect to an internal/metadata host that is never re-validated. Hostname-string check only (misses IPv6 `[::1]`, decimal/octal IPs, DNS rebinding).
- **Impact:** SSRF, but `is_admin`-gated (`:41-54`) → effectively Low unless an admin account is compromised.
- **Fix:** `redirect:"manual"` + per-hop resolved-IP re-validation. Same fix as H3.
- **Confidence:** High.

### M5 — `send-report` passes admin HTML to Resend without sanitization 🔴 MEDIUM (carried N40)
- **File:** `send-report/index.ts` `buildResendBody()`; no `sanitize` call in index.ts or lib.ts.
- **Impact:** Admin-gated (Bearer → getUser → internal_accounts), so defense-in-depth only.
- **Fix:** Run `sanitizeHtml()` on the html before send.
- **Confidence:** High.

### M6 — `page_visits` anon insert, no rate limit 🔴 MEDIUM (carried S7)
- RLS policy "Anyone can insert page visits" (`anon`, `with_check: path IS NOT NULL`) — unauthenticated insert, no rate limit. Not re-queried this session; carried.

### LOW

- **L1 (carried N10)** — `share-collection/lib.ts:47` SVG `<image href="${esc(w.image)}">` — no URL-scheme validation; `<image>` won't execute JS. 🔴
- **L2 (carried N41)** — CSP (`index.html:9`) has no `frame-ancestors` and no `X-Frame-Options`. 🔴
- **L3 (carried N42, re-confirmed)** — `escHtml(b)` inside single-quoted JS attribute at `index.html:18769` and `:21058`; should use the existing `escAttr` (`:6119`). Brand list internal → low. 🔴
- **L4 (carried N43)** — `corsproxy.io` + `api.allorigins.win` (open proxies) still in CSP `connect-src` and used at `index.html:17868/17947/21139/21279`. 🔴
- **L5 — `email-unsubscribe` reuses `SUPABASE_SERVICE_ROLE_KEY` as HMAC key + non-constant-time compare** (`index.ts:33`, `lib.ts:33-34` `sig === expected`). Widens blast radius of the signing key; timing side-channel on the unsubscribe MAC. Reflects `uid`/`cat` unescaped into response HTML but gated behind the HMAC. 🔴 NEW
- **L6 — `identify-watch` rate limiter fails open on error** (`index.ts:117-120`) — since it calls paid AI APIs, a forced error path enables cost-abuse. 🔴 NEW

---

## Verified-Good (no action)

- **Secrets:** `git ls-files | grep -iE '\.p8|dev-config|\.env|CLAUDE\.md'` → none tracked. `.gitignore` covers `dev-config.js`, `CLAUDE.md`, `*.p8`. No `service_role`/`SERVICE_ROLE` string in `index.html` (0 hits). ✅
- **Client XSS:** `escHtml` (`:6116`) escapes `&<>"`; `escAttr` (`:6119`) adds `'`. Targeted greps for templated `innerHTML`/`insertAdjacentHTML` carrying user fields (comment/bio/note/caption/display_name/brand/model/location) without an escape helper returned no hits (matches were minified Supabase lib only). `sanitizeImageUrl` (`:17934`) blocks `javascript:`/`data:`/`http:` schemes. ✅
- **`delete-user`** — JWT `getUser()` (`index.ts:36`), deletes own `user.id` only (`:42`). No IDOR. ✅
- **`watch-value`** — JWT auth, `user_id` filter on read and write; only fetches a fixed Anthropic endpoint. 20/day rate limit. ✅
- **`demo-login`** — mints a session for the fixed `demo@wrotate.com` only; 5/10min per IP. Not an arbitrary-account session minter. ✅
- **`send-broadcast`** — hardcoded `ADMIN_USER_ID` gate (`index.ts:74-88`). ✅
- **`share-collection`/`share-post`** — public by design but privacy-gated at the query level (`share-collection/lib.ts:142-150`, `share-post/index.ts:62-65`). ✅
- **No SQL string concatenation** in any edge function — all DB access via the parameterized Supabase query builder. ✅
- **admin_user_stats June NEW-1 fix** re-verified in `20260612_guard_admin_user_stats.sql` (guard + search_path pin + REVOKE public/anon). ✅

---

## Priority Actions
1. **C1 (CRIT)** — Verify Svix signature in `resend-webhook` before the service-role insert.
2. **H1 (HIGH)** — Add a shared-secret/admin check to `run-campaign` (it currently ignores the request entirely).
3. **H2 (HIGH)** — Shared-secret on `feedback-to-github`; treat `details` as untrusted in the auto-fix pipeline (human review before codegen).
4. **H3 (HIGH)** — Private-IP + manual-redirect re-validation in `search-watch-image`; apply the same to `extract-url-meta` (M4).
5. **M1 (MED)** — Pin `SET search_path = public` on `admin_user_detail`, `admin_last_active`, `admin_active_days`, `admin_traffic_stats`.
6. **M2 (MED)** — Shared-secret on all DB-webhook functions; act on stored row fields, not request body.
7. **M3/M5 (MED)** — Escape `display_name` in `run-campaign`; sanitize html in `send-report`.
8. **L3/L2/L4 (LOW)** — `escAttr` at `index.html:18769/21058`; add `frame-ancestors 'self'`; drop open CORS proxies from CSP.
