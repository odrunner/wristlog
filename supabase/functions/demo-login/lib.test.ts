import { assertEquals } from "jsr:@std/assert";
import {
  isRateLimited,
  isWithinWindow,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  rateKey,
  resolveIp,
  windowStartIso,
} from "./lib.ts";

// ---- constants ----
Deno.test("constants — limit 5, window 10 minutes", () => {
  assertEquals(RATE_LIMIT, 5);
  assertEquals(RATE_WINDOW_MS, 10 * 60 * 1000);
});

// ---- windowStartIso ----
Deno.test("windowStartIso — 10 minutes before now", () => {
  const now = Date.parse("2026-06-01T12:00:00Z");
  assertEquals(windowStartIso(now), "2026-06-01T11:50:00.000Z");
});

// ---- isWithinWindow ----
Deno.test("isWithinWindow — row newer than cutoff is in window", () => {
  assertEquals(isWithinWindow({ request_count: 1, window_start: "2026-06-01T11:55:00Z" }, "2026-06-01T11:50:00.000Z"), true);
});

Deno.test("isWithinWindow — row at/older than cutoff is out of window", () => {
  assertEquals(isWithinWindow({ request_count: 1, window_start: "2026-06-01T11:50:00.000Z" }, "2026-06-01T11:50:00.000Z"), false);
  assertEquals(isWithinWindow({ request_count: 1, window_start: "2026-06-01T11:45:00Z" }, "2026-06-01T11:50:00.000Z"), false);
});

Deno.test("isWithinWindow — null/undefined row is not in window", () => {
  assertEquals(isWithinWindow(null, "2026-06-01T11:50:00.000Z"), false);
  assertEquals(isWithinWindow(undefined, "2026-06-01T11:50:00.000Z"), false);
});

// ---- isRateLimited ----
Deno.test("isRateLimited — in-window and at limit is limited", () => {
  const cutoff = "2026-06-01T11:50:00.000Z";
  assertEquals(isRateLimited({ request_count: 5, window_start: "2026-06-01T11:55:00Z" }, cutoff), true);
  assertEquals(isRateLimited({ request_count: 6, window_start: "2026-06-01T11:55:00Z" }, cutoff), true);
});

Deno.test("isRateLimited — in-window but under limit is not limited", () => {
  const cutoff = "2026-06-01T11:50:00.000Z";
  assertEquals(isRateLimited({ request_count: 4, window_start: "2026-06-01T11:55:00Z" }, cutoff), false);
});

Deno.test("isRateLimited — out-of-window resets (not limited even at high count)", () => {
  const cutoff = "2026-06-01T11:50:00.000Z";
  assertEquals(isRateLimited({ request_count: 99, window_start: "2026-06-01T11:00:00Z" }, cutoff), false);
});

Deno.test("isRateLimited — no row is not limited", () => {
  assertEquals(isRateLimited(null, "2026-06-01T11:50:00.000Z"), false);
});

// ---- resolveIp ----
Deno.test("resolveIp — first entry of x-forwarded-for, trimmed", () => {
  const headers = new Map([["x-forwarded-for", "  1.2.3.4 , 5.6.7.8"]]);
  assertEquals(resolveIp((n) => headers.get(n) ?? null), "1.2.3.4");
});

Deno.test("resolveIp — falls back to cf-connecting-ip", () => {
  const headers = new Map([["cf-connecting-ip", "9.9.9.9"]]);
  assertEquals(resolveIp((n) => headers.get(n) ?? null), "9.9.9.9");
});

Deno.test("resolveIp — 'unknown' when no headers present", () => {
  assertEquals(resolveIp(() => null), "unknown");
});

// ---- rateKey ----
Deno.test("rateKey — namespaces the IP", () => {
  assertEquals(rateKey("1.2.3.4"), "demo-login:1.2.3.4");
});
