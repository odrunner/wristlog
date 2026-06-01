// send-report — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.
//
// This function is a thin admin-only relay to Resend, so the pure logic is
// limited to request parsing/validation and outgoing payload shaping.

export const FROM_EMAIL = "WRotate <notifications@wrotate.com>";

// Extract the bearer token from an Authorization header value.
// Mirrors `authHeader.replace("Bearer ", "")` — only strips the first match,
// returns "" when the header is absent.
export function extractBearerToken(authHeader: string | null | undefined): string {
  return (authHeader ?? "").replace("Bearer ", "");
}

// True if the request supplies all required email fields.
export function hasRequiredFields(
  payload: { to?: unknown; subject?: unknown; html?: unknown } | null | undefined,
): boolean {
  return !!payload && !!payload.to && !!payload.subject && !!payload.html;
}

// Build the Resend API request body for an outgoing email.
export function buildResendBody(
  to: unknown,
  subject: unknown,
  html: unknown,
  from: string = FROM_EMAIL,
): { from: string; to: unknown; subject: unknown; html: unknown } {
  return { from, to, subject, html };
}
