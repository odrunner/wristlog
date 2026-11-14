import { assertEquals } from "jsr:@std/assert";
import {
  batchFields, chunk, EXTRAS_V, extraFields, hasWords, mergeAnswers, mergeModelAnswers, missingLangs, modelBatchFields,
  modelMissing, modelMissingLangs, modelSource, numbersKept,
} from "./lib.ts";
import type { FactRow, ModelRow } from "./lib.ts";
import { OTHER_LANGS } from "../_shared/translate-lib.ts";
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
// `done` = the marker a language carries once its spec values and reference notes are handled.
const done = { specs: {}, ref_notes: [], extras: EXTRAS_V };
const models: ModelRow[] = [
  { id: "m0", description: "A dive watch.", history: "Born in 1953.", translations: {}, translate_attempts: 0 },
  { id: "m1", description: null, history: "Only a history.", translations: { es: { history: "Solo una historia.", ...done }, it: { history: " " } }, translate_attempts: 0 },
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

Deno.test("mergeModelAnswers — stores the story only when it came back whole, keeps what was there", () => {
  const answers = new Map<OtherLang, Fields>([
    ["de", { m0_description: " Eine Taucheruhr. ", m0_history: "1953 geboren.", m1_history: "Nur Geschichte.", m2_description: "D-de" }],
  ]);
  const out = mergeModelAnswers(models, answers);
  assertEquals(out[0].translations.de, { description: "Eine Taucheruhr.", history: "1953 geboren.", ...done });
  assertEquals(out[1].translations.de, { history: "Nur Geschichte.", ...done });
  assertEquals(out[1].translations.es, { history: "Solo una historia.", ...done });
  // m2 lacks its history: no story stored, and what Spanish already had is kept
  assertEquals(out[2].translations.de, done);
  assertEquals(out[2].translations.es, { description: "D-es", ...done });
});

// ── model pages: spec values and reference notes ──
const story = { description: "Una reloj.", history: "Nació en 1957." };
const allStory = Object.fromEntries(OTHER_LANGS.map((l) => [l, { ...story }]));
// The shape of a real row: already "done" under the old check (story in every language).
const full: ModelRow = {
  id: "x0", description: "A watch.", history: "Born in 1957.",
  specs: {
    type: "Dive chronograph", size: "37.5mm–48mm", water_resistance: "10 bar (100m)/145 psi (328ft)",
    movement: "Automatic, ETA and in-house calibers", materials: "Stainless steel, titanium", lug_width: "A key the page does not show",
  },
  refs_by_era: [
    { reference: "807", years: "1957–c. 1962", note: "First Superocean chronograph with a manual-wind movement." },
    { reference: "2005", years: "c. 1964–1972" },
    { reference: "A13341", years: "2011–2016", note: "Known as the Steelfish, with a 44mm case." },
  ],
  translations: allStory, translate_attempts: 0,
};
const bare: ModelRow = { id: "x1", description: "D", history: "H", specs: { size: "40mm", water_resistance: "200m (660 ft)" }, refs_by_era: null, translations: allStory, translate_attempts: 0 };

Deno.test("hasWords — sizes and depths are never sent, prose is", () => {
  for (const v of ["40mm", "37.5mm–48mm", "200m (660 ft)", "10 bar (100m)/145 psi (328ft)", "28,800 vph", "5 ATM"]) assertEquals(hasWords(v), false, v);
  for (const v of ["Stainless steel", "Not Available", "100 metres / 330 feet", "Typically 34–38mm", "Up to 20 bar (200m)", "36mm (vintage), 40mm (modern)"]) assertEquals(hasWords(v), true, v);
});

Deno.test("extraFields — the spec values with words and every reference note, by position", () => {
  assertEquals(extraFields(full), {
    s_type: "Dive chronograph", s_movement: "Automatic, ETA and in-house calibers", s_materials: "Stainless steel, titanium",
    r0: "First Superocean chronograph with a manual-wind movement.", r2: "Known as the Steelfish, with a 44mm case.",
  });
  assertEquals(extraFields(bare), {});
  assertEquals(extraFields({ ...bare, specs: ["x"], refs_by_era: ["text", null, { note: 7 }, { note: " " }] }), {});
});

Deno.test("numbersKept — every number of the English is still there", () => {
  assertEquals(numbersKept("Known as the Steelfish, with a 44mm case.", "Bekannt als Steelfish, mit 44-mm-Gehäuse."), true);
  assertEquals(numbersKept("Runs at 28,800 vph, 37.5mm.", "Läuft mit 28.800 A/h, 37,5 mm."), true);
  assertEquals(numbersKept("Updated in 2011 and again in 2011.", "Actualizado en 2011."), false);     // one went missing
  assertEquals(numbersKept("A 38mm model.", "Un modelo de 39 mm."), false);
  assertEquals(numbersKept("A 20th century design from 1957.", "Un diseño del siglo XX de 1957."), true);  // ordinals are words elsewhere
  assertEquals(numbersKept("The first of its kind.", "Die 1. ihrer Art."), true);                          // extra numbers are fine
});

Deno.test("modelMissing — a model translated before the extras existed waits for the extras only", () => {
  assertEquals(modelMissing(full, "es"), { story: false, extras: true });
  assertEquals(modelMissingLangs(full).length, 6);
  assertEquals(modelMissing({ ...full, translations: { ...allStory, es: { ...story, ...done } } }, "es"), { story: false, extras: false });
  assertEquals(modelMissing({ ...full, translations: { ...allStory, es: { ...story, extras: EXTRAS_V - 1 } } }, "es").extras, true);  // an older version is made again
});

Deno.test("modelBatchFields — the backfill asks for the extras alone, never the story again", () => {
  assertEquals(modelBatchFields([full, bare], "fr"), {
    m0_s_type: "Dive chronograph", m0_s_movement: "Automatic, ETA and in-house calibers", m0_s_materials: "Stainless steel, titanium",
    m0_r0: "First Superocean chronograph with a manual-wind movement.", m0_r2: "Known as the Steelfish, with a 44mm case.",
  });
  // a new model asks for both parts at once
  assertEquals(Object.keys(modelBatchFields([{ ...full, translations: {} }], "fr")).slice(0, 3), ["m0_description", "m0_history", "m0_s_type"]);
});

Deno.test("mergeModelAnswers — extras are stored whole, notes line up with refs_by_era, the story is untouched", () => {
  const fr = {
    m0_s_type: "Chronographe de plongée", m0_s_movement: "Automatique, calibres ETA et maison", m0_s_materials: " Acier inoxydable, titane ",
    m0_r0: "Premier chronographe Superocean à remontage manuel.", m0_r2: "Connu sous le nom de Steelfish, avec un boîtier de 44 mm.",
  };
  const out = mergeModelAnswers([full, bare], new Map<OtherLang, Fields>([["fr", fr]]));
  assertEquals(out[0].translations.fr, {
    ...story,
    specs: { type: "Chronographe de plongée", movement: "Automatique, calibres ETA et maison", materials: "Acier inoxydable, titane" },
    ref_notes: ["Premier chronographe Superocean à remontage manuel.", null, "Connu sous le nom de Steelfish, avec un boîtier de 44 mm."],
    extras: EXTRAS_V,
  });
  assertEquals(out[0].translations.de, story);                 // no answer for German: left as it was, still waiting
  assertEquals(modelMissingLangs({ ...full, translations: out[0].translations }), ["es", "it", "tr", "de", "pt"]);
  // nothing to translate: marked done in every language without a call
  assertEquals(out[1].translations.de, { ...story, specs: {}, ref_notes: [], extras: EXTRAS_V });
  assertEquals(modelMissingLangs({ ...bare, translations: out[1].translations }), []);
});

Deno.test("mergeModelAnswers — a missing field or a changed number means no extras (English stays)", () => {
  const ok = {
    m0_s_type: "Cronógrafo de buceo", m0_s_movement: "Automático", m0_s_materials: "Acero",
    m0_r0: "Primer cronógrafo Superocean de cuerda manual.", m0_r2: "Conocido como Steelfish, con caja de 44 mm.",
  };
  const run = (es: Fields) => mergeModelAnswers([full], new Map<OtherLang, Fields>([["es", es]]));
  assertEquals(run(ok)[0].translations.es.extras, EXTRAS_V);
  assertEquals(run({ ...ok, m0_r2: "" }), []);
  assertEquals(run({ ...ok, m0_r2: "Conocido como Steelfish, con caja de 42 mm." }), []);
  const { m0_s_type: _t, ...short } = ok;
  assertEquals(run(short), []);
  assertEquals(mergeModelAnswers([full], new Map()), []);
});

Deno.test("modelSource — changes with any English the translations were made from", () => {
  const base = modelSource(full);
  assertEquals(modelSource({ ...full, translations: {}, translate_attempts: 2 }), base);                 // not part of the English
  assertEquals(modelSource({ ...full, specs: { ...(full.specs as object), size: "40mm" } }), base);      // a value that is never translated
  assertEquals(modelSource({ ...full, history: "Born in 1958." }) === base, false);
  assertEquals(modelSource({ ...full, specs: { ...(full.specs as object), materials: "Gold" } }) === base, false);
  const refs = full.refs_by_era as Record<string, string>[];
  assertEquals(modelSource({ ...full, refs_by_era: [refs[0], refs[2], refs[1]] }) === base, false);      // reordered
  assertEquals(modelSource({ ...full, refs_by_era: [...refs, { reference: "X", years: "2020" }] }) === base, false);  // one more, no note
});
