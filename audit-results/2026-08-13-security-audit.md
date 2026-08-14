# Security Audit — 2026-08-13

Fresh audit (not a re-run of prior checklists). Every finding below was verified
against the live database or in a real browser — no findings inferred from
reading code alone.

**Scope:** RLS policy semantics, edge function auth, client-side injection, secret
handling, third-party data flow.

**Headline:** the privacy controls the app offers users are not enforced at the
database level. Three separate settings — profile privacy, watch privacy, wishlist
privacy — are honoured by the UI but bypassable via the REST API. This is new;
none of the 60+ prior audit files flagged it.

---

## S1 — CRITICAL (NEW): Profile privacy is not enforced. 128 users affected.

The app offers Public / Followers / Private for a profile (`index.html:8715-8717`).
55 users chose Private and 73 chose Followers-only — 25% of the user base. **All 128
are fully readable by an anonymous, logged-out stranger.**

`profiles` carries four overlapping `SELECT` policies, every one of them
`USING (true)`, two granted to role `public`:

| policy | role | qual |
|---|---|---|
| `Public profiles are viewable by everyone` | public | `true` |
| `profiles_read` | public | `true` |
| `profiles_readable_by_authenticated` | authenticated | `true` |
| `profiles_select` | authenticated | `true` |

Verified as `anon` (no JWT):

```sql
SET LOCAL ROLE anon;
SELECT count(*) FROM profiles WHERE profile_privacy='private';
-- 55
SELECT count(*), count(*) FILTER (WHERE is_admin), count(timezone) FROM profiles;
-- 516 rows enumerable | 1 admin identifiable | 250 timezones
```

The whole user table is enumerable without an account: username, display_name, bio,
avatar_url, `timezone` (coarse location for 250 users), `email_prefs`, and
`is_admin` — which names the single account worth attacking.

`profile_privacy` is read by the client (`index.html:8374`) and drives what the UI
renders. That is the only place it is enforced.

### Fix — REVISED 2026-08-13 after read-only simulation

**A row-level policy is the wrong instrument here. Do not use it.** The original
proposal in this report was:

```sql
-- REJECTED — would break the app. Kept for the record.
CREATE POLICY profiles_select_respecting_privacy ON profiles FOR SELECT USING (
  id = auth.uid() OR profile_privacy = 'public' OR profile_privacy IS NULL
  OR (profile_privacy = 'followers' AND EXISTS (
        SELECT 1 FROM follows f WHERE f.follower_id = auth.uid() AND f.following_id = profiles.id)));
```

Simulating it against the client showed the app reads *other users'* profile rows in
~20 places for identity, not merely to render the profile page:

| surface | columns read | effect if the row is hidden |
|---|---|---|
| Follow button (`friendActionBtn`, `index.html:16224`) | `profile_privacy` | cannot distinguish "Follow" from "Request to Follow" |
| Search / discover | `id, username, display_name, avatar_url` | private users become unfindable — **nobody could ever request access** |
| Feed authors | `+ is_official` | blank author on public posts by private users |
| Follower/following lists, mention autocomplete, club member lists, notification actors | same identity set | rows disappear |

Hiding the row breaks the mechanism by which a stranger asks a private user for
access. That is a worse bug than the leak.

**The leak is column-scoped, not row-scoped.** The sensitive columns — `is_admin`,
`email_prefs`, `timezone`, `rec_settings`, `eula_accepted_at`, `is_suspended`,
`suspended_at`, `ab_variant`, `tg_debug`, `username_set`, `share_achievements`,
`theme_preference` — are read by the client **only through own-profile
`select('*')`**, and all three of those call sites are `.eq('id', currentUser.id)`
(`index.html:8109, 8113, 8144`). Every other-user read uses an explicit safe column
list.

One exception: `index.html:8367` selects `email_prefs` for *any* profile, because a
single query serves both the own-profile and other-profile views.

**Step 1 — client (one line).** Select `email_prefs` only when `isOwn`, so another
user's notification preferences are never fetched.

**Step 2 — revoke the sensitive columns from `anon`.** Safe because anon has no own
profile and every anon-reachable path uses an explicit safe column list
(`p/index.html:261`, `profile/index.html:368`, and the logged-out public feed).

```sql
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (id, username, display_name, avatar_url, bio, is_official,
              profile_privacy, collection_visibility, wishlist_visibility)
  ON public.profiles TO anon;
```

Rollback is a single statement: `GRANT SELECT ON public.profiles TO anon;`

This closes anonymous enumeration of all 516 users, including which account is
`is_admin` and the 250 stored timezones.

**Step 3 — the `authenticated` half (follow-up, larger).** Column privileges are
granted per *role*, not per row, so the same revoke cannot be applied to
`authenticated` without breaking own-profile `select('*')`. Closing it properly means
moving the sensitive columns to a `profile_private` table keyed on `user_id` with an
own-row-only policy. Note `is_admin` is referenced inside other RLS policies
(`EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin)`), so those
policies must move with it. Schema change plus client refactor — scope separately.

**Residual after steps 1-2:** any logged-in user can still read every profile column.
That is a smaller exposure than anonymous scraping, but it is not closed until step 3.

---

## S2 — HIGH (NEW): Watch and wishlist privacy bypassed by a looser sibling policy.

Postgres ORs permissive policies together, so the **most permissive one wins**.
`watches` has a carefully written policy and a careless one:

- `Others can read shared watches` (public) — correctly checks public / followers / friends
- `watches_public_read` (authenticated) — `user_id = auth.uid() OR watch_privacy IS DISTINCT FROM 'private'`

`'friends' IS DISTINCT FROM 'private'` is **true**, so the second policy grants every
logged-in user read access to every followers- and friends-only watch. The careful
policy is dead code.

Proven against production — a real friends-only watch read as an unrelated
authenticated user with no follow and no accepted friend request:

```sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"1bdf3959-…","role":"authenticated"}',true);
SELECT id, watch_privacy, brand, name, price FROM watches WHERE id='mm5xcry6ocgufb936t';
-- friends | Van Cleef & Arpels | Alhambra watch, small model | 15854
```

Blast radius, measured as that same unrelated user:

- **56 restricted watches across 12 users** readable
- **29 carry a purchase price, 8 an insured value**
- `watches` also holds `insurance`, `insurance_notes`, `receipts`, `warranty_expiry`, `purchase_date`

A third policy, `watches_feed_read`, is looser still — it exposes a watch if *any*
log referencing it is non-private, which leaks watches explicitly marked
`private`. Confirmed: **1 private watch is currently readable** by that unrelated user.

`wishlist` repeats the pattern exactly (`Non-private wishlist items readable by
authenticated users`); 1 friends-only row currently leaks.

Anonymous users are **not** affected here (verified: 0 rows) — this one needs an
account, which is free.

**Fix:** drop `watches_public_read`, `watches_feed_read` and
`Non-private wishlist items readable by authenticated users`. The correctly-scoped
`Others can read shared watches` / `Others can read shared wishlist` policies already
cover the legitimate cases. Re-test the feed, since `watches_feed_read` was presumably
added to make feed post cards resolve their watch — if the feed breaks, fix it with a
join through `logs` in the *existing* policy rather than reinstating a blanket read.

**Systemic note:** this class of bug is invisible when reviewing policies one at a
time. Worth a standing rule: never add a second permissive `SELECT` policy to a table
that already has a privacy-aware one — tighten the existing policy instead. Note the
contrast with the demo-account guards, which get this right: all 21 of them are
correctly `RESTRICTIVE` (checked, no exceptions).

---

## S3 — MEDIUM (NEW): Stored XSS via `display_name` in `onclick` handlers.

`escAttr()` escapes `'` to `&#39;`, which is correct for an HTML attribute but
**not** for a JavaScript string inside one. The HTML parser decodes the entity back
to `'` before the JS is compiled, so the quote breaks out of the string literal.

Proven in real Chromium (not reasoned about):

```
payload stored in display_name : x'),window.__PWNED=1,blockUser('y
after escAttr()                : x&#39;),window.__PWNED=1,blockUser(&#39;y
JS the browser actually ran    : blockUser('uid','x'),window.__PWNED=1,blockUser('y')
>>> XSS EXECUTED
```

Reachable sinks, all interpolating attacker-controlled text into a JS string:

| line | sink | attacker controls |
|---|---|---|
| `index.html:8640` | `blockUser('${profile.id}','${escAttr(profile.display_name…)}')` | their own display_name |
| `index.html:9895` | `showMemberMenu(…,'${escAttr(m.display_name…)}',this)` | their own display_name |
| `index.html:9940` | `openDeleteClubModal('${clubId}','${escAttr(club.name)}')` | club name |

There is no `CHECK` constraint on `profiles.display_name` and users may `PATCH`
their own row directly (`profiles_update: id = auth.uid()`), so client-side input
validation is not a control here.

**Severity is tempered** by requiring a click: the payload fires when the victim
presses *Block User* or opens a club member menu. That is still a realistic chain —
"victim goes to block the abusive account" is precisely when they click that button —
and it runs with the victim's session. The CSP does not help: `script-src` includes
`'unsafe-inline'` (required by the inline-handler style throughout).

Checked and **not** vulnerable: `renderCommentBody` mention links
(`index.html:15956`) — the `@([\w.]+)` regex cannot match a quote.

No live data currently triggers this — 0 profiles and 0 clubs contain an apostrophe
today, so nothing is broken for real users right now. (32 `watches.name` values
contain one, but watch names do not reach a handler attribute.)

**Fix:** stop passing text through handler attributes. Pass the id only and look the
name up in the handler:

```js
onclick="blockUser('${profile.id}')"   // resolve display_name inside blockUser()
```

That removes the sink class rather than patching the escaper. If a string must be
embedded, use `JSON.stringify(s).replace(/[<>&']/g, c => '\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))`.
Also add a `CHECK` on `display_name` length as defence in depth.

---

## S4 — LOW (NEW): Unsubscribe links are HMAC'd with the service-role key.

`email-unsubscribe/index.ts:32` uses `SUPABASE_SERVICE_ROLE_KEY` as the HMAC signing
key. The crypto itself is sound (SHA-256, constant-time compare in `lib.ts:32-43`),
but reusing the highest-value credential in the project as a signing key means
rotating that key silently invalidates every unsubscribe link in every email already
delivered — recipients get "This link has expired" and, under CAN-SPAM/GDPR, a broken
unsubscribe is a compliance problem, not a cosmetic one.

**Fix:** a dedicated `UNSUBSCRIBE_HMAC_SECRET`. Accept both keys during a
transition window so links already in inboxes keep working.

---

## S5 — LOW (NEW): User-supplied URLs are proxied through third parties.

`index.html:24199, 24340, 28100, 28240` route watch URLs through `corsproxy.io` and
`api.allorigins.win` (both allowlisted in the CSP `connect-src`). Every product URL a
user scrapes is disclosed to an unaffiliated operator with no agreement and no SLA,
and the returned HTML is parsed and rendered. No credentials transit these proxies,
so impact is limited to URL disclosure plus a availability/tamper dependency on a
free public service.

**Fix:** move the fetch into an existing edge function (`extract-url-meta` already
does this shape of work) so it stays on infrastructure you control.

---

## What was checked and found sound

Worth recording so future audits don't re-litigate these:

- **No secrets in the repo or in git history.** `*.p8` and `dev-config.js` are
  gitignored and were never committed (`git log --all --diff-filter=A` is clean). The
  key in `index.html:6061` is the anon key, public by design.
- **Webhook authentication is genuinely good.** `ses-webhook` verifies the SNS
  signature including a `SigningCertURL` allowlist; `resend-webhook` verifies the Svix
  signature over raw bytes before parsing; `report-notify` and `send-push` re-read the
  record from the DB rather than trusting the webhook payload.
- **All SECURITY DEFINER functions pin `search_path`** — zero exceptions across the
  whole schema.
- **RLS is enabled on every table in `public`** — no table is unprotected.
- **All 21 demo-account read-only guards are RESTRICTIVE**, so they correctly
  intersect rather than OR.
- **CDN scripts carry SRI hashes** and a CSP is present with `object-src 'none'`
  and `base-uri 'self'`.
- **`logs` (posts) privacy is correctly enforced** — no loose sibling policy, unlike
  `watches`/`wishlist`.

## Priority

1. **S1** — 128 users, anonymous access, zero effort to exploit. Fix first.
2. **S2** — 12 users' financial data, needs only a free account.
3. **S3** — ship with S1/S2; no live data triggers it yet.
4. **S4, S5** — housekeeping.

S1 and S2 are both pure-SQL fixes deployable via `supabase db query --linked`, but
both change read visibility app-wide — verify the feed, search, profile and club
surfaces against both test accounts before pushing.
