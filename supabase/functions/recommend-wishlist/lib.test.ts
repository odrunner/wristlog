import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  buildRecommendPrompt,
  parseRecommendResponse,
  sanitizeRecommendPayload,
} from "./lib.ts";

// ── sanitizeRecommendPayload ─────────────────────────────────────────────────

Deno.test("sanitize: non-object body yields empty payload", () => {
  assertEquals(sanitizeRecommendPayload(null), { collection: [], wishlist: [] });
  assertEquals(sanitizeRecommendPayload("x"), { collection: [], wishlist: [] });
  assertEquals(sanitizeRecommendPayload([]), { collection: [], wishlist: [] });
});

Deno.test("sanitize: clamps text fields and keeps known shape", () => {
  const out = sanitizeRecommendPayload({
    collection: [{
      brand: "A".repeat(200), name: "Speedmaster", ref: "310.30", tags: ["Chronograph", "Sport"],
      movement: "automatic", size: "42", wears90: 12, wearsTotal: 30,
      useCases: { work: 5, leisure: 7, dinner: 0, travel: 1, hacking: 9 },
    }],
    wishlist: [{ id: "w1", brand: "Tudor", name: "BB58", ref: "79030N", price: 3400, tags: ["Dive"] }],
  });
  assertEquals(out.collection.length, 1);
  const c = out.collection[0];
  assertEquals(c.brand.length, 120); // clamped
  assertEquals(c.tags, ["Chronograph", "Sport"]);
  assertEquals(c.movement, "automatic");
  assertEquals(c.size, "42");
  assertEquals(c.wears90, 12);
  assertEquals(c.wearsTotal, 30);
  assertEquals(c.useCases, { work: 5, leisure: 7, travel: 1 }); // zero + unknown keys dropped
  assertEquals(out.wishlist, [{ id: "w1", brand: "Tudor", name: "BB58", ref: "79030N", price: 3400, tags: ["Dive"] }]);
});

Deno.test("sanitize: caps list sizes (collection 300, wishlist 100)", () => {
  const out = sanitizeRecommendPayload({
    collection: Array.from({ length: 400 }, (_, i) => ({ brand: "B" + i, name: "N" })),
    wishlist: Array.from({ length: 150 }, (_, i) => ({ id: "id" + i, brand: "B", name: "N" })),
  });
  assertEquals(out.collection.length, 300);
  assertEquals(out.wishlist.length, 100);
});

Deno.test("sanitize: drops wishlist rows without id or name, junk wear counts become 0", () => {
  const out = sanitizeRecommendPayload({
    collection: [{ brand: "Seiko", name: "5", wears90: -3, wearsTotal: "junk", useCases: "nope", tags: "notarray" }],
    wishlist: [
      { id: "", brand: "Tudor", name: "BB58" },
      { id: "ok", brand: "", name: "" },
      { id: "w2", brand: "Omega", name: "", price: "notanumber" },
    ],
  });
  assertEquals(out.collection[0].wears90, 0);
  assertEquals(out.collection[0].wearsTotal, 0);
  assertEquals(out.collection[0].useCases, {});
  assertEquals(out.collection[0].tags, []);
  assertEquals(out.wishlist, [{ id: "w2", brand: "Omega", name: "", ref: "", price: null, tags: [] }]);
});

Deno.test("sanitize: tags capped at 6 entries of 30 chars", () => {
  const out = sanitizeRecommendPayload({
    collection: [{ brand: "X", name: "Y", tags: ["a".repeat(50), "b", "c", "d", "e", "f", "g", 3] }],
    wishlist: [],
  });
  assertEquals(out.collection[0].tags.length, 6);
  assertEquals(out.collection[0].tags[0].length, 30);
});

// ── buildRecommendPrompt ─────────────────────────────────────────────────────

const PAYLOAD = sanitizeRecommendPayload({
  collection: [{
    brand: "Omega", name: "Speedmaster", ref: "310.30", tags: ["Chronograph", "Sport"],
    movement: "automatic", size: "42", wears90: 12, wearsTotal: 30, useCases: { work: 5, leisure: 7 },
  }],
  wishlist: [
    { id: "w1", brand: "Tudor", name: "Black Bay 58", ref: "79030N", price: 3400, tags: ["Dive"] },
    { id: "w2", brand: "Cartier", name: "Tank", price: null, tags: ["Dress"] },
  ],
});

Deno.test("prompt: includes collection line with wear stats and use cases", () => {
  const p = buildRecommendPrompt(PAYLOAD);
  assertStringIncludes(p, "Omega Speedmaster");
  assertStringIncludes(p, "ref. 310.30");
  assertStringIncludes(p, "worn 12 of the last 90 days");
  assertStringIncludes(p, "30 all-time");
  assertStringIncludes(p, "work×5");
});

Deno.test("prompt: includes wishlist ids in brackets and prices when present", () => {
  const p = buildRecommendPrompt(PAYLOAD);
  assertStringIncludes(p, "[w1] Tudor Black Bay 58");
  assertStringIncludes(p, "$3400");
  assertStringIncludes(p, "[w2] Cartier Tank");
});

Deno.test("prompt: asks for JSON-only picks/summary response", () => {
  const p = buildRecommendPrompt(PAYLOAD);
  assertStringIncludes(p, "ONLY a JSON object");
  assertStringIncludes(p, '"picks"');
  assertStringIncludes(p, '"summary"');
});

Deno.test("prompt: empty collection gets the first-watch line", () => {
  const p = buildRecommendPrompt({ collection: [], wishlist: PAYLOAD.wishlist });
  assertStringIncludes(p, "first watch");
});

// ── parseRecommendResponse ───────────────────────────────────────────────────

const WISH_IDS = ["w1", "w2", "w3"];

Deno.test("parse: valid response filtered to known ids, order kept", () => {
  const out = parseRecommendResponse(
    'Here you go: {"picks":[{"id":"w2","reason":"Fills the dress gap"},{"id":"nope","reason":"x"},{"id":"w1","reason":"You wear divers"}],"summary":"Lacks a dress watch"}',
    WISH_IDS,
  );
  assertEquals(out, {
    picks: [{ id: "w2", reason: "Fills the dress gap" }, { id: "w1", reason: "You wear divers" }],
    summary: "Lacks a dress watch",
  });
});

Deno.test("parse: dedupes ids and caps at 3 picks", () => {
  const out = parseRecommendResponse(
    JSON.stringify({
      picks: [
        { id: "w1", reason: "a" }, { id: "w1", reason: "dup" },
        { id: "w2", reason: "b" }, { id: "w3", reason: "c" }, { id: "w2", reason: "d" },
      ],
    }),
    WISH_IDS,
  );
  assertEquals(out?.picks.map((p) => p.id), ["w1", "w2", "w3"]);
});

Deno.test("parse: clamps long reasons and summary, missing reason becomes empty", () => {
  const out = parseRecommendResponse(
    JSON.stringify({ picks: [{ id: "w1", reason: "r".repeat(500) }, { id: "w2" }], summary: "s".repeat(600) }),
    WISH_IDS,
  );
  assertEquals(out?.picks[0].reason.length, 200);
  assertEquals(out?.picks[1].reason, "");
  assertEquals(out?.summary.length, 300);
});

Deno.test("parse: no valid picks yields null", () => {
  assertEquals(parseRecommendResponse('{"picks":[{"id":"unknown","reason":"x"}]}', WISH_IDS), null);
  assertEquals(parseRecommendResponse('{"picks":[]}', WISH_IDS), null);
  assertEquals(parseRecommendResponse('{"summary":"no picks"}', WISH_IDS), null);
});

Deno.test("parse: malformed or non-JSON text yields null", () => {
  assertEquals(parseRecommendResponse("no json here", WISH_IDS), null);
  assertEquals(parseRecommendResponse('{"picks": [{"id": "w1", truncated', WISH_IDS), null);
});

Deno.test("parse: missing summary defaults to empty string", () => {
  const out = parseRecommendResponse('{"picks":[{"id":"w1","reason":"good"}]}', WISH_IDS);
  assertEquals(out?.summary, "");
});
