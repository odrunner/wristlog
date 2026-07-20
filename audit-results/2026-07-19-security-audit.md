# WRotate Security Audit — 2026-07-19

Scope: ~101 commits since 2026-06-29. SES migration, SNS webhook, `brands` RLS lockdown,
`admin_email_engagement` rewrite, `loadMyProfile` hardening, brand-autocomplete escaping.
Every finding verified against the live database or by exercising the deployed endpoint.
Read-only — no code modified.

Previous cycle: `2026-06-29-security-audit.md` (0 Crit · 0 High · 2 Med · 2 Low).

## Summary

| # | Sev | New/Carried | Finding | Location |
|---|-----|-------------|---------|----------|
| 1 | **High** | CARRIED (newly identified) | Six SECURITY DEFINER `admin_*` RPCs executable by **anon** — no guard, no REVOKE. Verified exploitable. | live DB grants |
| 2 | Med | NEW | Third brand-autocomplete injection site still inlines the name into `onmousedown` with `escHtml` (does not escape `'`). | `index.html:21157` |
| 3 | Med | NEW | `auto-add-brand` writes Claude's `canonical_name` with `is_canonical=true` without re-validating. | `auto-add-brand/index.ts:105,121,137` |
| 4 | Med | NEW | `auto-add-brand` unauthenticated and unrate-limited. Verified 200 with no auth header. | `auto-add-brand/index.ts:27` |
| 5 | Low | NEW | `send-broadcast` compares the cron secret with `===` (non-constant-time). | `send-broadcast/index.ts:99` |
| 6 | Low | NEW | SES error bodies / raw exception strings returned to unauthenticated callers. | `send-email/index.ts:154,162`; `ses-webhook/index.ts:135` |
| 7 | Low | NEW | `ses-webhook` has no `MessageId` dedup; replay bounded only by the 300 s window. | `ses-webhook/lib.ts:76` |
| 8 | Low | CARRIED | Test-account password hardcoded in checked-in scripts. | `scripts/*.py`, `smoke-test-functions.js:9` |
| 9 | Low | CARRIED | Redirect-based SSRF in `extract-url-meta` (admin-gated). | `extract-url-meta/index.ts:66` |

**Confirmed FIXED:** M-1 and M-2 — `search_path` pins on `admin_user_detail` and
`admin_last_active` are holding.

---

## 1. High — Six admin RPCs callable anonymously

Live grants: `admin_dod_counts`, `admin_email_stats`, `admin_measurement_counts`,
`admin_totals`, `admin_valuation_counts`, `campaign_send_counts` all show
`anon=X/postgres`, all are `prosecdef = true`, and none contain an admin guard.

```sql
CREATE OR REPLACE FUNCTION public.admin_totals()
 RETURNS TABLE(follows_count bigint, likes_count bigint, valuation_count bigint)
 LANGUAGE sql SECURITY DEFINER
AS $function$ SELECT (SELECT count(*) FROM follows), (SELECT count(*) FROM likes),
   (SELECT count(*) FROM valuation_events); $function$
```

**Verified exploit** — POST to `/rest/v1/rpc/<fn>` with only the public anon key from
`index.html`, no session:

```
admin_email_stats         200  [{"event_type":"delivered","cnt":1664}, {"opened":1000}, …]
admin_totals              200  [{"follows_count":88,"likes_count":1590,"valuation_count":1072}]
campaign_send_counts      200  [{"campaign_id":"27f3ab45-…","count":361}, …]
admin_measurement_counts  200  [{"user_id":"a6188115-…","count":4}, …]
admin_valuation_counts    200  [{"user_id":"bbbc3d2b-…","count":43}, …]
admin_email_engagement    400  {"message":"Not authorized"}   ← correctly guarded
```

**Impact:** any internet user can pull the private business dashboard. The two per-user
functions expose a UUID → behavioral-volume map, joinable against public profile UUIDs to
deanonymize who measures and prices watches most.

Pre-existing (`admin_totals` from `dd7cdde`, `campaign_send_counts` from `5df2dd9`); missed
by prior cycles because those checked `search_path` pinning on the `admin_*` family, never
`proacl` or guard presence.

**Fix** — per function:
```sql
REVOKE EXECUTE ON FUNCTION public.admin_totals() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.admin_totals() TO authenticated;
-- first statement in each body:
IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  THEN RAISE EXCEPTION 'Not authorized'; END IF;
-- plus: SET search_path = pg_catalog, public
```
All six also lack a `search_path` pin, so one migration closes both. `touch_presence` is
unpinned too but is correctly self-scoped and needs only the pin.

## 2. Med — Missed brand-autocomplete injection site

`index.html:21157` (Add-from-Photo edit row):
```js
onmousedown="document.getElementById('af2-edit-brand-${idx}').value='${escHtml(b)}';…"
```
`escHtml` escapes `& < > "` but **not** `'`; `escAttr` adds `'`. `isValidBrandName`
explicitly permits `'`, so a name like `Beda'a` terminates the JS string literal — exactly
the bug fixed at 20341/22847 this cycle. Chained with #3 the content is attacker-chosen.

**Fix:** apply the existing `data-brand="${escAttr(b)}"` + `this.dataset.brand` pattern.

## 3. Med — Unvalidated model output written to the shared brand list

```ts
57:  if (!isValidBrandName(requestedName)) return 400;   // requested name only
80:  content: `Is "${requestedName}" a real wristwatch or clock brand? …`
105: const finalName = pickFinalBrandName(parsed.canonical_name, requestedName);
137: .insert({ name: finalName, is_canonical: true });   // finalName NEVER re-validated
121: .update({ is_canonical: true }).eq("name", existing.name);  // promote, no revalidation
```
`is_canonical: true` (added this cycle) is what raises severity: a poisoned row is no
longer personal-only, it renders in every user's autocomplete.

**Fix:** `isValidBrandName(finalName)` before both the insert and the promote.

## 4. Med — `auto-add-brand` unauthenticated and unrate-limited

Verified: `POST /functions/v1/auto-add-brand` with no `Authorization` and no `apikey`
returns `200 {"skipped":"not a brand request"}`. No JWT check, no shared secret, no
`bump_rate_limit`. Any authenticated user can create one qualifying `feedback` row, then
replay its id unboundedly from an unauthenticated context; each replay spends a
`claude-sonnet-4-6` call with `max_uses: 3` web searches.

**Fix:** require the `x-campaign-secret` pattern, add `bump_rate_limit` keyed on
`record.id`, and skip when `record.status = 'resolved'` (already set at lines 122/148).

## 5-7. Low

**#5** `send-broadcast/index.ts:99` uses `===` where `run-campaign:325` uses
`timingSafeEqual`. Hygiene, not exposure.

**#6** `send-email/index.ts:154` returns `details: result.error` (SES body) and `:162`
returns `String(err)`; `ses-webhook/index.ts:135` likewise. Both endpoints unauthenticated.
*Unverified suspicion:* SigV4 failures may echo the `AccessKeyId` — could not induce
without valid credentials. The actionable part is returning raw internals anonymously.

**#7** Timestamp *is* inside the signed canonical string, so the ±300 s window cannot be
forged. But `email_events` has no unique index on `email_id`, and the webhook does not
dedup on `MessageId` — an attacker holding the URL token could replay within 5 minutes.

---

## Verified clean

**SNS webhook signature — genuinely cryptographic.** `ses-webhook/index.ts:46-64` fetches
the signing cert, imports it as `RSASSA-PKCS1-v1_5`, and calls `crypto.subtle.verify`.
`isValidCertUrl` (`lib.ts:100`) pins the host with anchored
`^sns\.[a-z0-9-]+\.amazonaws\.com$` plus `https:` and `.pem`. Verification runs **before**
the `SubscribeURL` fetch, and that URL is host-checked too. **An attacker cannot forge
`email_events` rows.** Token and topic checks are written fail-open but both secrets are
confirmed set, and a live unauthenticated POST returns 401.

**Secrets handling.** Grepped all seven migrated senders for secret names in log/response
positions — none logged, returned, or echoed.

**`brands` RLS.** One policy: `"Anyone can read brands"`, `polcmd = r`, `using = true`,
`relrowsecurity = true`, zero write policies. Client writes blocked; service role only.

**`admin_email_engagement`.** Correctly guarded and pinned. Internal filter joins
`internal_accounts → auth.users.email` plus `NOT LIKE '%@wrotate.com'` — no hardcoded
UUIDs. Render path escapes label and masked recipient.

**`loadMyProfile`.** `classifyProfileLoad` treats only `PGRST116`/null-error as missing;
everything else retries once then bails. `.insert(...)` not `.upsert(...)`. Sound.

## Recommended order

1. **#1** — one migration, six functions; closes the residual `search_path` gap too.
2. **#3 + #4** together — both in `auto-add-brand`.
3. **#2** — copy the correct pattern from line 20341 to 21157.
4. #5-#7 as hygiene.
