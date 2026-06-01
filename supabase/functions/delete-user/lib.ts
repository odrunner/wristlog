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
