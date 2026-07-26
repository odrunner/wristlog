// _shared/resend-lib — pure logic for the Resend send client (no Deno/IO/network).
// resend.ts imports these; resend-lib.test.ts tests them.
//
// Mirrors ses-lib deliberately: the SES migration (2026-07-19) is still in the
// tree but AWS never granted production access, so user-facing mail runs on
// Resend. Keeping the two transports interface-compatible means switching back
// is a one-line import change in the calling function.

export interface ResendMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  headers?: Record<string, string>;
}

export const RESEND_BATCH_ENDPOINT = "https://api.resend.com/emails/batch";
export const RESEND_SEND_ENDPOINT = "https://api.resend.com/emails";

// Resend's batch endpoint takes a bare array of message objects — the same
// shape as the single-send body. Drop `headers` when empty so the payload
// matches what the single-send path posts.
export function buildResendPayload(msg: ResendMessage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    from: msg.from,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
  };
  if (Object.keys(msg.headers ?? {}).length) out.headers = msg.headers;
  return out;
}

// 429 = rate limit (Resend allows 2 req/s by default), 5xx = Resend-side,
// 0 = network throw. Everything else (400 validation, 401/403 bad key,
// 422 unprocessable) is permanent — retrying can only waste quota.
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 0 || (status >= 500 && status < 600);
}

// Pull the per-message ids out of a batch response. Resend returns
// { data: [{ id }, ...] } in request order. A short or missing array means we
// can't attribute ids — callers fall back to empty strings, never to silence.
export function extractBatchIds(body: unknown, expected: number): string[] {
  const data = (body as { data?: unknown })?.data;
  const rows = Array.isArray(data) ? data : [];
  return Array.from({ length: expected }, (_, i) => {
    const id = (rows[i] as { id?: unknown } | undefined)?.id;
    return typeof id === "string" ? id : "";
  });
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
