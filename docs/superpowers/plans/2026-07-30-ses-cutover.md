# AWS SES Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all WRotate email from Resend to AWS SES behind a runtime provider switch, with a rollback that takes seconds and no deploy.

**Architecture:** A new `_shared/mailer.ts` resolves an `EMAIL_PROVIDER` secret to either the existing `ses.ts` or `resend.ts` (already interface-compatible — identical message shape and result contract). All seven sending edge functions import from `mailer.ts` instead of a provider directly. The cutover is then a secret flip, gated behind staged UAT. Drain-path safety fixes and bounce/complaint monitoring ship alongside, because SES suspends accounts above 5% bounce / 0.1% complaint.

**Tech Stack:** Deno edge functions (Supabase), AWS SES v2 + SNS, `aws4fetch` (SigV4), Postgres RPCs, vanilla JS admin UI, Python 3 (LaunchAgent report), Deno tests + vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-07-30-ses-cutover-design.md`

## Global Constraints

- AWS account `392424878015`, region **`us-west-2`**. The July plan doc's `us-east-1` is stale — ignore it.
- SES production access is **live**: 50,000/day, 14/sec, `EnforcementStatus: HEALTHY`, case `178450792800650`.
- Deploy every edge function with `npx supabase functions deploy <name> --no-verify-jwt`.
- Run `npm run test:smoke` after every function deploy. Run `npm test && npm run test:functions` before every commit.
- `EMAIL_PROVIDER` **must default to `resend`** on unset/unknown values. Never default to the provider being cut over to.
- Do NOT delete `resend-webhook`, `_shared/resend.ts`, or unset `RESEND_API_KEY` in this plan — Resend is the 30-day rollback path.
- `email_events` schema must not change. Existing `event_type` values (`sent`, `delivered`, `opened`, `clicked`, `unsubscribed`) keep their meaning; `bounced`/`complained` are additive.
- Every SES send must carry `ConfigurationSetName` — `sent` rows drive the drain quota AND `_NofM` batch dedup, not just reporting.
- **Task 6 touches `index.html` → bump `sw.js` cache version** (`wristlog-v977` → `wristlog-v978`). The spec's "no client-side changes" claim was wrong; the admin tile lives in `index.html`.
- `index.html` is edited directly by the user and the pre-commit hook does an unconditional `git add index.html`. Before committing, run `git diff HEAD -- index.html` and confirm every hunk is yours.
- FROM addresses stay exactly as today: `WRotate <notifications@wrotate.com>`, `WRotate <hello@wrotate.com>`, `WRotate Reports <reports@wrotate.com>`.
- Commit style: `ses: <what>`.
- **The pg_cron job `drain-broadcast-queue` (jobid 5) is PAUSED**, holding 88 recipients as the Task 8 live test. It MUST be re-enabled in Task 8 — or immediately if this plan is abandoned.

---

## Task 1: `_shared/mailer.ts` — the provider switch

**Files:**
- Create: `supabase/functions/_shared/mailer-lib.ts` (pure — no Deno/IO/network)
- Create: `supabase/functions/_shared/mailer-lib.test.ts`
- Create: `supabase/functions/_shared/mailer.ts` (IO — reads env, dispatches)

**Interfaces:**
- Produces (consumed by Tasks 2, 3, 4):
  - `type Provider = "ses" | "resend"`
  - `resolveProvider(raw: string | undefined | null): Provider` (from `mailer-lib.ts`)
  - `interface MailMessage { from: string; to: string[]; subject: string; html: string; headers?: Record<string, string> }`
  - `type MailResult = { ok: true; id: string } | { ok: false; status: number; error: string; retryable: boolean }`
  - `sendEmail(msg: MailMessage): Promise<MailResult>` (from `mailer.ts`)
  - `sendBatch(msgs: MailMessage[]): Promise<{ results: MailResult[]; sent: number; failed: number }>` (from `mailer.ts`)
  - `currentProvider: Provider` (from `mailer.ts`)

`SesMessage` and `ResendMessage` are structurally identical (`from`, `to[]`, `subject`, `html`, `headers?`), so `MailMessage` is assignable to both with no adapter.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/mailer-lib.test.ts`:

```ts
// Tests for provider resolution (pure — no Deno env, IO, or network).
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { resolveProvider } from "./mailer-lib.ts";

Deno.test("resolveProvider returns ses only for an explicit ses value", () => {
  assertEquals(resolveProvider("ses"), "ses");
  assertEquals(resolveProvider("SES"), "ses");
  assertEquals(resolveProvider("  ses  "), "ses");
});

Deno.test("resolveProvider returns resend for an explicit resend value", () => {
  assertEquals(resolveProvider("resend"), "resend");
  assertEquals(resolveProvider("RESEND"), "resend");
});

// The whole point of the default: a typo, a cleared secret, or a fresh
// environment must never silently route live mail to the provider being
// cut over to. Unknown input falls back to the known-good one.
Deno.test("resolveProvider falls back to resend for unset or unknown values", () => {
  assertEquals(resolveProvider(undefined), "resend");
  assertEquals(resolveProvider(null), "resend");
  assertEquals(resolveProvider(""), "resend");
  assertEquals(resolveProvider("   "), "resend");
  assertEquals(resolveProvider("sess"), "resend");
  assertEquals(resolveProvider("aws"), "resend");
  assertEquals(resolveProvider("amazon-ses"), "resend");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-read supabase/functions/_shared/mailer-lib.test.ts`
Expected: FAIL — `Module not found ... mailer-lib.ts`

- [ ] **Step 3: Write `mailer-lib.ts`**

Create `supabase/functions/_shared/mailer-lib.ts`:

```ts
// _shared/mailer-lib — pure logic for the email provider switch.
// mailer.ts imports these; mailer-lib.test.ts tests them.

export type Provider = "ses" | "resend";

// The message shape both transports accept. SesMessage and ResendMessage are
// structurally identical, so this is assignable to either with no adapter.
export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  headers?: Record<string, string>;
}

export type MailResult =
  | { ok: true; id: string }
  // `retryable` distinguishes "the provider was busy / the network blipped"
  // from "this message will never be accepted". The broadcast queue only ever
  // re-selects `pending`, so a row marked `failed` is dropped forever.
  | { ok: false; status: number; error: string; retryable: boolean };

// Resolve the EMAIL_PROVIDER secret. Anything that is not exactly "ses"
// (case- and whitespace-insensitive) resolves to Resend. This asymmetry is
// deliberate: a cleared or misspelled secret must fail back to the provider
// that is known to work, never forward to the one under test.
export function resolveProvider(raw: string | undefined | null): Provider {
  return (raw ?? "").trim().toLowerCase() === "ses" ? "ses" : "resend";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-read supabase/functions/_shared/mailer-lib.test.ts`
Expected: 3 passed

- [ ] **Step 5: Write `mailer.ts`**

Create `supabase/functions/_shared/mailer.ts`:

```ts
// _shared/mailer — the single email transport entry point.
//
// Every sending edge function imports sendEmail/sendBatch from here. Which
// provider they reach is decided at runtime by the EMAIL_PROVIDER secret, so
// switching providers (or rolling back) is a secret flip, not a redeploy:
//
//   npx supabase secrets set EMAIL_PROVIDER=ses      # cut over
//   npx supabase secrets set EMAIL_PROVIDER=resend   # roll back
//
// Unset or unrecognised => resend (see resolveProvider).

import { resolveProvider } from "./mailer-lib.ts";
import { sendResendBatch, sendResendEmail } from "./resend.ts";
import { sendSesBatch, sendSesEmail } from "./ses.ts";

export type { MailMessage, MailResult, Provider } from "./mailer-lib.ts";

// Resolved once per isolate. Exported so handlers can report which provider is
// actually live — otherwise the only way to know is grepping a deployed bundle.
export const currentProvider = resolveProvider(Deno.env.get("EMAIL_PROVIDER"));

const useSes = currentProvider === "ses";

export const sendEmail = useSes ? sendSesEmail : sendResendEmail;
export const sendBatch = useSes ? sendSesBatch : sendResendBatch;
```

- [ ] **Step 6: Run the full function suite (regression)**

Run: `npm run test:functions`
Expected: all existing Deno tests pass, plus the 3 new ones

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/mailer-lib.ts supabase/functions/_shared/mailer-lib.test.ts supabase/functions/_shared/mailer.ts
git commit -m "ses: runtime email provider switch (_shared/mailer.ts)"
```

---

## Task 2: Route all seven senders through `mailer.ts`

This task ships **no behaviour change**. `EMAIL_PROVIDER` stays unset, so every sender resolves to Resend — including the three admin senders that currently import `ses.ts` directly. That temporary move is intended (see spec §2); `RESEND_API_KEY` must still be valid.

Isolating the refactor from the provider change means a failure after Task 8's flip has exactly one possible cause.

**Files:**
- Modify: `supabase/functions/new-user-alert/index.ts` (line 13 import, line 73 call)
- Modify: `supabase/functions/report-notify/index.ts` (line 13 import, line 62 call)
- Modify: `supabase/functions/send-report/index.ts` (line 3 import, line 46 call)
- Modify: `supabase/functions/send-email/index.ts` (lines 12–16 imports, line 162 call)
- Modify: `supabase/functions/send-wear-reminders/index.ts` (lines 9–13 imports, line 69 call)
- Modify: `supabase/functions/run-campaign/index.ts` (lines 42–43 imports, lines 304 + 326)
- Modify: `supabase/functions/send-broadcast/index.ts` (lines 55–56 imports, lines 403, 419, 532, 547, 589–590)

**Interfaces:**
- Consumes: `sendEmail`, `sendBatch`, `MailMessage` from `../_shared/mailer.ts` (Task 1)

- [ ] **Step 1: Swap the three admin senders**

In each of `new-user-alert/index.ts`, `report-notify/index.ts`, `send-report/index.ts`:

Replace `import { sendSesEmail } from "../_shared/ses.ts";` with:

```ts
import { sendEmail } from "../_shared/mailer.ts";
```

and replace the single call site `await sendSesEmail({` with `await sendEmail({`. Leave every surrounding line — the arguments, the error handling, the log lines — untouched.

- [ ] **Step 2: Swap `send-email` and `send-wear-reminders`**

In both files replace `import { sendResendEmail } from "../_shared/resend.ts";` with:

```ts
import { sendEmail } from "../_shared/mailer.ts";
```

and the call site `await sendResendEmail({` with `await sendEmail({`.

Both files carry a stale two-line transport comment above the import (`// Transport: Resend is primary. ../_shared/ses.ts is interface-compatible and` …). Replace those two lines in each file with:

```ts
// Transport: ../_shared/mailer.ts — provider chosen at runtime by the
// EMAIL_PROVIDER secret (defaults to Resend).
```

- [ ] **Step 3: Swap `run-campaign`**

Replace lines 42–43:

```ts
import { sendBatch } from "../_shared/mailer.ts";
import type { MailMessage } from "../_shared/mailer.ts";
```

Line 304: `const messages: ResendMessage[] = await Promise.all(` becomes `const messages: MailMessage[] = await Promise.all(`.

Line 326: `const { results } = await sendResendBatch(messages);` becomes `const { results } = await sendBatch(messages);`.

- [ ] **Step 4: Swap `send-broadcast`**

`send-broadcast/index.ts` already declares a **local** `async function sendEmail(to, subject, html)` at line 589. Importing `sendEmail` unaliased would shadow-collide, so alias the import.

Replace lines 55–56:

```ts
import { currentProvider, sendBatch, sendEmail as sendProviderEmail } from "../_shared/mailer.ts";
import type { MailMessage } from "../_shared/mailer.ts";
```

Lines 403 and 532: `const messages: ResendMessage[] = await Promise.all(` becomes `const messages: MailMessage[] = await Promise.all(`.

Lines 419 and 547: `const { results } = await sendResendBatch(messages);` becomes `const { results } = await sendBatch(messages);`.

Lines 589–594, the local helper — swap the transport and make the error message provider-neutral:

```ts
async function sendEmail(to: string, subject: string, html: string) {
  const result = await sendProviderEmail({ from: FROM_EMAIL, to: [to], subject, html });
  if (!result.ok) {
    throw new Error(`Email send error (${currentProvider}): ${result.error}`);
  }
  return { id: result.id };
}
```

- [ ] **Step 5: Verify no sender imports a provider module directly**

Run:

```bash
grep -rn '_shared/\(ses\|resend\)\.ts' supabase/functions --include=index.ts
```

Expected: **no output**. Only `_shared/mailer.ts` may import the provider modules. If any line prints, that sender was missed — fix it before continuing.

- [ ] **Step 6: Run the tests**

Run: `npm run test:functions && npm test`
Expected: all pass. No test asserts on provider identity yet, so nothing should need changing — if a test fails, the refactor changed behaviour and is wrong.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/new-user-alert supabase/functions/report-notify supabase/functions/send-report supabase/functions/send-email supabase/functions/send-wear-reminders supabase/functions/run-campaign supabase/functions/send-broadcast
git commit -m "ses: route all seven senders through _shared/mailer.ts"
```

---

## Task 3: Drain safety — credential failures and the circuit breaker

On 2026-07-25 a drain ran against a misconfigured provider, classified the rejections as permanent, and marked 22 recipients `failed`. The drain only ever re-selects `pending`, so they were dropped for good.

`isRetryableStatus` treats 401/403 as permanent, which is right *within* a send (hammering a bad key is pointless) but wrong for the *queue* — bad credentials are an operator problem, not a bad recipient. Two fixes.

**Files:**
- Modify: `supabase/functions/send-broadcast/lib.ts` (add two pure helpers near `drainBudget`, ~line 210)
- Modify: `supabase/functions/send-broadcast/lib.test.ts` (add tests)
- Modify: `supabase/functions/send-broadcast/index.ts` (drain loop, lines 547–581)

**Interfaces:**
- Produces (from `send-broadcast/lib.ts`):
  - `isCredentialFailure(status: number): boolean`
  - `shouldTripBreaker(okCount: number, batchSize: number): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/send-broadcast/lib.test.ts` (keep the file's existing import style; add the two names to the existing `./lib.ts` import):

```ts
Deno.test("isCredentialFailure flags auth rejections only", () => {
  assertEquals(isCredentialFailure(401), true);
  assertEquals(isCredentialFailure(403), true);
  // Not credentials: a rejected recipient, a throttle, a provider outage.
  assertEquals(isCredentialFailure(400), false);
  assertEquals(isCredentialFailure(422), false);
  assertEquals(isCredentialFailure(429), false);
  assertEquals(isCredentialFailure(500), false);
  assertEquals(isCredentialFailure(0), false);
});

Deno.test("shouldTripBreaker fires only on a wholly failed non-empty batch", () => {
  assertEquals(shouldTripBreaker(0, 100), true);
  assertEquals(shouldTripBreaker(0, 1), true);
  // One success proves the transport works — recipient-level failures are real.
  assertEquals(shouldTripBreaker(1, 100), false);
  assertEquals(shouldTripBreaker(100, 100), false);
  // An empty batch is not evidence of anything.
  assertEquals(shouldTripBreaker(0, 0), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-read supabase/functions/send-broadcast/`
Expected: FAIL — `isCredentialFailure` / `shouldTripBreaker` are not exported

- [ ] **Step 3: Add the helpers to `lib.ts`**

Insert immediately after `drainBudget` in `supabase/functions/send-broadcast/lib.ts`:

```ts
// 401/403 mean our credentials are wrong, not that the recipient is bad. The
// send layer correctly calls these permanent (retrying a bad key is pointless),
// but the QUEUE must not: marking these rows `failed` drops real recipients for
// an operator mistake. Defer them instead — they retry once the key is fixed.
// This is exactly the shape of the 2026-07-25 incident.
export function isCredentialFailure(status: number): boolean {
  return status === 401 || status === 403;
}

// A batch where every single send failed is a configuration problem, not a
// hundred simultaneously-bad addresses. Stop the drain rather than walk the
// whole queue converting it to failures.
export function shouldTripBreaker(okCount: number, batchSize: number): boolean {
  return batchSize > 0 && okCount === 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-read supabase/functions/send-broadcast/`
Expected: all pass

- [ ] **Step 5: Wire the helpers into the drain loop**

In `supabase/functions/send-broadcast/index.ts`, add `isCredentialFailure` and `shouldTripBreaker` to the existing `./lib.ts` import list.

Change the classification branch (currently `else if (r.retryable) {`) to also defer credential failures:

```ts
      if (r.ok) okIds.push(batch[idx].id);
      else if (r.retryable || isCredentialFailure(r.status)) {
        deferredRows.push({ id: batch[idx].id, error: r.error });
        errors.push(`[retryable] ${r.error}`);
      } else {
```

Then, immediately after the `for (const dr of deferredRows) { ... }` loop and still inside the batch `for` loop, add the breaker:

```ts
    // Circuit breaker. Every send in this batch failed, so the transport itself
    // is broken (bad key, wrong region, provider down) — the remaining rows
    // would fail identically. Release the rest of the claim back to `pending`
    // and stop: rows left in `sending` would strand until the reaper.
    if (shouldTripBreaker(okIds.length, batch.length)) {
      const remaining = claimed.slice(i + batchSize).map((r) => r.id);
      if (remaining.length) {
        await supabase.from("broadcast_queue")
          .update({ status: "pending", claimed_at: null }).in("id", remaining);
      }
      console.error(
        `[send-broadcast] Drain: batch of ${batch.length} failed 100% — aborting, ${remaining.length} rows released to pending`,
      );
      break;
    }
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:functions && npm test`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/send-broadcast/lib.ts supabase/functions/send-broadcast/lib.test.ts supabase/functions/send-broadcast/index.ts
git commit -m "ses: defer credential failures and abort a 100%-failed drain batch"
```

---

## Task 4: Raise the drain cap and report the live provider

**Files:**
- Modify: `supabase/functions/send-broadcast/lib.ts` (lines 205–212)
- Modify: `supabase/functions/send-broadcast/index.ts` (line 482)

**Interfaces:**
- Consumes: `currentProvider` from `../_shared/mailer.ts` (imported in Task 2 Step 4)

- [ ] **Step 1: Update the constant and its comment**

In `supabase/functions/send-broadcast/lib.ts`, replace the comment block and constant (currently `We are on Resend. Its quota is 100/day…` / `export const DAILY_EMAIL_LIMIT = 100;`) with:

```ts
// Daily quota resets at midnight UTC. The nightly drain sends broadcast rows with
// whatever quota is left, keeping a reserve for late-night transactional email.
//
// This is no longer a provider quota — SES allows 50,000/day. It is blast-radius
// protection: the ceiling a runaway loop cannot exceed before the nightly cap
// stops it. 500 lets any realistic single broadcast (~400 recipients) finish in
// one night, which was the whole point of leaving Resend's 100/day cap, while
// capping a bug at ~1% of the SES quota.
export const DAILY_EMAIL_LIMIT = 500;
export const DRAIN_RESERVE = 10;
```

Note: `ses.ts` exports an unused `getSesQuota()` that reads the real 50,000. Do NOT wire it up as `dailyLimit` — that would defeat the blast-radius purpose of this constant.

- [ ] **Step 2: Report the live provider in the quota introspection response**

In `supabase/functions/send-broadcast/index.ts` line 482, replace the hardcoded value:

```ts
      provider: currentProvider,
```

This is what makes "which provider is live" checkable without grepping a deployed bundle. It is the verification step for Task 8.

- [ ] **Step 3: Check whether any test pins the old limit**

Run:

```bash
grep -rn "DAILY_EMAIL_LIMIT\|drainBudget\|provider" supabase/functions/send-broadcast/lib.test.ts
```

If a test asserts a budget computed from 100 (for example `assertEquals(drainBudget(0), 90)`), update the expected value to the 500-based figure (`drainBudget(0)` is now `490`). If tests pass an explicit `dailyLimit` argument, leave them alone — they are independent of the constant.

- [ ] **Step 4: Run the tests**

Run: `npm run test:functions && npm test`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-broadcast/lib.ts supabase/functions/send-broadcast/index.ts
git commit -m "ses: raise drain cap to 500/day as blast-radius protection; report live provider"
```

---

## Task 5: AWS configuration fixes

Two gaps found during gate A verification. Both are AWS/DNS changes, no repo code. Requires a valid AWS session (`aws login --remote` if expired — see spec).

**Files:** none (AWS CLI + Cloudflare DNS)

**Interfaces:**
- Produces: `wrotate.com` identity defaulting to the `wrotate-events` config set; `click.wrotate.com` as the SES custom tracking domain

- [ ] **Step 1: Set the identity's default configuration set**

The `wrotate.com` identity currently defaults to `my-first-configuration-set`, which has no event destination. Sends are fine today because `ses.ts` passes `ConfigurationSetName` explicitly — but any send path that ever omits it would produce zero events, silently breaking the drain quota and `_NofM` dedup with no error anywhere.

```bash
aws sesv2 put-email-identity-configuration-set-attributes \
  --email-identity wrotate.com \
  --configuration-set-name wrotate-events \
  --region us-west-2
```

Verify:

```bash
aws sesv2 get-email-identity --email-identity wrotate.com --region us-west-2 \
  | grep ConfigurationSetName
```

Expected: `"ConfigurationSetName": "wrotate-events"`

- [ ] **Step 2: Add the Cloudflare CNAME for the tracking domain**

In Cloudflare DNS for `wrotate.com`, create:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `click` | `r.us-west-2.awstrack.me` | **DNS only** (grey cloud) |

Proxying must be off — SES needs to serve the redirect itself.

- [ ] **Step 3: Point the configuration set at the custom domain**

```bash
aws sesv2 put-configuration-set-tracking-options \
  --configuration-set-name wrotate-events \
  --custom-redirect-domain click.wrotate.com \
  --region us-west-2
```

Verify:

```bash
aws sesv2 get-configuration-set --configuration-set-name wrotate-events --region us-west-2
```

Expected: a `TrackingOptions` block with `"CustomRedirectDomain": "click.wrotate.com"`. Without this, click links rewrite through `awstrack.me`.

- [ ] **Step 4: Record completion**

Tick Steps 1–3 in this file and note the date. There is nothing to commit for this task — but Task 9 documents the outcome.

---

## Task 6: Bounce/complaint health — RPC and admin tile

SES suspends above **5% bounce** or **0.1% complaint**. `admin_email_engagement()` already counts `bounced` — but it merges bounces and complaints into one number, and the two thresholds differ by 50×. They must be separated.

**Files:**
- Create: `sql/2026-07-30-email-health.sql`
- Modify: `index.html` (`renderEmailEngagement`, ~line 15803)
- Modify: `sw.js` (line 4, cache version)

**Interfaces:**
- Produces: `admin_email_engagement()` gains a top-level `health` key:
  `{ sent_24h, bounced_24h, complained_24h, sent_7d, bounced_7d, complained_7d }` (all integers)

- [ ] **Step 1: Build the new RPC file from the current definition**

The live definition is `sql/2026-07-29-broadcast-by-label.sql` (160 lines) — **not** the older `2026-07-19` or `2026-07-27` files. Copy it as the base:

```bash
cp sql/2026-07-29-broadcast-by-label.sql sql/2026-07-30-email-health.sql
```

Replace the header comment (the first 29 lines, everything above `CREATE OR REPLACE FUNCTION`) with:

```sql
-- Adds a `health` key to admin_email_engagement: bounce and complaint counts
-- over 24h and 7d, separated.
--
-- They were merged into a single `bounced` figure, but AWS SES suspends an
-- account above 5% bounce OR 0.1% complaint — thresholds 50x apart, so one
-- combined number cannot be checked against either. Rates are computed by the
-- callers (admin tile, daily cost report) from these raw counts.
--
-- Counts come from `ext`, which excludes internal recipients. AWS measures all
-- sends including internal, but internal traffic is a handful of addresses that
-- do not bounce, so the difference is immaterial and the CTE is already there.
--
-- Everything else in this function is unchanged from 2026-07-29-broadcast-by-label.sql.
```

- [ ] **Step 2: Add the `health` key**

In `sql/2026-07-30-email-health.sql`, find the `'recent'` entry at the end of the `json_build_object(...)`. Add a comma after its closing `)` and insert the new key before the closing `  ) INTO result;`:

```sql
    ),
    -- Account-health counters. SES suspends above 5% bounce or 0.1% complaint,
    -- so these two must stay separate — a merged figure cannot be tested
    -- against either threshold.
    'health', (
      SELECT json_build_object(
        'sent_24h',       count(*) FILTER (WHERE event_type = 'sent'       AND created_at >= now() - interval '24 hours'),
        'bounced_24h',    count(*) FILTER (WHERE event_type = 'bounced'    AND created_at >= now() - interval '24 hours'),
        'complained_24h', count(*) FILTER (WHERE event_type = 'complained' AND created_at >= now() - interval '24 hours'),
        'sent_7d',        count(*) FILTER (WHERE event_type = 'sent'),
        'bounced_7d',     count(*) FILTER (WHERE event_type = 'bounced'),
        'complained_7d',  count(*) FILTER (WHERE event_type = 'complained')
      )
      FROM ext
      WHERE created_at >= now() - interval '7 days'
    )
```

- [ ] **Step 3: Deploy the RPC**

Migration push does not work here (remote-only migrations), so apply directly:

```bash
npx supabase db query --linked --file sql/2026-07-30-email-health.sql
```

The file already ends with `NOTIFY pgrst, 'reload schema';` — required for PostgREST to see the changed return shape.

- [ ] **Step 4: Verify the RPC returns the new key**

```bash
npx supabase db query --linked "SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id::text FROM profiles WHERE is_admin = true LIMIT 1))::text, true); SELECT admin_email_engagement()->'health';"
```

Expected: a JSON object with all six integer keys. `bounced_*` and `complained_*` will be `0` until SES traffic starts — that is correct, not a failure.

- [ ] **Step 5: Render the health tile**

In `index.html`, inside `renderEmailEngagement(data)`, after the line `const broadcasts = (data.broadcasts || []).filter(b => b && b.label);`, add:

```js
  // SES account health. Suspension thresholds are 5% bounce / 0.1% complaint,
  // so these are shown as separate rates, not folded into one "problems" count.
  const health = data.health || {};
  const rate = (n, d) => (+d > 0 ? (100 * (+n || 0)) / +d : 0);
  const bounce7 = rate(health.bounced_7d, health.sent_7d);
  const complaint7 = rate(health.complained_7d, health.sent_7d);
  const healthState = (complaint7 >= 0.1 || bounce7 >= 5) ? 'bad'
    : (complaint7 >= 0.05 || bounce7 >= 2.5) ? 'warn' : 'ok';
  const healthHtml = +health.sent_7d > 0 ? `
    <div class="email-health email-health--${healthState}">
      <strong>Deliverability (7d)</strong>
      <span>Bounce ${bounce7.toFixed(2)}% <em>/ 5% limit</em></span>
      <span>Complaint ${complaint7.toFixed(3)}% <em>/ 0.1% limit</em></span>
      <span>${+health.sent_7d} sent</span>
    </div>` : '';
```

Then include `healthHtml` in the returned markup — insert it immediately before the existing totals/overall block so it reads first.

Add matching CSS alongside the other admin styles in `index.html`:

```css
.email-health { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline;
  padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; font-size: 13px; }
.email-health em { opacity: .6; font-style: normal; }
.email-health--ok   { background: rgba(46,160,67,.12);  color: #2ea043; }
.email-health--warn { background: rgba(210,153,34,.14); color: #d29922; }
.email-health--bad  { background: rgba(248,81,73,.14);  color: #f85149; }
```

- [ ] **Step 6: Bump the service worker cache**

In `sw.js` line 4: `const CACHE = 'wristlog-v977';` becomes `const CACHE = 'wristlog-v978';`

- [ ] **Step 7: Run the tests**

Run: `npm test && npm run test:e2e`
Expected: all pass. If an admin E2E mock asserts on the engagement payload shape, add `health` to the mock fixture — `data.health || {}` already tolerates its absence, so an untouched mock must not fail.

- [ ] **Step 8: Commit**

Check the hook's unconditional `git add index.html` did not sweep in unrelated user edits:

```bash
git diff HEAD -- index.html
```

Confirm every hunk is yours, then:

```bash
git add sql/2026-07-30-email-health.sql index.html sw.js
git commit -m "ses: split bounce/complaint counts and surface a deliverability tile"
```

---

## Task 7: Bounce/complaint in the daily cost report

The 9:15am `com.wrotate.cost-report` email is where the user already looks daily. Adding deliverability there means an account-health problem surfaces without anyone opening the admin UI.

**Files:**
- Modify: `scripts/cost-report.py`
- Create: `~/.config/wrotate/supabase.env` (secret, never committed)

**Interfaces:**
- Consumes: `email_events` via the Supabase REST API (the script runs from `~/.local/bin` and cannot reach the repo — TCC blocks `~/Documents` — so `npx supabase` is not available to it)
- Produces: an `email_health()` section in the daily report HTML

- [ ] **Step 1: Create the credentials file**

The script needs its own Supabase access. Ask the user for the service-role key from the Supabase dashboard (Settings → API), then:

```bash
mkdir -p ~/.config/wrotate
cat > ~/.config/wrotate/supabase.env <<'EOF'
SUPABASE_URL=https://xnzweevzrojmouzhpwzv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<paste the service role key>
EOF
chmod 600 ~/.config/wrotate/supabase.env
```

Never commit this file or echo the key into a transcript.

- [ ] **Step 2: Add the health fetcher to `scripts/cost-report.py`**

Insert after the existing `admin_key()` function:

```python
def supabase_creds():
    """Read Supabase URL + service key from ~/.config/wrotate/supabase.env.

    The LaunchAgent runs the ~/.local/bin copy of this script and cannot read
    the repo (TCC blocks ~/Documents), so `npx supabase` is unavailable here.
    Returns (None, None) when unconfigured so the report still sends.
    """
    path = os.path.expanduser("~/.config/wrotate/supabase.env")
    if not os.path.exists(path):
        return None, None
    vals = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip()
    return vals.get("SUPABASE_URL"), vals.get("SUPABASE_SERVICE_ROLE_KEY")


def _event_count(url, key, event_type, since_iso):
    """Exact row count for one event_type since a timestamp, via PostgREST."""
    endpoint = (
        f"{url}/rest/v1/email_events"
        f"?select=id&event_type=eq.{event_type}&created_at=gte.{since_iso}"
    )
    out = subprocess.run(
        ["curl", "-s", "-I", endpoint,
         "-H", f"apikey: {key}",
         "-H", f"Authorization: Bearer {key}",
         "-H", "Range: 0-0",
         "-H", "Prefer: count=exact"],
        capture_output=True, text=True, timeout=30,
    ).stdout
    # Content-Range looks like "0-0/1234"; the total follows the slash.
    for line in out.splitlines():
        if line.lower().startswith("content-range:") and "/" in line:
            total = line.split("/")[-1].strip()
            if total.isdigit():
                return int(total)
    return 0


def email_health():
    """Bounce/complaint rates vs the SES suspension thresholds.

    SES suspends an account above 5% bounce or 0.1% complaint, so the two are
    reported separately. Returns an HTML fragment, or '' when unconfigured.
    """
    url, key = supabase_creds()
    if not url or not key:
        return ""
    now = dt.datetime.now(dt.timezone.utc)
    since = (now - dt.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    sent = _event_count(url, key, "sent", since)
    if sent == 0:
        return ""
    bounced = _event_count(url, key, "bounced", since)
    complained = _event_count(url, key, "complained", since)
    b_rate = 100.0 * bounced / sent
    c_rate = 100.0 * complained / sent
    alarm = b_rate >= 5.0 or c_rate >= 0.1
    warn = b_rate >= 2.5 or c_rate >= 0.05
    colour = "#f85149" if alarm else ("#d29922" if warn else "#2ea043")
    flag = " &mdash; ACTION NEEDED" if alarm else (" &mdash; watch" if warn else "")
    return (
        f'<h3 style="margin-top:24px">Email deliverability (7d)<span style="color:{colour}">{flag}</span></h3>'
        f'<p style="color:{colour}">'
        f"Bounce <b>{b_rate:.2f}%</b> (limit 5%) &middot; "
        f"Complaint <b>{c_rate:.3f}%</b> (limit 0.1%) &middot; "
        f"{sent} sent, {bounced} bounced, {complained} complaints"
        f"</p>"
    )
```

Confirm `os`, `subprocess`, and `datetime as dt` are already imported at the top of the file; add any that are missing.

- [ ] **Step 3: Include it in the report body**

In `main()`, immediately before the `send_email(...)` call on line ~283, append the section to the HTML that gets sent:

```python
    html += email_health()
```

Use whatever the local HTML accumulator variable is actually named at that point in `main()` — read the surrounding lines rather than assuming `html`.

- [ ] **Step 4: Test it end to end**

```bash
python3 scripts/cost-report.py
```

Expected: the report email arrives with an "Email deliverability (7d)" section. Right now bounce and complaint are both 0 (SES traffic has not started), so it should render green with `0.00% / 0.000%`. If the section is missing entirely, `supabase_creds()` returned nothing — check the file path and permissions.

- [ ] **Step 5: Copy to the deployed location**

The LaunchAgent runs the `~/.local/bin` copy, not the repo file. Per CLAUDE.md this copy is mandatory after every edit:

```bash
cp scripts/cost-report.py ~/.local/bin/wrotate-cost-report.py
```

- [ ] **Step 6: Commit**

```bash
git add scripts/cost-report.py
git commit -m "ses: report bounce/complaint rates against SES thresholds in the daily email"
```

---

## Task 8: The cutover — gates C through F

Everything before this shipped with `EMAIL_PROVIDER` unset, so nothing has changed provider yet. This task performs the actual flip.

**Files:** none (deploys, secrets, UAT, one SQL statement)

**Interfaces:**
- Consumes: everything from Tasks 1–7

- [ ] **Step 1: Deploy every changed function, still on Resend (gate B)**

```bash
for f in new-user-alert report-notify send-report send-email send-wear-reminders run-campaign send-broadcast; do
  npx supabase functions deploy "$f" --no-verify-jwt || break
done
npm run test:smoke
```

Expected: all deploy, smoke test passes. Confirm the provider is still Resend:

```bash
curl -s -X POST "https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-broadcast" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -d '{"drain": true, "quota_only": true}'
```

Expected: `"provider": "resend"`, `"daily_limit": 500`. **If `provider` is anything else, stop** — the secret is already set and gate B's isolation is lost.

- [ ] **Step 2: Flip to SES (gate C)**

```bash
npx supabase secrets set EMAIL_PROVIDER=ses
```

Secret changes take effect on the next cold start; give it ~30s, then re-run the `quota_only` curl from Step 1.

Expected: `"provider": "ses"`.

**Rollback at any point from here:** `npx supabase secrets set EMAIL_PROVIDER=resend`.

- [ ] **Step 3: UAT the admin path (gate C)**

Invoke `send-report` as the internal test account to `ozgurdogan@gmail.com`, subject `SES cutover UAT — send-report`.

Confirm all three:
1. The email arrives.
2. Gmail → "Show original" shows **DKIM: PASS** for `wrotate.com`, and the SPF domain is `mail.wrotate.com`.
3. Within ~1 minute:

```bash
npx supabase db query --linked "SELECT event_type, email_to, subject, created_at FROM email_events WHERE subject LIKE 'SES cutover UAT%' ORDER BY created_at;"
```

Expected: `sent` and `delivered` rows. This is the definitive proof that SES → config set → SNS → `ses-webhook` → `email_events` works end to end. **Do not proceed without it** — every downstream metric and the drain quota depend on this chain.

- [ ] **Step 4: UAT the notification path (gate D)**

Using the test accounts only (never James Collins/watchdemo): as **testuser2**, comment on a **private** post owned by **testuser**. They are mutual close friends, so the notification fires; private visibility keeps it off the public feed.

Expected: testuser receives the comment notification email at test@wrotate.com, and matching `sent`/`delivered` rows appear in `email_events`.

- [ ] **Step 5: UAT the broadcast path (gate E)**

From the admin UI, send a `send-broadcast` with `test_email: "ozgurdogan@gmail.com"` and subject `SES cutover UAT — broadcast`. Confirm delivery and events.

Then run a `dry_run` broadcast and confirm the resolved recipient count matches what it was before the cutover — recipient resolution is provider-independent, so any change means something else broke.

- [ ] **Step 6: Release the held queue (gate F)**

This is the live test of the exact path that failed on 2026-07-25. The queue was deliberately held for it.

```bash
npx supabase db query --linked "SELECT cron.alter_job(5, active := true);"
npx supabase db query --linked "SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobid = 5;"
```

Expected: `active: true`.

Either wait for the 21:30 UTC run, or trigger the drain immediately with the same curl as Step 1 but `{"drain": true}` (no `quota_only`). Then:

```bash
npx supabase db query --linked "SELECT status, count(*) FROM broadcast_queue GROUP BY 1;"
```

Expected: `pending` drops to **0** (88 < the 490 budget, so one run clears it) and `sent` rises by 88. **`failed` must be 0.** Any `failed` rows mean the drain-safety work in Task 3 did not hold — roll back the provider, investigate, and re-queue those rows before continuing.

- [ ] **Step 7: Confirm event flow and account health**

```bash
npx supabase db query --linked "SELECT event_type, count(*) FROM email_events WHERE created_at > now() - interval '1 day' GROUP BY 1;"
aws sesv2 get-account --region us-west-2 | grep -A3 SendQuota
```

Expected: a healthy spread of `sent`/`delivered`/`opened`, `SentLast24Hours` reflecting the drain, and zero or near-zero `bounced`/`complained`. Investigate any complaint immediately — the threshold is 0.1%.

---

## Task 9: Documentation and the retirement follow-up

**Files:**
- Modify: `CLAUDE.md` (Edge Function Deployment section)
- Modify: `docs/superpowers/specs/2026-07-30-ses-cutover-design.md` (mark gates complete)

- [ ] **Step 1: Document the pipeline in CLAUDE.md**

Add to the "Edge Function Deployment" section:

```markdown
- **Email goes through AWS SES v2** (account 392424878015, region us-west-2, config set `wrotate-events`) via `supabase/functions/_shared/mailer.ts`, which resolves the **`EMAIL_PROVIDER`** secret (`ses` | `resend`, defaulting to `resend`) to `ses.ts` or `resend.ts`. **Rollback is a secret flip, not a deploy**: `npx supabase secrets set EMAIL_PROVIDER=resend`.
- **Never import `_shared/ses.ts` or `_shared/resend.ts` from a sender** — always `_shared/mailer.ts`, so one setting controls every sender. Check with `grep -rn '_shared/\(ses\|resend\)\.ts' supabase/functions --include=index.ts` (expect no output).
- **Check the live provider** with a `{"drain": true, "quota_only": true}` call to `send-broadcast` — it reports `provider`. Do not infer it from the repo.
- Every send must keep the config set: `email_events` `sent` rows drive the broadcast drain quota AND the `_NofM` batch dedup, via SES → SNS → `ses-webhook`.
- **Watch bounce/complaint rates** — SES suspends above 5% bounce or 0.1% complaint. Surfaced in the 9:15am cost report and the admin engagement tab.
- `DAILY_EMAIL_LIMIT` (500) is blast-radius protection, not a provider quota — SES allows 50,000/day.
```

- [ ] **Step 2: Mark the spec's gates complete**

In `docs/superpowers/specs/2026-07-30-ses-cutover-design.md`, annotate the gate table in §2 with the date each gate passed, and tick the two Task 5 items in the "Gate A results" section.

- [ ] **Step 3: Note the 30-day retirement, do NOT perform it**

Add to the spec under §6:

```markdown
**Cutover completed:** <date>. Resend retirement is due 30 days later, on or after <date + 30 days>, and only if bounce and complaint rates have stayed under threshold. Retirement is out of scope for the 2026-07-30 cutover plan and needs its own change.
```

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run test:functions && npm run test:e2e && npm run test:smoke`
Expected: all pass

- [ ] **Step 5: Commit and deploy**

```bash
git diff HEAD -- index.html   # confirm no stray user edits swept in by the hook
git add CLAUDE.md docs/superpowers/specs/2026-07-30-ses-cutover-design.md
git commit -m "ses: document the SES pipeline and provider switch"
git push origin main
```

---

## Self-Review Notes

- **Spec coverage:** §1 mailer → Task 1–2. §2 gates → Task 8 (gate A was completed during design). §3 403 trap + breaker → Task 3. §4 metrics: config-set/open-tracking verified at gate A; tracking domain → Task 5; bounce/complaint monitoring → Tasks 6 and 7. §5 drain cap → Task 4. §6 retirement → Task 9 Step 3 (deliberately deferred, not performed). §7 testing → the test steps throughout.
- **Corrections to the spec, made here:** the spec claimed no client-side changes; the admin tile in Task 6 edits `index.html`, so a `sw.js` bump is required and is in the Global Constraints. The spec also did not anticipate that `admin_email_engagement()` merges bounces with complaints — Task 6 Step 2 separates them, which the 50×-apart thresholds require.
- **Two collisions handled:** `send-broadcast` has a local `sendEmail`, so Task 2 Step 4 aliases the import as `sendProviderEmail`. The current RPC definition is the 07-29 file, not the older 07-19/07-27 ones — Task 6 Step 1 says so explicitly.
- **Type consistency:** `MailMessage` / `MailResult` / `sendEmail` / `sendBatch` / `currentProvider` are defined in Task 1 and used under those exact names in Tasks 2 and 4. `isCredentialFailure` / `shouldTripBreaker` are defined and used in Task 3.
- **Held queue:** the paused cron job is in the Global Constraints and released in Task 8 Step 6, with an instruction to release it even if the plan is abandoned.
- `getSesQuota()` in `ses.ts` stays unused, deliberately — Task 4 Step 1 explains why wiring it up would defeat the cap.
