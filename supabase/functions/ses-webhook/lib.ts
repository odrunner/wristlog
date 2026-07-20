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
  // Per-event blocks. Each carries the time the EVENT happened; mail.timestamp is
  // only ever the time the message was sent.
  open?: { timestamp?: string };
  click?: { timestamp?: string };
  delivery?: { timestamp?: string };
  bounce?: { timestamp?: string };
  complaint?: { timestamp?: string };
  mail?: {
    messageId?: string;
    timestamp?: string;
    destination?: string[];
    commonHeaders?: { subject?: string };
  };
}

// Shape an email_events row from a SES event notification.
// `nowIso` is injected so the fallback timestamp is testable.
// `snsMessageId` is the SNS envelope's MessageId (not the SES mail.messageId) —
// used to dedup at-least-once SNS redelivery of the same notification; null for
// callers that don't have one (there are none in production, but keeps the
// function testable without an envelope).
export function buildEmailEventRow(ev: SesEvent, nowIso: string, snsMessageId: string | null): {
  email_id: string | null;
  event_type: string;
  email_to: string | null;
  subject: string | null;
  created_at: string;
  raw: unknown;
  sns_message_id: string | null;
} {
  const mail = ev.mail ?? {};
  return {
    email_id: mail.messageId ?? null,
    event_type: mapSesEventType(ev.eventType ?? "unknown"),
    email_to: mail.destination?.[0] ?? null,
    subject: mail.commonHeaders?.subject ?? null,
    created_at: sesEventTimestamp(ev) ?? nowIso,
    raw: ev,
    sns_message_id: snsMessageId,
  };
}

// When the event happened — NOT when the message was sent.
//
// This used `mail.timestamp`, which SES sets to the original send time on every
// notification. So an open a week after the send was recorded on the send date:
// "recent opens" never surfaced it and every engagement window mis-attributed it.
// Verified in production 2026-07-19 — `sent`, `delivered` and `opened` all shared
// an identical max(created_at), which is impossible if opens were timed
// independently. Falls back to mail.timestamp for Send events, where the two are
// legitimately the same.
export function sesEventTimestamp(ev: SesEvent): string | null {
  return ev.open?.timestamp
    ?? ev.click?.timestamp
    ?? ev.delivery?.timestamp
    ?? ev.bounce?.timestamp
    ?? ev.complaint?.timestamp
    ?? ev.mail?.timestamp
    ?? null;
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

// True if the SNS Timestamp (ISO 8601) is within `toleranceSec` of now —
// blocks replay of captured, validly-signed payloads (mirrors resend-webhook's
// timestampWithinTolerance; SNS timestamps are ISO strings, not epoch seconds).
export function timestampWithinTolerance(
  timestamp: string | undefined,
  nowMs: number,
  toleranceSec = 300,
): boolean {
  if (!timestamp) return false;
  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs - ts) <= toleranceSec * 1000;
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
