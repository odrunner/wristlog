import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  buildWatchDesc,
  claudeAnswerText,
  describeEmptyAnswer,
  extractJson,
  geminiAttemptTimeouts,
  isCacheFresh,
  pickReplay,
  queryKey,
  roundEstimate,
  salvageJson,
  shouldRetryWithoutRef,
  utcDayStartIso,
} from "./lib.ts";

// A hung Gemini call during a batch price refresh gets one shorter retry
// before the ~100x costlier Claude fallback (2 of 40 batch lookups hit the
// 35s abort on 2026-10-12; their neighbors all answered in 10-30s, so a
// hang is a per-request fluke a fresh call recovers from). Interactive
// sources keep the single fast attempt — a person is waiting on that row.
Deno.test("geminiAttemptTimeouts — update-prices gets a second, shorter attempt", () => {
  assertEquals(geminiAttemptTimeouts("update-prices"), [35000, 20000]);
});

Deno.test("geminiAttemptTimeouts — interactive sources get a single attempt", () => {
  assertEquals(geminiAttemptTimeouts("single"), [35000]);
  assertEquals(geminiAttemptTimeouts("add-flow"), [35000]);
  assertEquals(geminiAttemptTimeouts(""), [35000]);
});

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

// Shape of the 2026-11-13 Tissot failure: finish=STOP, no parts, search ran.
Deno.test("describeEmptyAnswer — keeps reason fields and search shape, not page text", () => {
  const out = JSON.parse(describeEmptyAnswer({
    candidates: [{
      finishReason: "STOP",
      finishMessage: "why",
      content: { role: "model" },
      safetyRatings: [
        { category: "HARM_CATEGORY_HARASSMENT", probability: "NEGLIGIBLE" },
        { category: "HARM_CATEGORY_DANGEROUS", probability: "LOW", blocked: true },
      ],
      groundingMetadata: {
        webSearchQueries: ["Tissot T120.407.22.041.00 price"],
        groundingChunks: [{ web: { uri: "https://x", title: "long page text" } }, {}],
      },
    }],
    promptFeedback: { blockReason: "OTHER" },
    modelVersion: "gemini-2.5-flash",
  }));
  assertEquals(out.candidates, 1);
  assertEquals(out.candidateKeys, ["finishReason", "finishMessage", "content", "safetyRatings", "groundingMetadata"]);
  assertEquals(out.finishMessage, "why");
  assertEquals(out.contentKeys, ["role"]);
  assertEquals(out.role, "model");
  assertEquals(out.promptFeedback, { blockReason: "OTHER" });
  assertEquals(out.safetyFlagged.length, 1);
  assertEquals(out.searchQueries, ["Tissot T120.407.22.041.00 price"]);
  assertEquals(out.groundingChunks, 2);
  assertEquals(out.groundingKeys, ["webSearchQueries", "groundingChunks"]);
  assertEquals(out.modelVersion, "gemini-2.5-flash");
});

Deno.test("describeEmptyAnswer — tolerates a missing or empty response", () => {
  const out = JSON.parse(describeEmptyAnswer(undefined));
  assertEquals(out.candidates, 0);
  assertEquals(out.candidateKeys, []);
  assertEquals(out.contentKeys, null);
  assertEquals(out.searchQueries, null);
  assertEquals(out.groundingChunks, null);
  assertEquals(JSON.parse(describeEmptyAnswer({ candidates: [{ content: null }] })).contentKeys, null);
});

Deno.test("describeEmptyAnswer — caps the length", () => {
  const out = describeEmptyAnswer({ promptFeedback: { x: "a".repeat(5000) } }, 100);
  assertEquals(out.length, 101);
  assertEquals(out.endsWith("…"), true);
});

// The 2026-11-14 Tissot shape: searched, zero sources, no text.
const NO_SOURCES = { candidates: [{ finishReason: "STOP", content: { role: "model" }, groundingMetadata: { webSearchQueries: ["q"] } }] };

Deno.test("shouldRetryWithoutRef — empty answer, no sources, has a reference → retry", () => {
  assertEquals(shouldRetryWithoutRef(NO_SOURCES, "", "T120.407.22.041.00"), true);
  assertEquals(shouldRetryWithoutRef({ candidates: [{ groundingMetadata: { groundingChunks: [] } }] }, "  ", "T120"), true);
  assertEquals(shouldRetryWithoutRef({ candidates: [{}] }, "", "T120"), true);
  assertEquals(shouldRetryWithoutRef(undefined, "", "T120"), true);
});

Deno.test("shouldRetryWithoutRef — no reference to drop → no retry", () => {
  assertEquals(shouldRetryWithoutRef(NO_SOURCES, "", ""), false);
  assertEquals(shouldRetryWithoutRef(NO_SOURCES, "", "   "), false);
});

Deno.test("shouldRetryWithoutRef — Gemini wrote text → no retry (parse/salvage problem, not a search miss)", () => {
  assertEquals(shouldRetryWithoutRef(NO_SOURCES, "I could not find pricing.", "T120"), false);
});

Deno.test("shouldRetryWithoutRef — empty answer that DID find sources → no retry", () => {
  const withSources = { candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://x" } }] } }] };
  assertEquals(shouldRetryWithoutRef(withSources, "", "T120"), false);
});

// A retried lookup replays the answer that was computed and never delivered
// (2026-11-16: 8 of 10 batch answers lost when the page left the foreground).
const RQ = { brand: "Omega", model: "Seamaster 42", reference: "210.30.42.20.04.001", condition: "good", year: "" };
const RR = { estimated_value_usd: { low: 4200, mid: 4850, high: 5500 }, confidence: "high" };
const T0 = Date.parse("2026-11-16T03:25:44Z");
const rowAt = (ms: number, over: Record<string, unknown> = {}) => ({
  query: RQ, result: RR, created_at: new Date(ms).toISOString(), ...over,
});

Deno.test("pickReplay — same question moments ago is replayed", () => {
  assertEquals(pickReplay(rowAt(T0), RQ, T0 + 27_000), RR);
});

Deno.test("pickReplay — undefined and empty fields are the same question", () => {
  assertEquals(pickReplay(rowAt(T0), { brand: "Omega", model: "Seamaster 42", reference: "210.30.42.20.04.001", condition: "good" }, T0 + 1000), RR);
  assertEquals(queryKey({ brand: "A" }), queryKey({ brand: "A", model: "", reference: "", condition: "", year: "" }));
});

Deno.test("pickReplay — an old row, a future row or no row runs a real lookup", () => {
  assertEquals(pickReplay(rowAt(T0), RQ, T0 + 15 * 60 * 1000), null);
  assertEquals(pickReplay(rowAt(T0), RQ, T0 - 1), null);
  assertEquals(pickReplay(null, RQ, T0), null);
  assertEquals(pickReplay(undefined, RQ, T0), null);
  assertEquals(pickReplay(rowAt(T0, { created_at: null }), RQ, T0), null);
  assertEquals(pickReplay(rowAt(T0, { created_at: "not a date" }), RQ, T0), null);
});

Deno.test("pickReplay — a changed question is never answered from the old one", () => {
  assertEquals(pickReplay(rowAt(T0), { ...RQ, reference: "210.30.42.20.03.001" }, T0 + 1000), null);
  assertEquals(pickReplay(rowAt(T0), { ...RQ, condition: "new" }, T0 + 1000), null);
  assertEquals(pickReplay(rowAt(T0), { ...RQ, year: 2021 }, T0 + 1000), null);
  assertEquals(pickReplay(rowAt(T0, { query: null }), RQ, T0 + 1000), null);
});

Deno.test("pickReplay — a stored answer without a usable mid is not replayed", () => {
  assertEquals(pickReplay(rowAt(T0, { result: { estimated_value_usd: { low: 1 } } }), RQ, T0 + 1000), null);
  assertEquals(pickReplay(rowAt(T0, { result: {} }), RQ, T0 + 1000), null);
  assertEquals(pickReplay(rowAt(T0, { result: "x" }), RQ, T0 + 1000), null);
  assertEquals(pickReplay(rowAt(T0, { result: null }), RQ, T0 + 1000), null);
});

// Claude with web search answers in several text blocks: a note before it
// searches, then the answer, itself split wherever a citation attaches. Reading
// only the first block lost the price twice (2026-11-13 "…Let me search more
// specifically.", 2026-11-17 "Based on my research, here is what I found…"):
// Claude was paid for and the member got an error.
Deno.test("claudeAnswerText joins every text block so the JSON after a preamble is found", () => {
  const content = [
    { type: "text", text: "The searches returned no results. Let me search more specifically." },
    { type: "server_tool_use", id: "x", name: "web_search", input: { query: "q" } },
    { type: "web_search_tool_result", tool_use_id: "x", content: [] },
    { type: "text", text: 'Based on my research:\n\n{"estimated_value_usd": {"low": 50, ' },
    { type: "text", text: '"mid": 75, "high": 100}, ', citations: [{ url: "https://example.com" }] },
    { type: "text", text: '"confidence": "medium"}' },
  ];
  const text = claudeAnswerText(content);
  assertEquals(extractJson(text), {
    estimated_value_usd: { low: 50, mid: 75, high: 100 },
    confidence: "medium",
  });
});

Deno.test("claudeAnswerText returns a single text block unchanged", () => {
  assertEquals(claudeAnswerText([{ type: "text", text: '{"a":1}' }]), '{"a":1}');
});

Deno.test("claudeAnswerText is empty for missing or text-less content", () => {
  assertEquals(claudeAnswerText(undefined), "");
  assertEquals(claudeAnswerText(null), "");
  assertEquals(claudeAnswerText("nope"), "");
  assertEquals(claudeAnswerText([{ type: "server_tool_use" }, { type: "text" }, null]), "");
});
