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
export function resolveIp(headerGet: (name: string) => string | null): string {
  return headerGet("x-forwarded-for")?.split(",")[0]?.trim()
    || headerGet("cf-connecting-ip")
    || "unknown";
}

// Rate-limit row key for an IP.
export function rateKey(ip: string): string {
  return `demo-login:${ip}`;
}

export type { RateRow };
