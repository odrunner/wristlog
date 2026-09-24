// Supabase API keys for edge functions — pure resolution (no Deno), tested in
// keys-lib.test.ts. Audit 2026-09-23 SEC-23-5: the legacy service_role JWT
// leaked in the public repo and can only be retired by deactivating the legacy
// keys project-wide, so functions read the new sb_secret_/sb_publishable_ keys
// (SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS, JSON by key name) and fall
// back to the legacy env var only if the new one is absent.

export function pickKey(namedKeysJson: string | undefined, legacy: string | undefined, name = "default"): string {
  if (namedKeysJson) {
    try {
      const k = JSON.parse(namedKeysJson)?.[name];
      if (typeof k === "string" && k) return k;
    } catch { /* malformed → legacy */ }
  }
  return legacy ?? "";
}
