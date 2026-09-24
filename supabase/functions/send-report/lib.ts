// send-report — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.
//
// This function is a thin admin-only email relay (SES), so the pure logic is
// limited to request parsing/validation and outgoing payload shaping.

export const FROM_EMAIL = "WRotate <notifications@wrotate.com>";

// The only inbox this relay may deliver to — the address the Mac Mini report
// scripts (cost-report, nightly-analysis, rollout-check, weekly review) send
// to. Any internal account may call this, and the shared demo account is one
// of them (anyone can mint a demo session via demo-login), so a free `to` made
// this an open relay from our domain (audit SEC-23-2, 2026-09-24).
export const ALLOWED_RECIPIENTS = ["ozgurdogan@gmail.com"];

// True when every requested recipient is on the allowlist (case-insensitive).
// A string or a non-empty array of strings; anything else is refused.
export function recipientsAllowed(
  to: unknown,
  allowed: string[] = ALLOWED_RECIPIENTS,
): boolean {
  const list = Array.isArray(to) ? to : [to];
  if (list.length === 0) return false;
  const ok = new Set(allowed.map((a) => a.toLowerCase()));
  return list.every((r) => typeof r === "string" && ok.has(r.trim().toLowerCase()));
}

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

// Build the outgoing email fields (provider-agnostic).
export function buildEmailFields(
  to: unknown,
  subject: unknown,
  html: unknown,
  from: string = FROM_EMAIL,
): { from: string; to: unknown; subject: unknown; html: unknown } {
  return { from, to, subject, html };
}
