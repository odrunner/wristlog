import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  buildWatchDesc,
  extractJson,
  isCacheFresh,
  isInRateWindow,
  mergePriceHistory,
  roundEstimate,
  salvageJson,
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

// Both fixtures below reproduce the two ways Gemini hit MAX_TOKENS on
// 2026-08-08 (2 of 22 lookups, each costing a Claude re-run). The head and tail
// are the real logged text; the middle is reconstructed, since the log only
// captured the first 200 and last 300 characters.
//
// Shape 1: thinking consumed 16,073 of the 16,384-token budget, so the answer
// was cut mid-string inside a data_points URL.
const TRUNCATED_MID_STRING = `\`\`\`json
{
  "estimated_value_usd": {
    "low": 31700,
    "mid": 36500,
    "high": 40990
  },
  "retail_price_usd": null,
  "currency_note": "all values in USD",
  "data_points": [
    {
      "source": "eBay",
      "price_usd": 40990,
      "condition": "New and Unused, 2025",
      "url": "https://www.ebay.com/itm/2026-Vacheron-Constantin-Overseas-Automatic-Boutique-Exclusive-4520V-210A-B128-/204680126471"
    },
    {
      "source": "eBay",
      "price_usd": 31700,
      "condition": "Pre-Owned, Stainless Steel Blue Dial",
      "url": "https://www.`;

// Shape 2: the answer degenerated into a repetition loop and burned 22,055
// output tokens emitting "0" until the cap.
const RUNAWAY_REPETITION = `\`\`\`json
{
  "estimated_value_usd": {
    "low": 9300,
    "mid": 9900,
    "high": 10500
  },
  "retail_price_usd": 8350,
  "currency_note": "all values in USD",
  "data_points": [
    {
      "source": "Chrono24",
      "price_usd": 9950,
      "condition": "Pre-owned, box and papers",
      "url": "https://www.chrono24.com/listing/1234567"
    },
    {
      "source": "eBay",
      "price_usd": 93${"0".repeat(5000)}`;

Deno.test("salvageJson — recovers the estimate from output cut mid-string", () => {
  const out = salvageJson(TRUNCATED_MID_STRING);
  assertEquals(out?.estimated_value_usd, { low: 31700, mid: 36500, high: 40990 });
  assertEquals(out?.retail_price_usd, null);
});

Deno.test("salvageJson — recovers the estimate from a repetition-loop tail", () => {
  const out = salvageJson(RUNAWAY_REPETITION);
  assertEquals(out?.estimated_value_usd, { low: 9300, mid: 9900, high: 10500 });
  assertEquals(out?.retail_price_usd, 8350);
  // The runaway number and the object holding it are dropped; the complete
  // data point before it survives.
  const points = out?.data_points as { source: string }[];
  assertEquals(points[0].source, "Chrono24");
});

Deno.test("salvageJson — keeps data points that were already complete", () => {
  const out = salvageJson(TRUNCATED_MID_STRING);
  const points = out?.data_points as { source: string; price_usd: number; url?: string }[];
  assertEquals(points[0].price_usd, 40990);
  assertEquals(points[0].url?.startsWith("https://www.ebay.com/"), true);
});

Deno.test("salvageJson — null when the estimate itself never completed", () => {
  // Truncated before estimated_value_usd closes: nothing worth serving.
  assertEquals(salvageJson('```json\n{\n  "estimated_value_usd": {\n    "low": 31'), null);
});

// index.ts gates salvage on roundEstimate(mid) — a range with no mid renders
// "N/A" in the UI, so it must fall through to Claude instead of being served.
Deno.test("salvageJson — a mid-less range is rejected by the roundEstimate gate", () => {
  const out = salvageJson('{"estimated_value_usd":{"low":31700,');
  assertEquals(out?.estimated_value_usd, { low: 31700 });
  const est = out?.estimated_value_usd as Record<string, unknown>;
  assertEquals(roundEstimate(est.mid), null);
});

Deno.test("salvageJson — both real 2026-08-08 failures clear the roundEstimate gate", () => {
  for (const raw of [TRUNCATED_MID_STRING, RUNAWAY_REPETITION]) {
    const est = salvageJson(raw)?.estimated_value_usd as Record<string, unknown>;
    assertEquals(roundEstimate(est.mid) !== null, true);
  }
});

Deno.test("salvageJson — null when there is no object at all", () => {
  assertEquals(salvageJson("I could not find pricing for this watch."), null);
  assertEquals(salvageJson(""), null);
});

Deno.test("salvageJson — commas and braces inside strings are not cut points", () => {
  const out = salvageJson('{"notes":"Prices vary, {a lot}, by dealer","confidence":"lo');
  assertEquals(out?.notes, "Prices vary, {a lot}, by dealer");
});

Deno.test("salvageJson — escaped quotes inside strings do not end the string early", () => {
  const out = salvageJson('{"notes":"the \\"Hulk\\" ref, sold out","confidence":"me');
  assertEquals(out?.notes, 'the "Hulk" ref, sold out');
});

Deno.test("salvageJson — complete object followed by trailing garbage still parses", () => {
  // extractJson's greedy {...} match swallows the trailing brace and throws;
  // salvage should return the first complete object.
  const out = salvageJson('```json\n{"estimated_value_usd":{"mid":500}}\n```\nextra {');
  assertEquals(out, { estimated_value_usd: { mid: 500 } });
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
