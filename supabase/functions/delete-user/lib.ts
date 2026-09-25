// delete-user — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.
//
// NOTE: This function is almost entirely IO — it authenticates a user via the
// Supabase client and calls the admin delete API. The only request-shaping logic
// that is pure is the presence check on the Authorization header.

// True if the request carried an Authorization header value.
export function hasAuthHeader(authHeader: string | null | undefined): boolean {
  return !!authHeader;
}

// Shared accounts that must never be deleted through this endpoint. The demo
// account is signed into by anyone ("Explore Without an Account" → demo-login),
// so without this any visitor could delete it — and its showcase data — for
// everyone (audit SEC-23-18). There are no backups to restore it from.
export const UNDELETABLE_EMAILS = ["demo@wrotate.com"];

export function isUndeletable(email: string | null | undefined): boolean {
  return !!email && UNDELETABLE_EMAILS.includes(email.trim().toLowerCase());
}
