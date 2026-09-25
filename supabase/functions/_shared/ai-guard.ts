// Cost guards for the paid AI endpoints (identify-watch, watch-value) — pure,
// tested in ai-guard.test.ts. Audit 2026-09-23 SEC-23-18: request fields went
// into prompts unbounded, and the shared demo account (anyone can enter it via
// "Explore Without an Account") carried a full per-account AI allowance.

export const DEMO_EMAIL = "demo@wrotate.com";

export function isDemoUser(user: { email?: string | null } | null | undefined): boolean {
  return (user?.email ?? "").trim().toLowerCase() === DEMO_EMAIL;
}

/** String, trimmed to `max` characters; non-strings become "". */
export function clampText(v: unknown, max = 120): string {
  return typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v).slice(0, max) : "";
}

/** The owned-watch list sent with an identify request: at most `maxItems`
 *  (largest real collection 98 on 2026-09-25), each field clamped. */
export function sanitizeCollection(c: unknown, maxItems = 300): { brand: string; name: string; ref: string }[] {
  if (!Array.isArray(c)) return [];
  return c.slice(0, maxItems).map((w) => ({
    brand: clampText(w?.brand), name: clampText(w?.name), ref: clampText(w?.ref, 60),
  }));
}

/** True when a JSON-able value serialises longer than `maxChars`. */
export function oversized(value: unknown, maxChars: number): boolean {
  if (value === undefined || value === null) return false;
  try { return JSON.stringify(value).length > maxChars; } catch { return true; }
}
