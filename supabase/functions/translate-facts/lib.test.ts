import { assertEquals } from "jsr:@std/assert";
import { batchFields, chunk, mergeAnswers, mergeModelAnswers, missingLangs, modelBatchFields, modelMissingLangs } from "./lib.ts";
import type { FactRow, ModelRow } from "./lib.ts";
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

// ── model pages ──
const models: ModelRow[] = [
  { id: "m0", description: "A dive watch.", history: "Born in 1953.", translations: {}, translate_attempts: 0 },
  { id: "m1", description: null, history: "Only a history.", translations: { es: { history: "Solo una historia." }, it: { history: " " } }, translate_attempts: 0 },
  { id: "m2", description: "D", history: "H", translations: { es: { description: "D-es" } }, translate_attempts: 0 },
];

Deno.test("modelMissingLangs — a language is done only when every English field has a translation", () => {
  assertEquals(modelMissingLangs(models[0]).length, 6);
  assertEquals(modelMissingLangs(models[1]).includes("es"), false);   // no English description to wait for
  assertEquals(modelMissingLangs(models[1]).includes("it"), true);    // blank counts as missing
  assertEquals(modelMissingLangs(models[2]).includes("es"), true);    // history still missing
});

Deno.test("modelBatchFields — asks only for models lacking the language, keyed by position and field", () => {
  assertEquals(modelBatchFields(models, "es"), { m0_description: "A dive watch.", m0_history: "Born in 1953.", m2_description: "D", m2_history: "H" });
  assertEquals(Object.keys(modelBatchFields(models, "de")), ["m0_description", "m0_history", "m1_history", "m2_description", "m2_history"]);
});

Deno.test("mergeModelAnswers — stores a language only when it came back whole, keeps what was there", () => {
  const answers = new Map<OtherLang, Fields>([
    ["de", { m0_description: " Eine Taucheruhr. ", m0_history: "1953 geboren.", m1_history: "Nur Geschichte.", m2_description: "D-de" }],
  ]);
  const out = mergeModelAnswers(models, answers);
  assertEquals(out.map((m) => m.id), ["m0", "m1"]);                     // m2 lacks its history: nothing stored
  assertEquals(out[0].translations.de, { description: "Eine Taucheruhr.", history: "1953 geboren." });
  assertEquals(out[1].translations.de, { history: "Nur Geschichte." });
  assertEquals(out[1].translations.es, { history: "Solo una historia." });
});
