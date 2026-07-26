// _shared/resend — Resend send client for edge functions.
// Interface-compatible with _shared/ses.ts (same result shape, same batch
// contract) so a function can switch transports by changing one import.
// Secret: RESEND_API_KEY.

import {
  buildResendPayload,
  chunk,
  extractBatchIds,
  isRetryableStatus,
  RESEND_BATCH_ENDPOINT,
} from "./resend-lib.ts";
import type { ResendMessage } from "./resend-lib.ts";
export type { ResendMessage } from "./resend-lib.ts";
export { isRetryableStatus } from "./resend-lib.ts";

const API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

export type ResendResult =
  | { ok: true; id: string }
  // `retryable` distinguishes "Resend was busy / the network blipped" from
  // "Resend will never accept this message". Callers must NOT mark a retryable
  // failure as permanently failed — the broadcast queue only ever re-selects
  // `pending`, so a row marked `failed` is dropped forever.
  | { ok: false; status: number; error: string; retryable: boolean };

const MAX_ATTEMPTS = 3;
// Resend's batch endpoint accepts up to 100 messages per request.
const MAX_BATCH = 100;

function authHeaders(): Record<string, string> {
  return {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function postBatchOnce(msgs: ResendMessage[]): Promise<ResendResult[]> {
  try {
    const res = await fetch(RESEND_BATCH_ENDPOINT, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(msgs.map(buildResendPayload)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Resend validates a batch as a unit — a rejected request rejects every
      // message in it, so every message carries the same verdict.
      const err = JSON.stringify(data).slice(0, 500);
      const retryable = isRetryableStatus(res.status);
      return msgs.map(() => ({ ok: false as const, status: res.status, error: err, retryable }));
    }
    const ids = extractBatchIds(data, msgs.length);
    return ids.map((id) => ({ ok: true as const, id }));
  } catch (err) {
    return msgs.map(() => ({ ok: false as const, status: 0, error: String(err), retryable: true }));
  }
}

// Send one wave, retrying the whole wave while the failure is retryable.
// results[i] always corresponds to msgs[i].
async function sendWave(msgs: ResendMessage[]): Promise<ResendResult[]> {
  let last: ResendResult[] = msgs.map(() => ({
    ok: false as const,
    status: 0,
    error: "not attempted",
    retryable: true,
  }));
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await postBatchOnce(msgs);
    const failure = last.find((r) => !r.ok) as
      | { ok: false; retryable: boolean }
      | undefined;
    if (!failure || !failure.retryable) return last;
    // 400ms, 1200ms — bounded so a wave can't blow the function time limit.
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 400 * Math.pow(3, attempt - 1)));
    }
  }
  return last;
}

export async function sendResendEmail(msg: ResendMessage): Promise<ResendResult> {
  const [result] = await sendWave([msg]);
  return result;
}

// Batch send. Chunked at Resend's 100-per-request cap, with a short pause
// between chunks to stay under the default 2 req/s rate limit.
// results[i] always corresponds to msgs[i].
export async function sendResendBatch(
  msgs: ResendMessage[],
): Promise<{ results: ResendResult[]; sent: number; failed: number }> {
  const results: ResendResult[] = [];
  const waves = chunk(msgs, MAX_BATCH);
  for (let i = 0; i < waves.length; i++) {
    results.push(...await sendWave(waves[i]));
    if (i < waves.length - 1) await new Promise((r) => setTimeout(r, 600));
  }
  const sent = results.filter((r) => r.ok).length;
  return { results, sent, failed: results.length - sent };
}
