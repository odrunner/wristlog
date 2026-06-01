// resend-webhook — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

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
