import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { count, isCrawlerUA, LANGS, LOCALES, num, pageLang, requestLang } from "./lang.ts";

const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// What iMessage sends from the sender's phone when it builds a link preview.
const IMESSAGE = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0";

Deno.test("requestLang: nothing to go on is English", () => {
  assertEquals(requestLang(null, null), "en");
  assertEquals(requestLang(undefined, undefined), "en");
  assertEquals(requestLang("", ""), "en");
  assertEquals(requestLang(42, {}), "en");
});

Deno.test("requestLang: ?lang= wins when it is one of our codes", () => {
  for (const l of LANGS) assertEquals(requestLang(l, "ja"), l);
  assertEquals(requestLang("de", "fr-FR,fr;q=0.9"), "de");
  assertEquals(requestLang("en", "de-DE,de;q=0.9"), "en", "an explicit English beats a German browser");
  assertEquals(requestLang(" DE ", null), "de", "case and stray spaces are forgiven");
});

Deno.test("requestLang: a ?lang= that is not one of our codes is ignored, not guessed at", () => {
  assertEquals(requestLang("ja", null), "en");
  assertEquals(requestLang("de-DE", null), "en");
  assertEquals(requestLang("german", "fr"), "fr", "falls through to the header");
  assertEquals(requestLang("__proto__", null), "en");
  assertEquals(requestLang("constructor", null), "en");
});

Deno.test("requestLang: Accept-Language, first supported language by q then position", () => {
  assertEquals(requestLang(null, "de"), "de");
  assertEquals(requestLang(null, "de-DE,de;q=0.9,en;q=0.8"), "de");
  assertEquals(requestLang(null, "fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7"), "fr", "a region counts as its language");
  assertEquals(requestLang(null, "en-US,en;q=0.9,de;q=0.8"), "en", "English first stays English");
  assertEquals(requestLang(null, "ja, de;q=0.8, en;q=0.5"), "de", "skips what we do not offer");
  assertEquals(requestLang(null, "en;q=0.5, tr;q=0.9"), "tr", "q beats position");
  assertEquals(requestLang(null, "es;q=0.7, it;q=0.7"), "es", "equal q keeps the header's order");
  assertEquals(requestLang(null, "PT-br"), "pt", "tags are case-insensitive");
  assertEquals(requestLang(null, "pt ; q = 0.4 , it;q=0.6"), "it", "spaces around q are tolerated");
});

Deno.test("requestLang: q=0, wildcards and junk never pick a language", () => {
  assertEquals(requestLang(null, "de;q=0, fr;q=0.3"), "fr", "q=0 means not this one");
  assertEquals(requestLang(null, "de;q=0"), "en");
  assertEquals(requestLang(null, "*"), "en");
  assertEquals(requestLang(null, "ja,zh;q=0.9,ko;q=0.8"), "en");
  assertEquals(requestLang(null, ",,;;q=,;q=abc"), "en");
  assertEquals(requestLang(null, "de;q=abc"), "de", "a q that is not a number is ignored: the tag counts in full");
  assertEquals(requestLang(null, "de;q=1.2.3, fr;q=0.1"), "fr", "a q that does not parse drops the tag");
  assertEquals(requestLang(null, "x".repeat(5000) + ",de"), "en", "only the first 1000 characters are read");
});

Deno.test("isCrawlerUA: preview fetchers and scripts, not browsers", () => {
  assertEquals(isCrawlerUA(SAFARI), false);
  assertEquals(isCrawlerUA(IMESSAGE), true);
  assertEquals(isCrawlerUA("WhatsApp/2.23.20.0"), true);
  assertEquals(isCrawlerUA("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"), true);
  assertEquals(isCrawlerUA(null), true, "no User-Agent is nothing a browser sends");
  assertEquals(isCrawlerUA(""), true);
});

Deno.test("pageLang: a browser follows its header, a preview fetcher stays English", () => {
  assertEquals(pageLang(null, "de-DE,de;q=0.9", SAFARI), "de");
  assertEquals(pageLang(null, "de-DE,de;q=0.9", IMESSAGE), "en", "the sender's phone language must not reach the preview");
  assertEquals(pageLang(null, "de-DE", null), "en");
  assertEquals(pageLang(null, null, SAFARI), "en");
  assertEquals(pageLang("fr", "de-DE", SAFARI), "fr");
  assertEquals(pageLang("fr", null, IMESSAGE), "fr", "a link that says ?lang= is honoured for everyone");
  assertEquals(pageLang("xx", "de", IMESSAGE), "en");
});

Deno.test("num: English keeps bare digits, other languages group their own way", () => {
  assertEquals(num("en", 12345), "12345");
  assertEquals(num("de", 12345), "12.345");
  assertEquals(num("tr", 12345), "12.345");
  assertEquals(num("fr", 7), "7");
  for (const l of LANGS) assertEquals(typeof LOCALES[l], "string");
});

Deno.test("count: one/other, with French counting 0 as singular", () => {
  const f = ["{n} watch", "{n} watches"] as const;
  assertEquals(count("en", 0, f), "0 watches");
  assertEquals(count("en", 1, f), "1 watch");
  assertEquals(count("en", 2, f), "2 watches");
  const fr = ["{n} montre", "{n} montres"] as const;
  assertEquals(count("fr", 0, fr), "0 montre");
  assertEquals(count("fr", 1, fr), "1 montre");
  assertEquals(count("fr", 2, fr), "2 montres");
  assertEquals(count("es", 0, ["{n} reloj", "{n} relojes"]), "0 relojes");
});
