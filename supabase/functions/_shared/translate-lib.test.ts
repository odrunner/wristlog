import { assertEquals } from "jsr:@std/assert";
import {
  buildTranslatePrompt, freshTranslation, OTHER_LANGS, parseModelJson, srcHash, tagsOf, tokensOf, validateTranslation,
} from "./translate-lib.ts";

const SRC = {
  subject: "A fun fact about {{watchPhrase}}",
  body: 'Hi {{name}},<br><br>Tap <b>Share</b> on the <a href="https://wrotate.com/open">Collection</a> tab. [img1]',
};
const GOOD = {
  subject: "Un dato curioso sobre {{watchPhrase}}",
  body: 'Hola {{name}},<br><br>Toca <b>Compartir</b> en la pestaña <a href="https://wrotate.com/open">Colección</a>. [img1]',
};

Deno.test("validateTranslation — accepts a translation that changed only the words", () => {
  assertEquals(validateTranslation(SRC, GOOD), GOOD);
});

Deno.test("validateTranslation — rejects anything that touched structure", () => {
  const bad = (patch: Record<string, unknown>) => validateTranslation(SRC, { ...GOOD, ...patch });
  assertEquals(bad({ body: GOOD.body.replace("https://wrotate.com/open", "https://evil.example") }), null); // link rewritten
  assertEquals(bad({ body: GOOD.body.replace("<b>", "<strong>").replace("</b>", "</strong>") }), null);     // tag swapped
  assertEquals(bad({ body: GOOD.body.replace("<br><br>", "<br>") }), null);                                 // tag dropped
  assertEquals(bad({ body: GOOD.body.replace("{{name}}", "{{nombre}}") }), null);                            // token renamed
  assertEquals(bad({ body: GOOD.body.replace(" [img1]", "") }), null);                                       // image marker lost
  assertEquals(bad({ subject: "Un dato curioso sobre tu reloj" }), null);                                    // token dropped
  assertEquals(bad({ subject: "" }), null);                                                                  // emptied
  assertEquals(bad({ subject: 7 }), null);                                                                   // wrong type
  assertEquals(bad({ subject: GOOD.subject + " \u{1F389}" }), null);                                         // emoji added
  assertEquals(bad({ body: GOOD.body + " x".repeat(400) }), null);                                           // runaway
  assertEquals(validateTranslation(SRC, { subject: GOOD.subject }), null);                                   // key missing
  assertEquals(validateTranslation(SRC, null), null);
  assertEquals(validateTranslation(SRC, [GOOD]), null);
});

Deno.test("validateTranslation — extra keys are dropped; an empty source may stay empty", () => {
  assertEquals(validateTranslation({ a: "" }, { a: "", note: "x" }), { a: "" });
});

Deno.test("tagsOf / tokensOf", () => {
  assertEquals(tagsOf(SRC.body), ["<br>", "<br>", "<b>", "</b>", '<a href="https://wrotate.com/open">', "</a>"]);
  assertEquals(tokensOf("{{ name }} [img2] {{fact}} [img1]"), ["[img1]", "[img2]", "{{fact}}", "{{name}}"]);
  assertEquals(tagsOf("plain"), []);
});

Deno.test("parseModelJson — plain, fenced, wrapped in prose, or nothing", () => {
  assertEquals(parseModelJson('{"a":"b"}'), { a: "b" });
  assertEquals(parseModelJson('```json\n{"a":"b"}\n```'), { a: "b" });
  assertEquals(parseModelJson('Here you go: {"a":"b"} done'), { a: "b" });
  assertEquals(parseModelJson("no json"), null);
  assertEquals(parseModelJson("{broken"), null);
  assertEquals(parseModelJson(""), null);
});

Deno.test("srcHash / freshTranslation — a stored translation is used only for the English it was made from", () => {
  const h = srcHash(SRC);
  assertEquals(h, srcHash({ body: SRC.body, subject: SRC.subject })); // key order does not matter
  assertEquals(h === srcHash({ ...SRC, subject: SRC.subject + "!" }), false);
  const stored = { es: { src: h, ...GOOD } };
  assertEquals(freshTranslation(stored, "es", SRC), GOOD);
  assertEquals(freshTranslation(stored, "it", SRC), null);                                  // never translated
  assertEquals(freshTranslation(stored, "es", { ...SRC, subject: "Edited" }), null);        // English changed
  assertEquals(freshTranslation({ es: { src: h, subject: GOOD.subject } }, "es", SRC), null); // field missing
  assertEquals(freshTranslation(null, "es", SRC), null);
  assertEquals(freshTranslation({ es: "x" }, "es", SRC), null);
});

Deno.test("buildTranslatePrompt — names the language, the glossary and carries the text", () => {
  for (const lang of OTHER_LANGS) {
    const p = buildTranslatePrompt(SRC, lang);
    assertEquals(p.includes(JSON.stringify(SRC)), true);
    assertEquals(p.includes("timegrapher = "), true);
  }
  assertEquals(buildTranslatePrompt(SRC, "fr").includes("French, formal (vous)"), true);
  assertEquals(buildTranslatePrompt(SRC, "de").includes("Zeitwaage"), true);
});
