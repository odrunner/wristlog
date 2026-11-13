import { assertEquals } from "jsr:@std/assert";
import { batchFields, chunk, mergeAnswers, missingLangs } from "./lib.ts";
import type { FactRow } from "./lib.ts";
import type { Fields, OtherLang } from "../_shared/translate-lib.ts";

const rows: FactRow[] = [
  { id: "a", fact: "Fact A.", translations: {}, translate_attempts: 0 },
  { id: "b", fact: "Fact B.", translations: { es: "Dato B.", it: " " }, translate_attempts: 1 },
  { id: "c", fact: "Fact C.", translations: null, translate_attempts: 0 },
];

Deno.test("missingLangs — a blank translation counts as missing", () => {
  assertEquals(missingLangs(rows[0]), ["es", "it", "fr", "tr", "de", "pt"]);
  assertEquals(missingLangs(rows[1]), ["it", "fr", "tr", "de", "pt"]);
  assertEquals(missingLangs({ ...rows[0], translations: { es: "a", it: "a", fr: "a", tr: "a", de: "a", pt: "a" } }), []);
});

Deno.test("batchFields — only the facts that lack that language, keyed by position", () => {
  assertEquals(batchFields(rows, "es"), { f0: "Fact A.", f2: "Fact C." });
  assertEquals(batchFields(rows, "it"), { f0: "Fact A.", f1: "Fact B.", f2: "Fact C." });
});

Deno.test("mergeAnswers — keeps what was there, adds what came back, skips rows that gained nothing", () => {
  const answers = new Map<OtherLang, Fields>([
    ["es", { f0: "Dato A.", f2: "" }],
    ["it", { f0: "Fatto A.", f1: "Fatto B." }],
  ]);
  assertEquals(mergeAnswers(rows, answers), [
    { id: "a", translations: { es: "Dato A.", it: "Fatto A." } },
    { id: "b", translations: { es: "Dato B.", it: "Fatto B." } },
  ]);
  assertEquals(mergeAnswers(rows, new Map()), []);
});

Deno.test("chunk", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 3), []);
});
