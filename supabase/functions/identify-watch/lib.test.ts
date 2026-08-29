import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  BRAND_CUES,
  buildClaudeFallbackPrompt,
  buildCollectionPrompt,
  buildEnhancePrompt,
  buildFactsPrompt,
  buildModelPrompt,
  COLD_PROMPT,
  detectMediaType,
  DETECT_PROMPT,
  extractJson,
  factModelKey,
  hasCollection,
  ownsFactModel,
  normalizeDetectCount,
  normalizeMode,
  stripDataUriPrefix,
} from "./lib.ts";

// ── extractJson ──
Deno.test("extractJson — parses embedded object", () => {
  assertEquals(extractJson('here {"watches": []} done'), { watches: [] });
});

Deno.test("extractJson — null when no object", () => {
  assertEquals(extractJson("nothing"), null);
});

Deno.test("extractJson — greedy match spans nested braces and multiline", () => {
  assertEquals(extractJson('x\n{"a":{"b":1}}\ny'), { a: { b: 1 } });
});

// ── normalizeMode ──
Deno.test("normalizeMode — recognized modes pass through", () => {
  assertEquals(normalizeMode("detect"), "detect");
  assertEquals(normalizeMode("enhance"), "enhance");
  assertEquals(normalizeMode("identify"), "identify");
});

Deno.test("normalizeMode — unknown/missing defaults to identify", () => {
  assertEquals(normalizeMode(undefined), "identify");
  assertEquals(normalizeMode(null), "identify");
  assertEquals(normalizeMode("garbage"), "identify");
  assertEquals(normalizeMode(""), "identify");
});

// ── hasCollection ──
Deno.test("hasCollection — true for non-empty array", () => {
  assertEquals(hasCollection([{ brand: "Rolex" }]), true);
});

Deno.test("hasCollection — false for empty/non-array", () => {
  assertEquals(hasCollection([]), false);
  assertEquals(hasCollection(null), false);
  assertEquals(hasCollection(undefined), false);
  assertEquals(hasCollection("nope"), false);
});

// ── stripDataUriPrefix ──
Deno.test("stripDataUriPrefix — removes png/jpeg data uri prefix", () => {
  assertEquals(stripDataUriPrefix("data:image/png;base64,ABC123"), "ABC123");
  assertEquals(stripDataUriPrefix("data:image/jpeg;base64,XYZ"), "XYZ");
});

Deno.test("stripDataUriPrefix — leaves raw base64 untouched", () => {
  assertEquals(stripDataUriPrefix("ABC123"), "ABC123");
});

// ── detectMediaType ──
Deno.test("detectMediaType — png vs jpeg", () => {
  assertEquals(detectMediaType("data:image/png;base64,AAA"), "image/png");
  assertEquals(detectMediaType("data:image/jpeg;base64,AAA"), "image/jpeg");
  assertEquals(detectMediaType("data:image/webp;base64,AAA"), "image/jpeg"); // anything non-png → jpeg
  assertEquals(detectMediaType("rawbase64"), "image/jpeg");
});

// ── normalizeDetectCount ──
Deno.test("normalizeDetectCount — uses explicit count when present", () => {
  assertEquals(normalizeDetectCount({ count: 3, watches: [{}, {}] }), 3);
});

Deno.test("normalizeDetectCount — falls back to watches length", () => {
  assertEquals(normalizeDetectCount({ watches: [{}, {}] }), 2);
});

Deno.test("normalizeDetectCount — zero when neither present", () => {
  assertEquals(normalizeDetectCount({}), 0);
});

Deno.test("normalizeDetectCount — count of 0 is respected (nullish, not falsy)", () => {
  assertEquals(normalizeDetectCount({ count: 0, watches: [{}, {}] }), 0);
});

// ── buildEnhancePrompt ──
Deno.test("buildEnhancePrompt — includes brand and model, omits reference line when absent", () => {
  const p = buildEnhancePrompt({ brand: "Omega", model: "Speedmaster" });
  assertStringIncludes(p, "Brand: Omega");
  assertStringIncludes(p, "Model: Speedmaster");
  assertEquals(p.includes("Reference:"), false);
});

Deno.test("buildEnhancePrompt — includes reference line when present", () => {
  const p = buildEnhancePrompt({ brand: "Rolex", model: "Submariner", reference: "126610LN" });
  assertStringIncludes(p, "Reference: 126610LN");
});

// ── buildCollectionPrompt ──
Deno.test("buildCollectionPrompt — lists owned watches with refs", () => {
  const p = buildCollectionPrompt([
    { brand: "Rolex", name: "Submariner", ref: "126610LN" },
    { brand: "Omega", name: "Speedmaster" },
  ]);
  assertStringIncludes(p, "Rolex Submariner (ref: 126610LN), Omega Speedmaster");
});

Deno.test("buildCollectionPrompt — empty collection still produces valid prompt", () => {
  const p = buildCollectionPrompt([]);
  assertStringIncludes(p, "The user owns: ");
  assertStringIncludes(p, '{"watches": []}');
});

// ── normalizeMode: facts ──
Deno.test("normalizeMode — recognizes facts mode", () => {
  assertEquals(normalizeMode("facts"), "facts");
});

// ── buildFactsPrompt ──
Deno.test("buildFactsPrompt — includes brand/model and asks for one distinct fact", () => {
  const p = buildFactsPrompt({ brand: "Omega", model: "Speedmaster" }, []);
  assertStringIncludes(p, "Omega");
  assertStringIncludes(p, "Speedmaster");
  assertStringIncludes(p, '"fact"');
});

Deno.test("buildFactsPrompt — lists existing facts to avoid repeating", () => {
  const p = buildFactsPrompt({ brand: "Rolex", model: "Submariner" }, [
    "It debuted in 1953.",
  ]);
  assertStringIncludes(p, "It debuted in 1953.");
  assertStringIncludes(p, "already been used");
});

// ── static prompts ──
Deno.test("DETECT_PROMPT — mentions bounding box JSON shape", () => {
  assertStringIncludes(DETECT_PROMPT, '{"count": N, "watches": [{"boundingBox": [x, y, w, h]}]}');
});

Deno.test("COLD_PROMPT — instructs verification via search", () => {
  assertStringIncludes(COLD_PROMPT, "use search to verify");
});

// Cold identify runs on an image the client has ALREADY cropped to one watch,
// so "where is the watch" has no meaningful answer — and boundingBox was the
// only field in the schema with no "or empty string" escape. Gemini responded
// by emitting `"boundingBox":` with no value, which is invalid JSON and cost a
// Claude Opus re-run (recurring 2026-07-29..08-25). Nothing reads the cold
// response's box; the crop boxes come from the separate detect call.
Deno.test("COLD_PROMPT — does not ask for a bounding box", () => {
  assertEquals(COLD_PROMPT.includes("boundingBox"), false);
});

Deno.test("buildClaudeFallbackPrompt — embeds the BRAND_CUES block", () => {
  const p = buildClaudeFallbackPrompt();
  assertStringIncludes(p, BRAND_CUES);
  assertStringIncludes(p, "GRØNE");
});

// ── Fun-fact ownership gate (2026-07-25 audit S3) ────────────────────────────
Deno.test("factModelKey — matches the SQL pool key exactly", () => {
  // sql/2026-07-20-watch-fun-facts.sql: lower(trim(brand)) || '|' || lower(trim(name))
  assertEquals(factModelKey("Rolex", "Submariner"), "rolex|submariner");
  assertEquals(factModelKey("  Rolex ", " Submariner  "), "rolex|submariner");
  assertEquals(factModelKey("ROLEX", "SUBMARINER"), "rolex|submariner");
  assertEquals(factModelKey("", ""), "|");
});

Deno.test("ownsFactModel — only generates for a watch the caller owns", () => {
  const owned = [
    { brand: "Rolex", name: "Submariner" },
    { brand: "Seiko", name: "SKX007" },
  ];
  assertEquals(ownsFactModel(owned, "Rolex", "Submariner"), true);
  assertEquals(ownsFactModel(owned, "Seiko", "SKX007"), true);
  // Case and whitespace insensitive, same as the pool key.
  assertEquals(ownsFactModel(owned, " rolex ", "SUBMARINER"), true);
  // Not owned — this is the abuse case the gate exists for.
  assertEquals(ownsFactModel(owned, "Patek Philippe", "Nautilus"), false);
  assertEquals(ownsFactModel(owned, "Rolex", "Daytona"), false);
  // Empty collection can never match.
  assertEquals(ownsFactModel([], "Rolex", "Submariner"), false);
});

Deno.test("ownsFactModel — tolerates null/missing fields without matching", () => {
  assertEquals(ownsFactModel([{ brand: null, name: null }], "Rolex", "Submariner"), false);
  assertEquals(ownsFactModel([{}], "Rolex", "Submariner"), false);
  // A watch with empty brand/name must not match an empty request either way round.
  assertEquals(ownsFactModel([{ brand: "", name: "" }], "Rolex", "Submariner"), false);
});


// ── buildModelPrompt (watch-database model page) ──
Deno.test("buildModelPrompt — names the family and lists aliases, refs and grounding", () => {
  const p = buildModelPrompt({
    brand: "Rolex", name: "Submariner",
    aliases: ["rolex submariner no date"], refs: ["5513", "124060"],
    grounding: { calibers: ["1520", "3230"], years: ["1962-1989"], diameters: ["40mm"], water_resistance: ["300m"] },
  });
  assertStringIncludes(p, "Brand: Rolex");
  assertStringIncludes(p, "Model family: Submariner");
  assertStringIncludes(p, "Also written as: rolex submariner no date");
  assertStringIncludes(p, "References owned by our members: 5513, 124060");
  assertStringIncludes(p, "Calibers members recorded: 1520, 3230");
  assertStringIncludes(p, "Water resistance members recorded: 300m");
  assertStringIncludes(p, '"refs_by_era"');
  assertStringIncludes(p, '"calibers_by_era"');
});

Deno.test("buildModelPrompt — omits alias/ref/grounding blocks when empty", () => {
  const p = buildModelPrompt({ brand: "Seiko", name: "5", aliases: [], refs: [], grounding: {} });
  assertEquals(p.includes("Also written as"), false);
  assertEquals(p.includes("References owned by our members"), false);
  assertEquals(p.includes("What our members' examples say"), false);
  assertStringIncludes(p, "Model family: 5");
});

Deno.test("normalizeMode — accepts model", () => {
  assertEquals(normalizeMode("model"), "model");
});
