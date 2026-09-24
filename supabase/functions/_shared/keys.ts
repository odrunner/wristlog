// Edge-function access to the project's API keys. See keys-lib.ts.
import { pickKey } from "./keys-lib.ts";

/** Secret key (bypasses RLS) — server-side only. */
export function serviceKey(): string {
  return pickKey(Deno.env.get("SUPABASE_SECRET_KEYS"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
}

/** Publishable key (RLS applies) — for user-scoped clients. */
export function publishableKey(): string {
  return pickKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"), Deno.env.get("SUPABASE_ANON_KEY"));
}
