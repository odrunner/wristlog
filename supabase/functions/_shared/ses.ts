// _shared/ses — SES v2 send client for edge functions.
// SigV4 signing via aws4fetch (WebCrypto-based, edge-safe).
// Secrets: SES_AWS_ACCESS_KEY_ID, SES_AWS_SECRET_ACCESS_KEY, SES_REGION,
//          SES_CONFIG_SET (default "wrotate-events").

import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
import { buildSesPayload, chunk, sesEndpoint } from "./ses-lib.ts";
import type { SesMessage } from "./ses-lib.ts";
export type { SesMessage } from "./ses-lib.ts";

const REGION = Deno.env.get("SES_REGION") ?? "us-west-2";
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
  // `retryable` distinguishes "SES was busy / the network blipped" from "SES will
  // never accept this message". Callers must NOT mark a retryable failure as
  // permanently failed — the broadcast queue only ever re-selects `pending`, so a
  // row marked `failed` is dropped forever.
  | { ok: false; status: number; error: string; retryable: boolean };

// 429 = throttling, 5xx = SES-side, 0 = network throw. Everything else (400
// MessageRejected, MailFromDomainNotVerified, 403…) is permanent.
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 0 || (status >= 500 && status < 600);
}

const MAX_ATTEMPTS = 3;

export async function sendSesEmail(msg: SesMessage): Promise<SesResult> {
  let last: SesResult = { ok: false, status: 0, error: "not attempted", retryable: true };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await sendSesOnce(msg);
    if (last.ok || !last.retryable) return last;
    // 400ms, 1200ms — bounded so a wave of 10 can't blow the function time limit.
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 400 * Math.pow(3, attempt - 1)));
    }
  }
  return last;
}

async function sendSesOnce(msg: SesMessage): Promise<SesResult> {
  try {
    const res = await getClient().fetch(sesEndpoint(REGION), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSesPayload(msg, CONFIG_SET)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: JSON.stringify(data).slice(0, 500),
        retryable: isRetryableStatus(res.status),
      };
    }
    return { ok: true, id: (data as { MessageId?: string }).MessageId ?? "" };
  } catch (err) {
    return { ok: false, status: 0, error: String(err), retryable: true };
  }
}

// Live SES sending quota. The broadcast drain used a hardcoded 100/day carried
// over from Resend; reading the real quota removes the guess and keeps working if
// the account moves out of sandbox.
export type SesQuota = {
  max24Hour: number;
  maxSendRate: number;
  sentLast24Hours: number;
  productionAccess: boolean;
};

export async function getSesQuota(): Promise<SesQuota | null> {
  try {
    const res = await getClient().fetch(
      `https://email.${REGION}.amazonaws.com/v2/email/account`,
      { method: "GET" },
    );
    if (!res.ok) return null;
    const d = await res.json() as {
      SendQuota?: { Max24HourSend?: number; MaxSendRate?: number; SentLast24Hours?: number };
      ProductionAccessEnabled?: boolean;
    };
    const q = d.SendQuota ?? {};
    if (typeof q.Max24HourSend !== "number") return null;
    return {
      max24Hour: q.Max24HourSend,
      maxSendRate: q.MaxSendRate ?? 0,
      sentLast24Hours: q.SentLast24Hours ?? 0,
      productionAccess: d.ProductionAccessEnabled === true,
    };
  } catch {
    return null;
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
