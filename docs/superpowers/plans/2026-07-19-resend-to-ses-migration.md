# Resend → AWS SES Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Resend with AWS SES v2 as the email provider for all 7 sending edge functions plus the inbound event webhook, removing the 100-emails/day ceiling.

**Architecture:** A new shared Deno module (`_shared/ses-lib.ts` pure + `_shared/ses.ts` IO) signs SES v2 `SendEmail` calls with SigV4 via `aws4fetch`. Each sender swaps its `fetch("https://api.resend.com/...")` for `sendSesEmail()`/`sendSesBatch()`. A new `ses-webhook` function receives SES events via an SNS HTTPS subscription and writes the same `email_events` rows the Resend webhook writes today (schema unchanged), so the drain-quota counter, batch-`_NofM` dedup, and admin engagement metrics keep working. Resend stays live until every sender is flipped and verified, then is retired.

**Tech Stack:** Deno edge functions (Supabase), `aws4fetch` (SigV4, WebCrypto-based, edge-safe), `@peculiar/x509` (SNS cert parsing), SES v2 REST API, SNS HTTPS subscription, Deno tests (`npm run test:functions`).

## Global Constraints

- Every send MUST include `ConfigurationSetName` — the drain-quota logic and `_NofM` batch dedup read `email_events.event_type='sent'`, which only exists if the config set publishes Send events.
- Deploy every function with `npx supabase functions deploy <name> --no-verify-jwt`.
- Run `npm run test:smoke` after every deploy; run `npm test && npm run test:functions` before every commit.
- New secrets are prefixed `SES_` (never `SUPABASE_`): `SES_AWS_ACCESS_KEY_ID`, `SES_AWS_SECRET_ACCESS_KEY`, `SES_REGION`, `SES_CONFIG_SET`, `SES_SNS_TOPIC_ARN`, `SES_WEBHOOK_TOKEN`.
- Do NOT delete `resend-webhook` or unset `RESEND_API_KEY` until Task 7 — both providers run in parallel during migration.
- UAT sends go only to verified test addresses (test@wrotate.com, test2@wrotate.com, ozgurdogan@gmail.com) while the SES account is in sandbox.
- No client-side JS/HTML changes anywhere in this plan → no `sw.js` cache bump needed.
- `email_events` table schema (`email_id, event_type, email_to, subject, created_at, raw`) must NOT change; SES message IDs simply replace Resend IDs in `email_id`.
- Existing `event_type` values (`sent`, `delivered`, `opened`, `clicked`) must be produced identically by the new webhook; new types `bounced`, `complained` are additive.
- Keep `FROM` addresses exactly as today: `WRotate <notifications@wrotate.com>`, `WRotate <hello@wrotate.com>`, `WRotate Reports <reports@wrotate.com>`.
- Commit style: `ses: <what>` (matches repo convention `track:`, `stats:`, `admin campaigns:`).

---

## Task 1: AWS account groundwork (manual, do FIRST — production access is the long pole)

**Files:** none (AWS console + DNS + Supabase secrets). This task is a checklist executed with the user; nothing here blocks Tasks 2–3, and sandbox mode is enough to test Tasks 2–5 against verified addresses.

**Interfaces:**
- Produces: verified domain identity `wrotate.com`; configuration set `wrotate-events`; SNS topic `wrotate-email-events` (ARN recorded); IAM access key pair; Supabase secrets set; production-access request submitted.

- [ ] **Step 1: Create/sign in to AWS account, pick region `us-east-1`** (all later commands assume it; if another region is chosen, use it consistently in `SES_REGION` and the MAIL FROM MX record).

- [ ] **Step 2: Submit SES production access request immediately** (SES console → Account dashboard → Request production access). It takes ~24h; everything else proceeds in sandbox meanwhile. Use-case text:

> WRotate (wrotate.com) is a watch-collection web/iOS app. We send transactional notifications (comment/follow alerts, daily wear reminders) and opted-in onboarding/product-update emails to our registered users only (~1,000 emails/month, peak ~120/day). All recipients are account holders; marketing categories are opt-out via one-click List-Unsubscribe and an in-app preference center. Bounces and complaints will be consumed via SNS event notifications and suppressed from future sends.

- [ ] **Step 3: Verify the domain identity** — SES console → Identities → Create identity → Domain → `wrotate.com`, Easy DKIM (RSA_2048). Add the 3 DKIM CNAME records shown to wrotate.com DNS. Also configure custom MAIL FROM domain `mail.wrotate.com`: add MX record `10 feedback-smtp.us-east-1.amazonses.com` and TXT record `"v=spf1 include:amazonses.com ~all"` on `mail.wrotate.com`. Wait until the identity shows **Verified** (minutes to a few hours).

- [ ] **Step 4: While in sandbox, also verify the individual test recipients** (Identities → Create identity → Email address) for: `ozgurdogan@gmail.com`, `test@wrotate.com`, `test2@wrotate.com`. Sandbox can only send TO verified addresses.

- [ ] **Step 5: Create configuration set `wrotate-events`** — SES console → Configuration sets → Create. Then on the set: Event destinations → Add destination → check **Sends, Deliveries, Opens, Clicks, Bounces, Complaints** → destination type **Amazon SNS** → create new topic `wrotate-email-events`. Also enable **open and click tracking** on the config set (Tracking options, defaults are fine). Record the topic ARN (`arn:aws:sns:us-east-1:<account-id>:wrotate-email-events`).

- [ ] **Step 6: Create IAM sending user** — IAM → Users → Create user `wrotate-ses-sender`, no console access → Attach policies → Create inline policy (JSON):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "*"
    }
  ]
}
```

Then Security credentials → Create access key (type: Application running outside AWS). Record key ID + secret.

- [ ] **Step 7: Generate a webhook token and set all Supabase secrets** (run on the Mac Mini in the repo root):

```bash
TOKEN=$(openssl rand -hex 24) && echo "SES_WEBHOOK_TOKEN=$TOKEN"
npx supabase secrets set \
  SES_AWS_ACCESS_KEY_ID='<key id from step 6>' \
  SES_AWS_SECRET_ACCESS_KEY='<secret from step 6>' \
  SES_REGION='us-east-1' \
  SES_CONFIG_SET='wrotate-events' \
  SES_SNS_TOPIC_ARN='arn:aws:sns:us-east-1:<account-id>:wrotate-email-events' \
  SES_WEBHOOK_TOKEN="$TOKEN"
```

Expected: `Finished supabase secrets set.` Verify with `npx supabase secrets list` (names only — values are hashed).

- [ ] **Step 8: Record status** — note in this plan file which of: identity verified / production access granted / secrets set, are done. Task 3 Step 8 (SNS subscription) and Task 5 onward (sends to real users) require Steps 3–7; Task 6's full-cohort sends require production access.

---

## Task 2: Shared SES client (`_shared/ses-lib.ts` + `_shared/ses.ts`)

**Files:**
- Create: `supabase/functions/_shared/ses-lib.ts` (pure — no Deno/IO/network, testable)
- Create: `supabase/functions/_shared/ses-lib.test.ts`
- Create: `supabase/functions/_shared/ses.ts` (IO — aws4fetch, env)

**Interfaces:**
- Produces (consumed by every later task):
  - `interface SesMessage { from: string; to: string[]; subject: string; html: string; headers?: Record<string, string> }`
  - `type SesResult = { ok: true; id: string } | { ok: false; status: number; error: string }`
  - `sendSesEmail(msg: SesMessage): Promise<SesResult>` (from `ses.ts`)
  - `sendSesBatch(msgs: SesMessage[]): Promise<{ results: SesResult[]; sent: number; failed: number }>` (from `ses.ts`; `results[i]` corresponds to `msgs[i]`)
  - Pure helpers (from `ses-lib.ts`): `buildSesPayload(msg, configSet)`, `sesEndpoint(region)`, `chunk(arr, size)`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/ses-lib.test.ts`:

```ts
// Tests for the pure SES payload builders (no Deno/IO/network).
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { buildSesPayload, chunk, sesEndpoint } from "./ses-lib.ts";

Deno.test("sesEndpoint builds the v2 outbound-emails URL for the region", () => {
  assertEquals(
    sesEndpoint("us-east-1"),
    "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails",
  );
});

Deno.test("buildSesPayload maps from/to/subject/html and config set", () => {
  const p = buildSesPayload(
    { from: "WRotate <hello@wrotate.com>", to: ["a@b.com"], subject: "Hi", html: "<p>x</p>" },
    "wrotate-events",
  ) as Record<string, any>;
  assertEquals(p.FromEmailAddress, "WRotate <hello@wrotate.com>");
  assertEquals(p.Destination, { ToAddresses: ["a@b.com"] });
  assertEquals(p.Content.Simple.Subject, { Data: "Hi", Charset: "UTF-8" });
  assertEquals(p.Content.Simple.Body, { Html: { Data: "<p>x</p>", Charset: "UTF-8" } });
  assertEquals(p.ConfigurationSetName, "wrotate-events");
  assertEquals(p.Content.Simple.Headers, undefined); // no headers → field omitted
});

Deno.test("buildSesPayload converts headers map to SES Name/Value array", () => {
  const p = buildSesPayload(
    {
      from: "f@x.com", to: ["a@b.com"], subject: "s", html: "h",
      headers: {
        "List-Unsubscribe": "<https://u>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    },
    "wrotate-events",
  ) as Record<string, any>;
  assertEquals(p.Content.Simple.Headers, [
    { Name: "List-Unsubscribe", Value: "<https://u>" },
    { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
  ]);
});

Deno.test("chunk splits arrays and preserves order", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 2), []);
  assertEquals(chunk([1], 10), [[1]]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/_shared/`
Expected: FAIL — `Module not found ... ses-lib.ts`

- [ ] **Step 3: Write `ses-lib.ts`**

Create `supabase/functions/_shared/ses-lib.ts`:

```ts
// _shared/ses-lib — pure logic for the SES v2 client (no Deno/IO/network).
// ses.ts imports these; ses-lib.test.ts tests them.

export interface SesMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  headers?: Record<string, string>;
}

export function sesEndpoint(region: string): string {
  return `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
}

// Shape a SES v2 SendEmail request body. ConfigurationSetName is mandatory:
// the config set publishes Send events to SNS, which become the
// email_events 'sent' rows that the broadcast drain quota and _NofM batch
// dedup depend on. A send without it is invisible to those systems.
export function buildSesPayload(
  msg: SesMessage,
  configSet: string,
): Record<string, unknown> {
  const simple: Record<string, unknown> = {
    Subject: { Data: msg.subject, Charset: "UTF-8" },
    Body: { Html: { Data: msg.html, Charset: "UTF-8" } },
  };
  const entries = Object.entries(msg.headers ?? {});
  if (entries.length) {
    simple.Headers = entries.map(([Name, Value]) => ({ Name, Value }));
  }
  return {
    FromEmailAddress: msg.from,
    Destination: { ToAddresses: msg.to },
    Content: { Simple: simple },
    ConfigurationSetName: configSet,
  };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/_shared/`
Expected: 4 passed

- [ ] **Step 5: Write `ses.ts` (IO wrapper — no test, exercised by smoke/UAT)**

Create `supabase/functions/_shared/ses.ts`:

```ts
// _shared/ses — SES v2 send client for edge functions.
// SigV4 signing via aws4fetch (WebCrypto-based, edge-safe).
// Secrets: SES_AWS_ACCESS_KEY_ID, SES_AWS_SECRET_ACCESS_KEY, SES_REGION,
//          SES_CONFIG_SET (default "wrotate-events").

import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
import { buildSesPayload, chunk, sesEndpoint } from "./ses-lib.ts";
import type { SesMessage } from "./ses-lib.ts";
export type { SesMessage } from "./ses-lib.ts";

const REGION = Deno.env.get("SES_REGION") ?? "us-east-1";
const CONFIG_SET = Deno.env.get("SES_CONFIG_SET") ?? "wrotate-events";

let client: AwsClient | null = null;
function getClient(): AwsClient {
  if (!client) {
    client = new AwsClient({
      accessKeyId: Deno.env.get("SES_AWS_ACCESS_KEY_ID") ?? "",
      secretAccessKey: Deno.env.get("SES_AWS_SECRET_ACCESS_KEY") ?? "",
      region: REGION,
      service: "ses",
    });
  }
  return client;
}

export type SesResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string };

export async function sendSesEmail(msg: SesMessage): Promise<SesResult> {
  try {
    const res = await getClient().fetch(sesEndpoint(REGION), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSesPayload(msg, CONFIG_SET)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: JSON.stringify(data).slice(0, 500) };
    }
    return { ok: true, id: (data as { MessageId?: string }).MessageId ?? "" };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

// SES has no arbitrary-payload batch endpoint (bulk requires stored templates),
// so send individually: waves of 10 concurrent with a 1s pause between waves —
// ~10/sec, under the 14/sec default SES account rate limit.
// results[i] always corresponds to msgs[i].
export async function sendSesBatch(
  msgs: SesMessage[],
): Promise<{ results: SesResult[]; sent: number; failed: number }> {
  const results: SesResult[] = [];
  const waves = chunk(msgs, 10);
  for (let i = 0; i < waves.length; i++) {
    const wave = await Promise.all(waves[i].map(sendSesEmail));
    results.push(...wave);
    if (i < waves.length - 1) await new Promise((r) => setTimeout(r, 1000));
  }
  const sent = results.filter((r) => r.ok).length;
  return { results, sent, failed: results.length - sent };
}
```

- [ ] **Step 6: Run the full function test suite (regression)**

Run: `npm run test:functions`
Expected: all existing Deno tests + the 4 new ones pass

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "ses: shared SES v2 client (SigV4 via aws4fetch, batch pacing)"
```

---

## Task 3: `ses-webhook` edge function (SNS → email_events)

**Files:**
- Create: `supabase/functions/ses-webhook/lib.ts` (pure)
- Create: `supabase/functions/ses-webhook/lib.test.ts`
- Create: `supabase/functions/ses-webhook/index.ts` (handler + SNS signature verification)

**Interfaces:**
- Consumes: `email_events` table (existing schema: `email_id, event_type, email_to, subject, created_at, raw`).
- Produces (from `lib.ts`, used by `index.ts`):
  - `isValidSnsEnvelope(msg): boolean`
  - `isValidCertUrl(url: string): boolean` / `isValidSubscribeUrl(url: string): boolean`
  - `buildCanonicalString(msg): string`
  - `mapSesEventType(eventType: string): string`
  - `buildEmailEventRow(sesEvent, nowIso): { email_id, event_type, email_to, subject, created_at, raw }`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/ses-webhook/lib.test.ts`:

```ts
// Tests for ses-webhook pure logic (no Deno/IO/network).
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildCanonicalString,
  buildEmailEventRow,
  isValidCertUrl,
  isValidSnsEnvelope,
  isValidSubscribeUrl,
  mapSesEventType,
} from "./lib.ts";

Deno.test("mapSesEventType maps SES names to legacy email_events values", () => {
  assertEquals(mapSesEventType("Send"), "sent");
  assertEquals(mapSesEventType("Delivery"), "delivered");
  assertEquals(mapSesEventType("Open"), "opened");
  assertEquals(mapSesEventType("Click"), "clicked");
  assertEquals(mapSesEventType("Bounce"), "bounced");
  assertEquals(mapSesEventType("Complaint"), "complained");
  assertEquals(mapSesEventType("Rendering Failure"), "rendering failure"); // unknown → lowercased
});

Deno.test("buildEmailEventRow shapes a row from a SES event", () => {
  const ev = {
    eventType: "Delivery",
    mail: {
      messageId: "ses-msg-1",
      timestamp: "2026-07-19T10:00:00.000Z",
      destination: ["user@example.com"],
      commonHeaders: { subject: "Welcome to WRotate" },
    },
  };
  const row = buildEmailEventRow(ev, "2026-07-19T10:05:00.000Z");
  assertEquals(row, {
    email_id: "ses-msg-1",
    event_type: "delivered",
    email_to: "user@example.com",
    subject: "Welcome to WRotate",
    created_at: "2026-07-19T10:00:00.000Z",
    raw: ev,
  });
});

Deno.test("buildEmailEventRow falls back to nowIso and nulls", () => {
  const row = buildEmailEventRow({ eventType: "Send", mail: {} }, "2026-07-19T10:05:00.000Z");
  assertEquals(row.email_id, null);
  assertEquals(row.email_to, null);
  assertEquals(row.subject, null);
  assertEquals(row.created_at, "2026-07-19T10:05:00.000Z");
});

Deno.test("isValidCertUrl accepts only https sns.<region>.amazonaws.com .pem URLs", () => {
  assertEquals(isValidCertUrl("https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem"), true);
  assertEquals(isValidCertUrl("http://sns.us-east-1.amazonaws.com/x.pem"), false);
  assertEquals(isValidCertUrl("https://evil.com/sns.us-east-1.amazonaws.com/x.pem"), false);
  assertEquals(isValidCertUrl("https://sns.us-east-1.amazonaws.com.evil.com/x.pem"), false);
  assertEquals(isValidCertUrl("https://sns.us-east-1.amazonaws.com/x.txt"), false);
});

Deno.test("isValidSubscribeUrl accepts only https sns.<region>.amazonaws.com", () => {
  assertEquals(isValidSubscribeUrl("https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=x"), true);
  assertEquals(isValidSubscribeUrl("https://evil.com/?Action=ConfirmSubscription"), false);
});

Deno.test("buildCanonicalString orders Notification keys per SNS spec", () => {
  const s = buildCanonicalString({
    Type: "Notification",
    Message: "m",
    MessageId: "id",
    Timestamp: "t",
    TopicArn: "arn",
  });
  assertEquals(s, "Message\nm\nMessageId\nid\nTimestamp\nt\nTopicArn\narn\nType\nNotification\n");
});

Deno.test("buildCanonicalString includes Subject when present", () => {
  const s = buildCanonicalString({
    Type: "Notification", Message: "m", MessageId: "id",
    Subject: "s", Timestamp: "t", TopicArn: "arn",
  });
  assertEquals(s, "Message\nm\nMessageId\nid\nSubject\ns\nTimestamp\nt\nTopicArn\narn\nType\nNotification\n");
});

Deno.test("buildCanonicalString uses confirmation keys for SubscriptionConfirmation", () => {
  const s = buildCanonicalString({
    Type: "SubscriptionConfirmation", Message: "m", MessageId: "id",
    SubscribeURL: "u", Timestamp: "t", Token: "tok", TopicArn: "arn",
  });
  assertEquals(
    s,
    "Message\nm\nMessageId\nid\nSubscribeURL\nu\nTimestamp\nt\nToken\ntok\nTopicArn\narn\nType\nSubscriptionConfirmation\n",
  );
});

Deno.test("isValidSnsEnvelope requires Type, MessageId, TopicArn", () => {
  assertEquals(isValidSnsEnvelope({ Type: "Notification", MessageId: "1", TopicArn: "a", Message: "{}" }), true);
  assertEquals(isValidSnsEnvelope({ Type: "Notification" }), false);
  assertEquals(isValidSnsEnvelope(null), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ses-webhook/`
Expected: FAIL — `Module not found ... lib.ts`

- [ ] **Step 3: Write `lib.ts`**

Create `supabase/functions/ses-webhook/lib.ts`:

```ts
// ses-webhook — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them.

// SES event names → the event_type values the Resend webhook wrote, so the
// admin engagement metrics, drain quota ('sent'), and _NofM dedup keep working
// unchanged. Bounce/Complaint are new (additive) values.
const EVENT_TYPE_MAP: Record<string, string> = {
  Send: "sent",
  Delivery: "delivered",
  Open: "opened",
  Click: "clicked",
  Bounce: "bounced",
  Complaint: "complained",
};

export function mapSesEventType(eventType: string): string {
  return EVENT_TYPE_MAP[eventType] ?? eventType.toLowerCase();
}

export interface SesEvent {
  eventType?: string;
  mail?: {
    messageId?: string;
    timestamp?: string;
    destination?: string[];
    commonHeaders?: { subject?: string };
  };
}

// Shape an email_events row from a SES event notification.
// `nowIso` is injected so the fallback timestamp is testable.
export function buildEmailEventRow(ev: SesEvent, nowIso: string): {
  email_id: string | null;
  event_type: string;
  email_to: string | null;
  subject: string | null;
  created_at: string;
  raw: unknown;
} {
  const mail = ev.mail ?? {};
  return {
    email_id: mail.messageId ?? null,
    event_type: mapSesEventType(ev.eventType ?? "unknown"),
    email_to: mail.destination?.[0] ?? null,
    subject: mail.commonHeaders?.subject ?? null,
    created_at: mail.timestamp ?? nowIso,
    raw: ev,
  };
}

// ── SNS envelope validation ──

export interface SnsEnvelope {
  Type?: string;
  MessageId?: string;
  TopicArn?: string;
  Message?: string;
  Subject?: string;
  Timestamp?: string;
  Token?: string;
  SubscribeURL?: string;
  Signature?: string;
  SignatureVersion?: string;
  SigningCertURL?: string;
}

export function isValidSnsEnvelope(
  msg: SnsEnvelope | null | undefined,
): boolean {
  return !!(msg && msg.Type && msg.MessageId && msg.TopicArn);
}

function isSnsAwsHost(urlStr: string): URL | null {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return null;
    if (!/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

// The signing cert must come from SNS itself — otherwise an attacker could
// sign a forged payload with their own cert and pass verification.
export function isValidCertUrl(urlStr: string): boolean {
  const u = isSnsAwsHost(urlStr);
  return !!u && u.pathname.endsWith(".pem");
}

export function isValidSubscribeUrl(urlStr: string): boolean {
  return !!isSnsAwsHost(urlStr);
}

// The string SNS signed. Key order is fixed by the SNS spec (alphabetical),
// each present key contributing "Name\nValue\n".
export function buildCanonicalString(msg: SnsEnvelope): string {
  const keys = msg.Type === "SubscriptionConfirmation" || msg.Type === "UnsubscribeConfirmation"
    ? ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
    : ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"];
  let s = "";
  for (const k of keys) {
    const v = (msg as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) s += `${k}\n${v}\n`;
  }
  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ses-webhook/`
Expected: 9 passed

- [ ] **Step 5: Write `index.ts`**

Create `supabase/functions/ses-webhook/index.ts`:

```ts
// Supabase Edge Function: ses-webhook
// Receives SES email events via an SNS HTTPS subscription and stores them in
// email_events (same rows the old resend-webhook wrote). Deploy with
// --no-verify-jwt; auth = SES_WEBHOOK_TOKEN query param + SNS signature.
//
// Required Supabase secrets:
//   SES_WEBHOOK_TOKEN   — random token; the SNS subscription URL must include ?token=<it>
//   SES_SNS_TOPIC_ARN   — only this topic's messages are accepted
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { X509Certificate } from "https://esm.sh/@peculiar/x509@1.11.0";
import {
  buildCanonicalString,
  buildEmailEventRow,
  isValidCertUrl,
  isValidSnsEnvelope,
  isValidSubscribeUrl,
  type SnsEnvelope,
} from "./lib.ts";

const WEBHOOK_TOKEN = Deno.env.get("SES_WEBHOOK_TOKEN") ?? "";
const TOPIC_ARN = Deno.env.get("SES_SNS_TOPIC_ARN") ?? "";

// Signing certs rotate rarely; cache per isolate to avoid a fetch per event.
const certCache = new Map<string, CryptoKey>();

async function getSigningKey(certUrl: string, hash: string): Promise<CryptoKey> {
  const cacheKey = `${certUrl}|${hash}`;
  const cached = certCache.get(cacheKey);
  if (cached) return cached;
  const pem = await (await fetch(certUrl)).text();
  const cert = new X509Certificate(pem);
  const key = await cert.publicKey.export(
    { name: "RSASSA-PKCS1-v1_5", hash },
    ["verify"],
    crypto,
  );
  certCache.set(cacheKey, key);
  return key;
}

// Verify the SNS message signature (SignatureVersion 1 = SHA-1, 2 = SHA-256).
async function verifySnsSignature(msg: SnsEnvelope): Promise<boolean> {
  if (!msg.Signature || !msg.SigningCertURL) return false;
  if (msg.SignatureVersion !== "1" && msg.SignatureVersion !== "2") return false;
  if (!isValidCertUrl(msg.SigningCertURL)) return false;
  try {
    const hash = msg.SignatureVersion === "1" ? "SHA-1" : "SHA-256";
    const key = await getSigningKey(msg.SigningCertURL, hash);
    const sig = Uint8Array.from(atob(msg.Signature), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      sig as BufferSource,
      new TextEncoder().encode(buildCanonicalString(msg)) as BufferSource,
    );
  } catch (err) {
    console.error("[ses-webhook] Signature verification error:", err);
    return false;
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Layer 1: shared token in the subscription URL. Enforce only once the
    // secret is configured (same pattern as resend-webhook / run-campaign).
    if (WEBHOOK_TOKEN) {
      const token = new URL(req.url).searchParams.get("token") ?? "";
      if (token !== WEBHOOK_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
    } else {
      console.warn("[ses-webhook] SES_WEBHOOK_TOKEN not set — accepting WITHOUT token check (INSECURE). Set the secret to enable enforcement.");
    }

    const msg = JSON.parse(await req.text()) as SnsEnvelope;
    if (!isValidSnsEnvelope(msg)) {
      return new Response(JSON.stringify({ error: "Invalid SNS envelope" }), { status: 400 });
    }

    // Layer 2: only our topic.
    if (TOPIC_ARN && msg.TopicArn !== TOPIC_ARN) {
      return new Response(JSON.stringify({ error: "Unknown topic" }), { status: 403 });
    }

    // Layer 3: SNS message signature (forged events would poison metrics).
    if (!(await verifySnsSignature(msg))) {
      console.warn("[ses-webhook] Invalid SNS signature — rejecting");
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
    }

    if (msg.Type === "SubscriptionConfirmation") {
      if (!msg.SubscribeURL || !isValidSubscribeUrl(msg.SubscribeURL)) {
        return new Response(JSON.stringify({ error: "Invalid SubscribeURL" }), { status: 400 });
      }
      const res = await fetch(msg.SubscribeURL);
      console.log(`[ses-webhook] Subscription confirmation fetched: ${res.status}`);
      return new Response(JSON.stringify({ confirmed: res.ok }), { status: 200 });
    }

    if (msg.Type !== "Notification") {
      return new Response(JSON.stringify({ ignored: msg.Type }), { status: 200 });
    }

    const sesEvent = JSON.parse(msg.Message ?? "{}");
    const row = buildEmailEventRow(sesEvent, new Date().toISOString());

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { error } = await supabase.from("email_events").insert(row);
    if (error) {
      console.error("[ses-webhook] Insert error:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    console.log(`[ses-webhook] Stored ${row.event_type} for ${row.email_to}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("[ses-webhook] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
```

- [ ] **Step 6: Run full function tests (regression)**

Run: `npm run test:functions`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ses-webhook/
git commit -m "ses: SNS event webhook writing email_events (token + topic + signature checks)"
```

- [ ] **Step 8: Deploy and wire up the SNS subscription** (requires Task 1 Steps 5+7)

```bash
npx supabase functions deploy ses-webhook --no-verify-jwt
```

Then in the SNS console → topic `wrotate-email-events` → Create subscription → Protocol **HTTPS** → Endpoint:
`https://<project-ref>.supabase.co/functions/v1/ses-webhook?token=<SES_WEBHOOK_TOKEN value>`
(get `<project-ref>` from `npx supabase projects list` or the existing resend-webhook URL). The function auto-confirms; the subscription should show **Confirmed** within seconds. If it stays Pending, check `npx supabase functions logs ses-webhook` — wrong token or ARN mismatch will show there.

- [ ] **Step 9: End-to-end sandbox verification** — SES console → the `wrotate.com` identity (or a verified email identity) → **Send test email** → to `ozgurdogan@gmail.com`, any subject. Wait ~30s, then:

```bash
npx supabase db query --linked "SELECT event_type, email_to, subject, created_at FROM email_events WHERE created_at > now() - interval '10 minutes' ORDER BY created_at DESC LIMIT 10;"
```

Expected: `sent` and `delivered` rows for the test message. (Console test sends may not use the config set — if no rows appear, send via curl through the deployed send-report function AFTER Task 4 instead; the definitive check happens there. Do not proceed to Task 5 until events are confirmed flowing.)

---

## Task 4: Migrate admin-only senders (new-user-alert, report-notify, send-report)

Lowest-risk senders: all go to ADMIN_EMAIL / internal accounts, so sandbox mode suffices (recipient `ozgurdogan@gmail.com` is verified in Task 1 Step 4).

**Files:**
- Modify: `supabase/functions/new-user-alert/index.ts` (imports, lines 15, 42-44, 73-95)
- Modify: `supabase/functions/report-notify/index.ts` (imports, lines 15, 44-46, 62-85)
- Modify: `supabase/functions/send-report/index.ts` (imports, lines 9, 45-57)
- Modify: `supabase/functions/send-report/lib.ts` (rename `buildResendBody` → `buildEmailFields`)
- Modify: `supabase/functions/send-report/lib.test.ts` (rename references)

**Interfaces:**
- Consumes: `sendSesEmail(msg: SesMessage): Promise<SesResult>` from `../_shared/ses.ts`
- Produces: `buildEmailFields(to, subject, html, from?)` in send-report/lib.ts (same shape as old `buildResendBody`)

- [ ] **Step 1: Rename in send-report/lib.ts + tests first (TDD for the rename)**

In `supabase/functions/send-report/lib.test.ts` replace every occurrence of `buildResendBody` with `buildEmailFields`. Run `deno test supabase/functions/send-report/` — expected FAIL (name not exported). Then in `supabase/functions/send-report/lib.ts` replace:

```ts
// Build the Resend API request body for an outgoing email.
export function buildResendBody(
```

with:

```ts
// Build the outgoing email fields (provider-agnostic).
export function buildEmailFields(
```

Run `deno test supabase/functions/send-report/` — expected PASS.

- [ ] **Step 2: Swap send-report/index.ts to SES**

Replace the import block and send call:

```ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSesEmail } from "../_shared/ses.ts";
import {
  buildEmailFields,
  extractBearerToken,
  hasRequiredFields,
} from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
```

(drop the `RESEND_API_KEY` const). Replace the fetch block (old lines 45-57):

```ts
  const fields = buildEmailFields(to, subject, html);
  const result = await sendSesEmail({
    from: fields.from,
    to: Array.isArray(fields.to) ? fields.to as string[] : [fields.to as string],
    subject: fields.subject as string,
    html: fields.html as string,
  });
  if (!result.ok) {
    return new Response(result.error, { status: 502 });
  }
```

- [ ] **Step 3: Swap new-user-alert/index.ts to SES**

Add `import { sendSesEmail } from "../_shared/ses.ts";`, delete the `RESEND_API_KEY` const, change the config guard (old lines 42-45) to check only `ADMIN_EMAIL`:

```ts
    if (!ADMIN_EMAIL) {
      console.warn("[new-user-alert] Missing ADMIN_EMAIL");
      return new Response(JSON.stringify({ skipped: true, reason: "Missing config" }), { status: 200 });
    }
```

Replace the send block (old lines 73-95):

```ts
    const result = await sendSesEmail({
      from: "WRotate <notifications@wrotate.com>",
      to: [ADMIN_EMAIL],
      subject,
      html: htmlBody,
    });

    if (!result.ok) {
      console.error("[new-user-alert] SES error:", result.error);
      return new Response(JSON.stringify({ error: "email send failed", details: result.error }), { status: 500 });
    }

    console.log(`[new-user-alert] Sent alert for @${username} (${userEmail})`);
    return new Response(JSON.stringify({ sent: true, id: result.id }), { status: 200 });
```

- [ ] **Step 4: Swap report-notify/index.ts to SES**

Same pattern: add the `sendSesEmail` import, drop `RESEND_API_KEY`, guard only on `ADMIN_EMAIL`, replace the send block (old lines 62-86):

```ts
    const result = await sendSesEmail({
      from: "WRotate Reports <reports@wrotate.com>",
      to: [ADMIN_EMAIL],
      subject,
      html: htmlBody,
    });
    if (!result.ok) {
      // Don't report success on a send failure — a silently-dropped moderation
      // alert means a report goes unseen.
      console.error("[report-notify] SES error:", result.status, result.error);
      return new Response(
        JSON.stringify({ error: "Email send failed", status: result.status, details: result.error }),
        { status: 502 },
      );
    }
    console.log("[report-notify] Email sent:", result.id);
```

- [ ] **Step 5: Run tests**

Run: `npm run test:functions && npm test`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/new-user-alert supabase/functions/report-notify supabase/functions/send-report
git commit -m "ses: migrate admin senders (new-user-alert, report-notify, send-report) off Resend"
```

- [ ] **Step 7: Deploy + UAT**

```bash
npx supabase functions deploy send-report --no-verify-jwt
npx supabase functions deploy new-user-alert --no-verify-jwt
npx supabase functions deploy report-notify --no-verify-jwt
npm run test:smoke
```

UAT: invoke send-report as the internal test account (testuser) to `ozgurdogan@gmail.com` with subject `SES migration UAT — send-report`. Confirm: (1) email arrives from notifications@wrotate.com, (2) DKIM pass for wrotate.com in the Gmail "show original" view, (3) within ~1 min:

```bash
npx supabase db query --linked "SELECT event_type, email_to, subject FROM email_events WHERE subject LIKE 'SES migration UAT%' ORDER BY created_at;"
```

Expected: `sent` + `delivered` rows. This is the definitive proof the config set → SNS → webhook chain works.

---

## Task 5: Migrate send-email (notifications) and send-wear-reminders

These email real users. **Gate: production access granted (Task 1 Step 2), OR flip them but verify with test accounts only** — in sandbox SES rejects unverified recipients with a 400, which both functions already treat as a non-fatal failure path (notification skipped / `failed++`), and Resend is no longer called for them — so only flip these once production access is granted.

**Files:**
- Modify: `supabase/functions/send-email/index.ts` (imports, line 24, lines 142-169)
- Modify: `supabase/functions/send-wear-reminders/index.ts` (imports, line 16, lines 63-70)

**Interfaces:**
- Consumes: `sendSesEmail` from `../_shared/ses.ts`

- [ ] **Step 1: Swap send-email/index.ts**

Add `import { sendSesEmail } from "../_shared/ses.ts";`, remove the `RESEND_API_KEY` const (line 24). Replace the send block (old lines 142-169):

```ts
    // Send via SES
    const result = await sendSesEmail({
      from: FROM_EMAIL,
      to: [recipientEmail],
      subject: content.subject,
      html,
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (!result.ok) {
      console.error("[send-email] SES error:", result.error);
      return new Response(JSON.stringify({ error: "email send failed", details: result.error }), { status: 500 });
    }

    console.log(`[send-email] Sent to ${recipientEmail} (${type}/${category})`);
    return new Response(JSON.stringify({ sent: true, id: result.id }), { status: 200 });
```

- [ ] **Step 2: Swap send-wear-reminders/index.ts**

Add `import { sendSesEmail } from "../_shared/ses.ts";`, remove the `RESEND_API_KEY` const (line 16), update the header comment secret list. Replace the email branch (old lines 63-70):

```ts
          const sig = await hmacSign(t.user_id, "reminders", SERVICE_KEY);
          const url = unsubUrl(SUPABASE_URL, t.user_id, sig, "reminders");
          const html = buildHtmlEmail(mail.subject, mail.body, url);
          const result = await sendSesEmail({
            from: FROM_EMAIL,
            to: [t.email],
            subject: mail.subject,
            html,
            headers: {
              "List-Unsubscribe": `<${url}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          });
          if (!result.ok) { failed++; continue; }
          emailed++;
```

(Note: this also adds the List-Unsubscribe header the reminder email was missing — the unsubscribe URL already existed in the body via `buildHtmlEmail`.)

- [ ] **Step 3: Run tests**

Run: `npm run test:functions && npm test`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-email supabase/functions/send-wear-reminders
git commit -m "ses: migrate send-email + send-wear-reminders off Resend"
```

- [ ] **Step 5: Deploy + UAT (production access must be granted by now)**

```bash
npx supabase functions deploy send-email --no-verify-jwt
npx supabase functions deploy send-wear-reminders --no-verify-jwt
npm run test:smoke
```

UAT: as testuser2, comment on a private post of testuser (both are mutual close friends — keep visibility private) → testuser should receive the comment notification email via SES. Confirm the email arrives at test@wrotate.com and the `sent`/`delivered` rows appear in `email_events`. For wear reminders, the next hourly cron run covers it — check the following day:

```bash
npx supabase db query --linked "SELECT channel, count(*) FROM wear_reminder_sends WHERE sent_on = current_date GROUP BY 1;"
```

Expected: email count > 0 on a normal day, and matching `sent` rows in `email_events` from hello@wrotate.com sends.

---

## Task 6: Migrate run-campaign and send-broadcast (batch senders)

**Gate: production access granted.** These are the volume senders; per-recipient results now drive send-tracking (an improvement — Resend's batch marked all 100 sent/failed together).

**Files:**
- Modify: `supabase/functions/run-campaign/index.ts` (imports, line 27, `deliver()` lines 94-163)
- Modify: `supabase/functions/send-broadcast/index.ts` (imports, line 37, batch loop lines 288-350, `drainQueue()` lines 393-437, `sendEmail()` lines 442-462)

**Interfaces:**
- Consumes: `sendSesEmail`, `sendSesBatch` from `../_shared/ses.ts` (note `run-campaign` uses `jsr:` imports elsewhere but relative imports work identically)

- [ ] **Step 1: run-campaign — replace `deliver()`**

Add `import { sendSesBatch } from "../_shared/ses.ts";` and `import type { SesMessage } from "../_shared/ses.ts";`, remove the `RESEND_API_KEY` const (line 27). Replace the body of `deliver()` (keep signature and the batch-of-100 outer loop so tracking upserts stay ≤100 rows):

```ts
async function deliver(
  supabase: Db,
  campaign: Campaign,
  toSend: Recipient[],
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const batchSize = 100;

  for (let i = 0; i < toSend.length; i += batchSize) {
    const batch = toSend.slice(i, i + batchSize);
    const messages: SesMessage[] = await Promise.all(batch.map(async (r) => {
      const sig = await hmacSign(r.uid, "updates", SUPABASE_SERVICE_ROLE_KEY);
      const url = unsubUrl(SUPABASE_URL, r.uid, sig, "updates");
      const personalizedBody = personalizeBody(campaign.body_html, r.displayName);
      const html = buildHtmlEmail(campaign.subject, personalizedBody, url);
      return {
        from: FROM_EMAIL,
        to: [r.email],
        subject: campaign.subject,
        html,
        headers: {
          "List-Unsubscribe": `<${url}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    }));

    const { results } = await sendSesBatch(messages);
    // Track ONLY the recipients whose individual send succeeded — per-recipient
    // results are finer than the old all-or-nothing Resend batch semantics.
    const okRecipients = batch.filter((_, idx) => results[idx].ok);
    sent += okRecipients.length;
    failed += batch.length - okRecipients.length;
    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx];
      if (!r.ok) console.error(`[run-campaign] SES send failed for ${batch[idx].uid}:`, r.error);
    }
    if (okRecipients.length) {
      const { error: trackErr } = await supabase
        .from("email_campaign_sends")
        .upsert(
          okRecipients.map((r) => ({ campaign_id: campaign.id, user_id: r.uid })),
          { onConflict: "campaign_id,user_id", ignoreDuplicates: true },
        );
      if (trackErr) {
        console.error(`[run-campaign] Send-tracking upsert error:`, trackErr);
      }
    }
  }

  return { sent, failed };
}
```

(The inter-batch 200ms sleep goes away — `sendSesBatch` paces internally.)

- [ ] **Step 2: send-broadcast — imports and single-send**

Add `import { sendSesBatch, sendSesEmail } from "../_shared/ses.ts";` and `import type { SesMessage } from "../_shared/ses.ts";`, remove the `RESEND_API_KEY` const (line 37). Replace `sendEmail()` (old lines 442-462):

```ts
async function sendEmail(to: string, subject: string, html: string) {
  const result = await sendSesEmail({ from: FROM_EMAIL, to: [to], subject, html });
  if (!result.ok) {
    throw new Error(`SES error: ${result.error}`);
  }
  return { id: result.id };
}
```

- [ ] **Step 3: send-broadcast — main batch loop**

Replace the send loop (old lines 288-350). The payload build stays; the fetch is replaced and tracking becomes per-recipient:

```ts
    // Send via SES in chunks of 100 (tracking upserts stay ≤100 rows each)
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < filteredRecipients.length; i += batchSize) {
      const batch = filteredRecipients.slice(i, i + batchSize);
      const messages: SesMessage[] = await Promise.all(batch.map(async (r) => {
        const sig = await hmacSign(r.uid, "updates", supabaseServiceKey);
        const url = unsubUrl(supabaseUrl, r.uid, sig, "updates");
        return {
          from: FROM_EMAIL,
          to: [r.email],
          subject,
          html: safeHtml + unsubFooter(url),
          headers: {
            "List-Unsubscribe": `<${url}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      }));

      const { results } = await sendSesBatch(messages);
      const okRecipients = batch.filter((_, idx) => results[idx].ok);
      sent += okRecipients.length;
      failed += batch.length - okRecipients.length;
      for (let idx = 0; idx < results.length; idx++) {
        const r = results[idx];
        if (!r.ok) errors.push(`${batch[idx].email}: ${r.error}`);
      }

      // Cohort blast: record successful sends so re-clicking won't double-send
      if (cohort && campaign_id && okRecipients.length) {
        const now = new Date().toISOString();
        const rows = okRecipients.map(r => ({ campaign_id, user_id: r.uid, sent_at: now }));
        const { error: trackErr } = await supabase
          .from("email_campaign_sends")
          .upsert(rows, { onConflict: "campaign_id,user_id", ignoreDuplicates: true });
        if (trackErr) {
          errors.push(`Tracking upsert error: ${trackErr.message}`);
        }
      }
    }
```

(Keep the `console.log` + `jsonResponse` lines that follow unchanged.)

- [ ] **Step 4: send-broadcast — `drainQueue()` send loop**

Replace the loop body (old lines 396-437) with per-row status from per-recipient results:

```ts
  let sent = 0, failed = 0;
  const errors: string[] = [];
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const messages: SesMessage[] = await Promise.all(batch.map(async (r) => {
      const sig = await hmacSign(r.uid, "updates", serviceKey);
      const url = unsubUrl(supabaseUrl, r.uid, sig, "updates");
      return {
        from: FROM_EMAIL,
        to: [r.email],
        subject: r.subject,
        html: r.html + unsubFooter(url),
        headers: {
          "List-Unsubscribe": `<${url}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    }));

    const { results } = await sendSesBatch(messages);
    const okIds: number[] = [];
    const failedIds: number[] = [];
    for (let idx = 0; idx < results.length; idx++) {
      if (results[idx].ok) okIds.push(batch[idx].id);
      else {
        failedIds.push(batch[idx].id);
        errors.push((results[idx] as { error: string }).error);
      }
    }
    sent += okIds.length;
    failed += failedIds.length;
    if (okIds.length) {
      await supabase.from("broadcast_queue")
        .update({ status: "sent", sent_at: new Date().toISOString() }).in("id", okIds);
    }
    if (failedIds.length) {
      await supabase.from("broadcast_queue")
        .update({ status: "failed", error: errors.slice(-1)[0]?.slice(0, 500) ?? "send failed" }).in("id", failedIds);
    }
  }
```

Also update the comment above `drainQueue` (old lines 361-363): `email_events` 'sent' rows now come from the SES webhook, not Resend — wording only, logic identical. The drain quota itself (`drainBudget`) still works and now protects the SES sending quota instead of Resend's daily cap; leave its limit as-is for this migration (raising it is a separate decision after cutover).

- [ ] **Step 5: Run tests**

Run: `npm run test:functions && npm test`
Expected: all pass (lib.ts files for both functions are untouched, so their unit tests must not change)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/run-campaign supabase/functions/send-broadcast
git commit -m "ses: migrate run-campaign + send-broadcast; per-recipient send tracking"
```

- [ ] **Step 7: Deploy + UAT**

```bash
npx supabase functions deploy run-campaign --no-verify-jwt
npx supabase functions deploy send-broadcast --no-verify-jwt
npm run test:smoke
```

UAT: from the admin UI, `send-broadcast` with `test_email: "ozgurdogan@gmail.com"` and subject `SES migration UAT — broadcast`. Confirm delivery + `email_events` rows. Then a `dry_run` broadcast to confirm recipient resolution is unchanged. The next 10:00 UTC `run-email-campaigns` cron run is the live test for run-campaign — check the morning after:

```bash
npx supabase db query --linked "SELECT count(*) FROM email_campaign_sends WHERE sent_at > now() - interval '1 day';"
npx supabase db query --linked "SELECT event_type, count(*) FROM email_events WHERE created_at > now() - interval '1 day' GROUP BY 1;"
```

Expected: campaign sends > 0 (on a day with eligible users) with matching `sent`/`delivered` events.

---

## Task 7: Cutover verification, Resend retirement, docs

**Files:**
- Modify: `CLAUDE.md` (add SES notes to Edge Function section)
- Delete (retire): `supabase/functions/resend-webhook/` — only after Step 2 passes

- [ ] **Step 1: Check Supabase Auth SMTP** — Supabase dashboard → Authentication → Emails/SMTP settings. If custom SMTP points at Resend (`smtp.resend.com`): create SES SMTP credentials (SES console → SMTP settings → Create SMTP credentials; host `email-smtp.us-east-1.amazonaws.com`, port 587, sender `notifications@wrotate.com`) and swap them in. If it's on Supabase's built-in mailer, nothing to do. Verify by triggering a password-reset email to test@wrotate.com.

- [ ] **Step 2: 48-hour parallel-run check** — two days after Task 6 deploys, confirm no sender still hits Resend and events flow only from SES:

```bash
npx supabase db query --linked "SELECT event_type, count(*), min(created_at), max(created_at) FROM email_events WHERE created_at > now() - interval '2 days' GROUP BY 1;"
```

Expected: normal daily `sent`/`delivered` volume (~30/day average). Also check the Resend dashboard shows **zero** sends in those 48h, and check for `bounced`/`complained` rows — investigate any complaint immediately (SES account health).

- [ ] **Step 3: Retire resend-webhook + Resend secrets**

```bash
git rm -r supabase/functions/resend-webhook
git commit -m "ses: retire resend-webhook (SES/SNS webhook replaced it)"
npx supabase functions delete resend-webhook
npx supabase secrets unset RESEND_API_KEY RESEND_WEBHOOK_SECRET
```

Then delete the webhook endpoint + API key in the Resend dashboard (keep the Resend account dormant as a fallback for a month, then close).

- [ ] **Step 4: Run full suites**

Run: `npm test && npm run test:functions && npm run test:e2e && npm run test:smoke`
Expected: all pass (resend-webhook's tests are gone with the directory)

- [ ] **Step 5: Update CLAUDE.md** — in the "Edge Function Deployment" section add:

```markdown
- **Email sends go through AWS SES v2** (region us-east-1, config set `wrotate-events`) via `supabase/functions/_shared/ses.ts`. Every send must keep the config set — `email_events` 'sent' rows (drain quota, batch dedup, engagement metrics) come from the SES→SNS→`ses-webhook` pipeline. Secrets: `SES_AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY`, `SES_REGION`, `SES_CONFIG_SET`, `SES_SNS_TOPIC_ARN`, `SES_WEBHOOK_TOKEN`.
- **Watch bounce/complaint rates** (`email_events` types `bounced`/`complained`) — sustained bounce >5% or complaint >0.1% risks SES account review.
```

- [ ] **Step 6: Commit + deploy**

```bash
git add CLAUDE.md
git commit -m "ses: document SES pipeline in CLAUDE.md"
git push origin main
```

(Push per normal workflow — all tests green first. No client-side changes shipped in this plan, so no SW cache bump.)

---

## Self-Review Notes

- Every `email_events` consumer identified in scoping (drain quota `event_type='sent'`, `_NofM` subject dedup, admin engagement metrics) is preserved via the config-set → SNS → webhook chain; called out as a global constraint.
- Sandbox/production sequencing: Tasks 2–4 run entirely in sandbox; Tasks 5–6 are gated on production access (requested first thing in Task 1).
- The one behavioral improvement (per-recipient tracking instead of per-batch) is deliberate and noted where it appears; everything else is a like-for-like swap.
- `send-wear-reminders` gains the List-Unsubscribe header it was missing — noted inline.
