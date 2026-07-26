# WRotate Security Audit — 2026-07-25

**Scope:** 76 commits since the 2026-07-19 audit. New attack surface: the daily
fun-facts feature (3 new SECURITY DEFINER RPCs, 2 new tables, `identify-watch`
`mode:'facts'`), `fact_clicks`, `admin_fact_counts`, `admin_dod_counts`, the
`one_done_winback` broadcast segment, and the push-permission primer.

**Method:** live grant/`search_path` introspection on every new RPC, live anon-key
probes against every `admin_*` RPC, RLS policy review, caller greps, and a read of
the render path for all newly-stored user-reachable content.

---

## S1 — `commit_watch_fact` is callable by every authenticated user, has zero callers, and writes arbitrary text into a globally shared table — **Medium-High** — **FIXED 2026-07-25 (LIVE)**

`sql/2026-07-20-watch-fun-facts.sql:103` · live DB

The sibling function `commit_watch_fact_srv` is carefully locked down:

```sql
revoke all on function public.commit_watch_fact_srv(...) from public, anon, authenticated;
grant execute on function public.commit_watch_fact_srv(...) to service_role;
```

The client-facing `commit_watch_fact` got no such treatment. Live grants:

| function | grants |
|---|---|
| `commit_watch_fact(text,text,date,text)` | **PUBLIC, anon, authenticated**, postgres, service_role |
| `commit_watch_fact_srv(...)` | postgres, service_role ✓ |
| `pick_watch_fact(text,text,date)` | PUBLIC, anon, authenticated, postgres, service_role |

It is `SECURITY DEFINER`, its only auth check is `if v_uid is null then raise`, and
its body is:

```sql
insert into public.watch_facts(model_key, position, fact)
  values (v_key, v_next, left(trim(p_fact), 500))
```

`watch_facts` is **shared, cross-user content**: its RLS policy is
`for select to authenticated using (true)`, and the feed joins it into every card
(`index.html:10676`, `10732`) so the stored string is displayed to **any user who
wears that model**, not just the writer.

So any signed-in user can write 500 characters of arbitrary text into a pool that
is served to other users as an authoritative "fun fact" about their watch. This is
the same class as 2026-07-19 #10 (`auto-add-brand` writing an unvalidated
`canonical_name` into every user's autocomplete) — except here the text is not even
model-generated, it is caller-supplied verbatim.

**Confirmed dead code.** `grep -rn "commit_watch_fact" --include=*.html --include=*.js
--include=*.ts` (excluding `_srv`) returns **zero callers**. The client path
(`attachFunFact`, `index.html:16642`) calls `pick_watch_fact` and then lets the edge
function commit server-side via `commit_watch_fact_srv`. The client-callable variant
is leftover surface from commit `1bd13b8`, superseded by `fe17a2e`.

**Current blast radius is bounded, and no abuse has occurred:**

```
watch_facts rows: 92   distinct models: 60   max fact length: 295
rows matching '<|onerror|javascript:': 0
```

- Not stored XSS — `funFactCardHTML()` (`index.html:19618`) renders through `escHtml`.
- Pool is hard-capped at 10 positions per model, and `on conflict do nothing` means an
  attacker cannot overwrite an existing fact — only claim unclaimed positions.

So the realistic impact is **content poisoning of a shared surface**, not code
execution or data theft.

**Note on verification:** I attempted a live end-to-end exploit as `testuser` against
an audit-only model key (`ZZ-AUDIT-ONLY`) that no real user owns. The command was
blocked by the sandbox classifier and I did not work around it. The finding rests on
the live grant table, the function source, the RLS policy, and the caller grep — all
of which are shown above. It is not a confirmed live exploit.

**Fix** — one line, mirroring what `_srv` already does:

```sql
revoke execute on function public.commit_watch_fact(text, text, date, text)
  from public, anon, authenticated;
```

Nothing calls it, so this is a no-op for the app. Do **not** revoke
`pick_watch_fact` — that one is live (`index.html:16642`).

---

## S2 — Nine `admin_*` RPCs are still anon-executable (guard holds) — **Low** — **FIXED 2026-07-26 (LIVE)**

Carried forward from **2026-07-19 #1**, which is *mostly* closed. That fix added an
`is_admin` guard to all admin RPCs and `REVOKE`d six of them. Twelve now correctly
deny anon at the grant layer, but nine still rely on the in-function guard alone.

Probed live with the production anon key:

```
admin_traffic_stats          -> 400 {"message":"Not authorized"}
admin_active_dau             -> 400 {"message":"Not authorized"}
admin_last_active            -> 400 {"message":"Not authorized"}
admin_prov2_beta_stats       -> 400 {"message":"Not authorized"}
admin_unsub_stats            -> 400 {"message":"Not authorized"}
admin_broadcast_queue_status -> 400 {"message":"Not authorized"}
admin_demo_views             -> 400 {"message":"Not authorized"}
admin_email_engagement       -> 400 {"message":"Not authorized"}
admin_fact_counts            -> 401 {"message":"permission denied for function"}   ← new, correct
admin_dod_counts             -> 401 {"message":"permission denied for function"}   ← new, correct
```

**Not exploitable** — every one denies. This is a defence-in-depth gap: the guard is
the only thing standing between anon and the data, so a future `CREATE OR REPLACE`
that drops the guard line re-opens the hole silently. The two RPCs added since the
last audit (`admin_fact_counts`, `admin_dod_counts`) got it right, so the pattern is
understood; the remaining nine are just unfinished cleanup.

**Fix:** `REVOKE EXECUTE ... FROM anon` on the nine.

---

## S3 — `identify-watch` facts mode: unvalidated model key, expensive per call — **Low** — **FIXED 2026-07-26 (DEPLOYED)**

`supabase/functions/identify-watch/index.ts:215`

Facts mode is authenticated and shares the existing 100-req/hour rate limit, which is
correct. But `brand`/`model` come straight from the client with no validation against
the `watches`/`brands` tables, and each call is a **grounded Gemini 2.5 Pro search**
(`tools: [{ google_search: {} }]`, `maxOutputTokens: 4096`, 45 s timeout, up to 3
retries). So one signed-in user can mint up to 100 arbitrary `model_key` pools per
hour, each costing a grounded search, for watches nobody owns.

Not a data-exposure issue — a cost/pollution one. Bounded by the existing rate limit,
which is why this is Low. Worth a cheap guard: require that `(brand, name)` matches a
row in the caller's own `watches` before generating.

---

## Verified clean (checked, not assumed)

- **No repeat of the 2026-07-19 High #1 pattern in new code.** Both admin RPCs added
  since carry the `is_admin` guard *and* `REVOKE ... FROM public, anon`.
- **`search_path` is pinned on every new SECURITY DEFINER function.** The three fact
  RPCs use `search_path=public`; Postgres implicitly searches `pg_catalog` first when
  it is not named, so this is safe (the `admin_*` ones use the explicit
  `pg_catalog, public` form — both are fine).
- **`commit_watch_fact_srv` cannot be reached by a client.** It takes an explicit
  `p_user` (spoofable if exposed) and is correctly `service_role`-only. The edge
  function passes `user.id` from a JWT it validated itself, not a client-supplied value.
- **Fun-fact text is escaped on render.** `funFactCardHTML()` → `escHtml(fact)`;
  the pill's `data-log-id` is escaped too.
- **`watch_fact_progress` RLS is correct** — `user_id = auth.uid()` on both `using`
  and `with check`, so no cross-user cursor reads or writes.
- **`fact_clicks` RLS is correct and deliberate** — INSERT-only with
  `user_id = auth.uid()`, no SELECT policy; reads go through `admin_fact_counts()`.
  The comment explaining why a PostgREST upsert must *not* be used here is accurate.
- **`admin_active_days` has no admin guard but is executable by neither `anon` nor
  `authenticated`** (checked with `has_function_privilege`). It is an internal helper
  for other admin RPCs. Not a finding.
- **No secrets in the repo.** `*.p8`, `dev-config.js`, and `CLAUDE.md` are all
  gitignored and `git ls-files` confirms none are tracked.
- **`admin_fact_counts` internal-account exclusion is sound** — `user_id <> all(...)`
  is correct against an empty array, and `user_id` is `NOT NULL` so no NULL trap.

## Status

| Severity | Count |
|---|---|
| High | 0 |
| Medium-High | 1 (S1) |
| Low | 2 (S2 carried forward/partial, S3) |
