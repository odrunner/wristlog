import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  buildWatchDesc,
  extractJson,
  isCacheFresh,
  isInRateWindow,
  mergePriceHistory,
  roundEstimate,
  utcDayStartIso,
} from "./lib.ts";

const DAY = 24 * 60 * 60 * 1000;

Deno.test("extractJson — parses an embedded JSON object", () => {
  assertEquals(extractJson('prose {"a":1,"b":2} trailing'), { a: 1, b: 2 });
});

Deno.test("extractJson — returns null when no object present", () => {
  assertEquals(extractJson("no json here"), null);
});

Deno.test("extractJson — spans multiple lines", () => {
  assertEquals(extractJson('x\n{\n "v": 5\n}\ny'), { v: 5 });
});

// Both callers in index.ts must wrap this in try/catch: a truncated engine
// response (Gemini hitting maxOutputTokens, Claude hitting max_tokens) still
// matches the {...} regex but fails JSON.parse.
Deno.test("extractJson — throws on truncated JSON rather than returning null", () => {
  assertThrows(
    () => extractJson('```json\n{"estimated_value_usd":{"low":200},"data_points":[{"source":"eBay"}'),
    SyntaxError,
  );
});

Deno.test("buildWatchDesc — full set joins in order", () => {
  assertEquals(
    buildWatchDesc({ brand: "Rolex", model: "Submariner", reference: "126610LN", year: 2024, condition: "mint" }),
    "Rolex Submariner ref. 126610LN (2024) in mint condition",
  );
});

Deno.test("buildWatchDesc — omits missing parts (brand only)", () => {
  assertEquals(buildWatchDesc({ brand: "Omega" }), "Omega");
});

Deno.test("buildWatchDesc — partial set keeps order and labels", () => {
  assertEquals(
    buildWatchDesc({ brand: "Tudor", reference: "79030N" }),
    "Tudor ref. 79030N",
  );
});

Deno.test("isCacheFresh — fresh within 7 days", () => {
  const now = Date.parse("2026-06-01T00:00:00Z");
  assertEquals(isCacheFresh("2026-05-28T00:00:00Z", now), true);
});

Deno.test("isCacheFresh — boundary: under 7 days fresh, 7 days+ stale", () => {
  const now = Date.parse("2026-06-01T00:00:00Z");
  assertEquals(isCacheFresh("2026-05-25T00:00:01Z", now), true);  // 1s under 7 days → fresh
  assertEquals(isCacheFresh("2026-05-25T00:00:00Z", now), false); // exactly 7 days → stale (window is strict <)
  assertEquals(isCacheFresh("2026-05-24T00:00:00Z", now), false); // 8 days → stale
});

Deno.test("isCacheFresh — null/empty date is not fresh", () => {
  assertEquals(isCacheFresh(null, Date.now()), false);
  assertEquals(isCacheFresh(undefined, Date.now()), false);
});

Deno.test("isCacheFresh — future date is not treated as fresh (negative age)", () => {
  const now = Date.parse("2026-06-01T00:00:00Z");
  assertEquals(isCacheFresh("2026-06-05T00:00:00Z", now), false);
});

Deno.test("utcDayStartIso — truncates to start of UTC day", () => {
  const mid = Date.parse("2026-06-01T15:42:09Z");
  assertEquals(utcDayStartIso(mid), "2026-06-01T00:00:00.000Z");
});

Deno.test("isInRateWindow — true when window_start is within today", () => {
  assertEquals(isInRateWindow("2026-06-01T08:00:00Z", "2026-06-01T00:00:00.000Z"), true);
});

Deno.test("isInRateWindow — false for prior-day window or missing", () => {
  assertEquals(isInRateWindow("2026-05-31T23:00:00Z", "2026-06-01T00:00:00.000Z"), false);
  assertEquals(isInRateWindow(null, "2026-06-01T00:00:00.000Z"), false);
});

Deno.test("mergePriceHistory — appends new price and preserves prior as 'previous'", () => {
  const watch = { market_price: 9000, market_price_date: "2026-05-01", price_history: [] };
  const out = mergePriceHistory(watch, 9500, "2026-06-01");
  assertEquals(out, [
    { src: "previous", date: "2026-05-01", price: 9000 },
    { src: "WRotate", date: "2026-06-01", price: 9500 },
  ]);
});

Deno.test("mergePriceHistory — does not duplicate an already-recorded prior price", () => {
  const watch = {
    market_price: 9000,
    market_price_date: "2026-05-01",
    price_history: [{ src: "WRotate", date: "2026-05-01", price: 9000 }],
  };
  const out = mergePriceHistory(watch, 9500, "2026-06-01");
  assertEquals(out, [
    { src: "WRotate", date: "2026-05-01", price: 9000 },
    { src: "WRotate", date: "2026-06-01", price: 9500 },
  ]);
});

Deno.test("mergePriceHistory — no prior price just appends the new one", () => {
  const watch = { market_price: null, market_price_date: null, price_history: null };
  const out = mergePriceHistory(watch, 4200, "2026-06-01");
  assertEquals(out, [{ src: "WRotate", date: "2026-06-01", price: 4200 }]);
});

Deno.test("roundEstimate — rounds to nearest $50", () => {
  assertEquals(roundEstimate(4801.5), 4800);
  assertEquals(roundEstimate(4826), 4850);
  assertEquals(roundEstimate(9500), 9500);
  assertEquals(roundEstimate(337), 350);
});

Deno.test("roundEstimate — tiny values keep whole-dollar rounding instead of 0", () => {
  assertEquals(roundEstimate(12.4), 12);
  assertEquals(roundEstimate(24.9), 25);
  assertEquals(roundEstimate(30), 50);
});

Deno.test("roundEstimate — invalid input returns null", () => {
  assertEquals(roundEstimate(null), null);
  assertEquals(roundEstimate("n/a"), null);
  assertEquals(roundEstimate(-100), null);
  assertEquals(roundEstimate(0), null);
});
