import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { LANGS } from "./lang.ts";
import { SHARE_STRINGS } from "./share-strings.ts";

// Every leaf string as "path" -> text; a plural pair becomes path.0 / path.1.
function leaves(o: unknown, path = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof o === "string") { out[path] = o; return out; }
  if (Array.isArray(o)) { o.forEach((v, i) => leaves(v, `${path}.${i}`, out)); return out; }
  for (const k of Object.keys(o as Record<string, unknown>)) leaves((o as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out);
  return out;
}
const holes = (s: string) => (s.match(/\{[a-z]\}/g) || []).sort().join("");
const EN = leaves(SHARE_STRINGS.en);

Deno.test("share strings: every language has every key, and nothing extra", () => {
  assert(Object.keys(EN).length > 90, "the English set is the full list");
  for (const lang of LANGS) {
    assertEquals(Object.keys(leaves(SHARE_STRINGS[lang])).sort(), Object.keys(EN).sort(), lang);
  }
});

Deno.test("share strings: nothing is empty and every {hole} of the English survives", () => {
  for (const lang of LANGS) {
    const L = leaves(SHARE_STRINGS[lang]);
    for (const k of Object.keys(EN)) {
      if (k === "post.useCases.unspecified") { assertEquals(L[k], "", `${lang} ${k}`); continue; }
      assert(L[k].trim().length > 0, `${lang} ${k} is empty`);
      assertEquals(holes(L[k]), holes(EN[k]), `${lang} ${k}`);
    }
  }
});

// The strings go into markup, attributes and an inline script as they are.
Deno.test("share strings: no markup characters, no line breaks, no emoji", () => {
  for (const lang of LANGS) {
    const L = leaves(SHARE_STRINGS[lang]);
    for (const k of Object.keys(L)) {
      assert(!/[<>&"\\\n\r]/.test(L[k]), `${lang} ${k}: ${L[k]}`);
      assert(!/\p{Extended_Pictographic}/u.test(L[k]), `${lang} ${k} has an emoji`);
    }
  }
});

Deno.test("share strings: a translation is a translation (not the English left in place)", () => {
  // Words that really are the same in another language.
  const SAME = new Set([
    "post.useCases.formal", "post.useCases.sport", "post.useCases.casual", "post.useCases.outdoor",
    "post.useCases.unspecified", "post.useCases.dinner",
  ]);
  for (const lang of LANGS) {
    if (lang === "en") continue;
    const L = leaves(SHARE_STRINGS[lang]);
    for (const k of Object.keys(EN)) {
      if (SAME.has(k)) continue;
      assert(L[k] !== EN[k], `${lang} ${k} is still English: ${L[k]}`);
    }
  }
});

Deno.test("share strings: WRotate is never translated or respelled", () => {
  for (const lang of LANGS) {
    const L = leaves(SHARE_STRINGS[lang]);
    for (const k of Object.keys(EN)) {
      assertEquals(/WRotate/.test(L[k]), /WRotate/.test(EN[k]), `${lang} ${k}`);
      assert(!/wrotate|Wrotate|WROTATE/.test(L[k]), `${lang} ${k}`);
    }
  }
});
