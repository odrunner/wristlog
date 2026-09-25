// demo-login — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// ISO timestamp marking the start of the current rate-limit window.
export function windowStartIso(nowMs: number): string {
  return new Date(nowMs - RATE_WINDOW_MS).toISOString();
}

type RateRow = { request_count: number; window_start: string } | null | undefined;

// True if a stored rate-limit row is still inside the current window
// (its window_start is more recent than the window cutoff).
export function isWithinWindow(rl: RateRow, windowStartIso: string): boolean {
  return !!rl && rl.window_start > windowStartIso;
}

// True if the caller is over the limit: in-window AND at/above RATE_LIMIT.
export function isRateLimited(rl: RateRow, windowStartIso: string, limit = RATE_LIMIT): boolean {
  return isWithinWindow(rl, windowStartIso) && (rl as { request_count: number }).request_count >= limit;
}

// Resolve the client IP from forwarding headers, falling back to "unknown".
// `headerGet` mirrors Headers.get (returns string | null).
// cf-connecting-ip first: Cloudflare sets it to the real client, while the
// first x-forwarded-for entry is whatever the caller wrote (audit SEC-23-18).
export function resolveIp(headerGet: (name: string) => string | null): string {
  return headerGet("cf-connecting-ip")?.trim()
    || headerGet("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

// All demo sign-ins come from this function's own IP, and Supabase Auth caps
// password sign-ins per IP — so one caller hammering the button could lock
// every visitor out. A global cap below that keeps the demo answering "busy"
// instead. Real peak: 12 logins in 5 minutes (2026-09-25).
export const GLOBAL_LIMIT = 25;
export const GLOBAL_WINDOW_MS = 5 * 60 * 1000;
export const GLOBAL_KEY = "demo-login:all";

// Rate-limit row key for an IP.
export function rateKey(ip: string): string {
  return `demo-login:${ip}`;
}

// Stable salt so the same IP always hashes to the same value (distinct-IP
// counting), while no raw IP is ever stored. Not a secret — just prevents
// trivial reversal of the small IPv4 space.
const IP_HASH_SALT = "wrotate-demo-views-v1";

// SHA-256 hash of a salted IP, hex-encoded. Returns null for an unknown IP so
// it doesn't collapse into a bogus "unique" bucket. crypto.subtle is a web
// standard available in Deno, so this stays unit-testable.
export async function hashIp(ip: string): Promise<string | null> {
  if (!ip || ip === "unknown") return null;
  const data = new TextEncoder().encode(`${IP_HASH_SALT}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type { RateRow };
