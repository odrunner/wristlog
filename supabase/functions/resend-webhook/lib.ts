// resend-webhook — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

// ── Webhook signature verification (Svix scheme, used by Resend) ──
// Resend signs webhooks via Svix. Headers: svix-id, svix-timestamp, svix-signature.
// The signed content is `${id}.${timestamp}.${rawBody}`, HMAC-SHA256'd with the
// base64-decoded secret (the part after the `whsec_` prefix), base64-encoded.
// svix-signature is a space-separated list of `v1,<sig>` entries (key rotation).

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Constant-time string compare (avoids leaking via early-exit timing).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SvixHeaders {
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
}

// True if the timestamp is within `toleranceSec` of now — blocks replay of old payloads.
export function timestampWithinTolerance(
  svixTimestamp: string | null,
  nowMs: number,
  toleranceSec = 300,
): boolean {
  if (!svixTimestamp) return false;
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs - ts * 1000) <= toleranceSec * 1000;
}

// Verify a Svix-signed webhook. Returns true only if a provided signature matches.
export async function verifyWebhookSignature(
  secret: string,
  headers: SvixHeaders,
  rawBody: string,
): Promise<boolean> {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false;

  const secretKey = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(secretKey);
  } catch {
    return false;
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC", cryptoKey, new TextEncoder().encode(signedContent) as BufferSource,
  );
  const expected = bytesToBase64(new Uint8Array(sigBuf));

  // Header is space-separated `version,signature` pairs; compare against each.
  for (const part of svixSignature.split(" ")) {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    if (sig && timingSafeEqual(sig, expected)) return true;
  }
  return false;
}

// True if the webhook payload has the required top-level fields.
export function isValidPayload(
  body: { type?: unknown; data?: unknown } | null | undefined,
): boolean {
  return !!(body && body.type && body.data);
}

// Strip the "email." prefix from a Resend event type (e.g. "email.delivered" → "delivered").
export function normalizeEventType(type: string): string {
  return type.replace("email.", "");
}

interface ResendData {
  email_id?: string | null;
  to?: string | string[] | null;
  subject?: string | null;
  created_at?: string | null;
}

// Shape an email_events row from a Resend webhook payload.
// `nowIso` is injected so the fallback timestamp is testable.
export function buildEmailEventRow(
  body: { type: string; data: ResendData },
  nowIso: string,
): {
  email_id: string | null;
  event_type: string;
  email_to: string | null;
  subject: string | null;
  created_at: string;
  raw: unknown;
} {
  const data = body.data;
  return {
    email_id: data.email_id ?? null,
    event_type: normalizeEventType(body.type),
    email_to: Array.isArray(data.to) ? data.to[0] : (data.to ?? null),
    subject: data.subject ?? null,
    created_at: data.created_at ?? nowIso,
    raw: body,
  };
}
