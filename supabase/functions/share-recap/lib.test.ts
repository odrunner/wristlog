import { assertEquals, assertNotMatch, assertStringIncludes } from "jsr:@std/assert";
import {
  buildRecapOg,
  computeRecap,
  esc,
  generateRecapSvg,
  htmlPage,
  isCrawlerUA,
  isRecapViewable,
  isValidPeriod,
  monthLabel,
} from "./lib.ts";

const owned = (...ids: string[]) => new Set(ids);
const L = (watch_id: string, date: string, use_case = "work") => ({ watch_id, date, use_case });

Deno.test("isValidPeriod accepts a well-formed month", () => {
  assertEquals(isValidPeriod("2026-07"), true);
  assertEquals(isValidPeriod("2026-12"), true);
  assertEquals(isValidPeriod("2020-01"), true);
});

// The month arrives from a URL anyone can edit and is interpolated into date
// filters and page copy, so anything not exactly YYYY-MM is refused outright.
Deno.test("isValidPeriod rejects anything malformed or out of range", () => {
  for (
    const bad of [
      null, "", "2026", "2026-7", "2026-13", "2026-00", "26-07",
      "2026-07-01", "1999-07", "2200-01", "2026-0a", "'; drop table logs;--",
    ]
  ) {
    assertEquals(isValidPeriod(bad as string), false, `should reject ${bad}`);
  }
});

Deno.test("monthLabel renders with and without the year", () => {
  assertEquals(monthLabel("2026-07"), "July 2026");
  assertEquals(monthLabel("2026-07", false), "July");
  assertEquals(monthLabel("2026-12"), "December 2026");
});

Deno.test("isRecapViewable requires a public profile and a public collection", () => {
  assertEquals(isRecapViewable({ profile_privacy: "public", collection_visibility: "public" }, null), true);
  assertEquals(isRecapViewable({}, null), false, "absent visibility = followers, as in the app");
  assertEquals(isRecapViewable({ collection_visibility: "followers" }, null), false);
  assertEquals(isRecapViewable({ collection_visibility: "friends" }, null), false);
  assertEquals(isRecapViewable({ profile_privacy: "private" }, null), false);
  assertEquals(isRecapViewable({ collection_visibility: "private" }, null), false);
  assertEquals(isRecapViewable(null, null), false);
  assertEquals(isRecapViewable({ profile_privacy: "public" }, new Error("boom")), false);
});

// These rules must match monthRecap() in index.html — a sharer who sends their
// July and then sees different numbers on the page has caught us contradicting
// ourselves.
Deno.test("computeRecap counts a watch worn twice in one day once", () => {
  const r = computeRecap(
    [L("a", "2026-07-01"), L("a", "2026-07-01", "casual"), L("b", "2026-07-02")],
    owned("a", "b"), owned("a", "b"), "2026-07",
  );
  assertEquals(r.totalWears, 2);
  assertEquals(r.wearDays, 2);
});

Deno.test("computeRecap excludes measurement shares", () => {
  const r = computeRecap(
    [L("a", "2026-07-01"), L("a", "2026-07-02", "measurement")],
    owned("a"), owned("a"), "2026-07",
  );
  assertEquals(r.totalWears, 1);
});

Deno.test("computeRecap excludes logs for a watch no longer owned", () => {
  const r = computeRecap(
    [L("a", "2026-07-01"), L("gone", "2026-07-02")],
    owned("a"), owned("a"), "2026-07",
  );
  assertEquals(r.totalWears, 1);
  assertEquals(r.uniqueCount, 1);
});

Deno.test("computeRecap ignores other months", () => {
  const r = computeRecap(
    [L("a", "2026-07-01"), L("a", "2026-06-30"), L("a", "2026-08-01")],
    owned("a"), owned("a"), "2026-07",
  );
  assertEquals(r.totalWears, 1);
});

// The whole point of the owned/public split: a private watch still counts
// towards the aggregate (so the numbers match what the sharer saw), but it must
// never be named on a page anyone with the link can open.
Deno.test("computeRecap counts a private watch but never names it", () => {
  const r = computeRecap(
    [
      L("secret", "2026-07-01"), L("secret", "2026-07-02"), L("secret", "2026-07-03"),
      L("shown", "2026-07-04"),
    ],
    owned("secret", "shown"), owned("shown"), "2026-07",
  );
  assertEquals(r.totalWears, 4, "the private watch still counts");
  assertEquals(r.uniqueCount, 2);
  assertEquals(r.top.map((t) => t.id), ["shown"], "but it is not on the podium");
});

Deno.test("computeRecap ranks the podium by wears, capped at three", () => {
  const r = computeRecap(
    [
      L("a", "2026-07-01"), L("a", "2026-07-02"), L("a", "2026-07-03"),
      L("b", "2026-07-04"), L("b", "2026-07-05"),
      L("c", "2026-07-06"), L("d", "2026-07-07"),
    ],
    owned("a", "b", "c", "d"), owned("a", "b", "c", "d"), "2026-07",
  );
  assertEquals(r.top.length, 3);
  assertEquals(r.top.map((t) => t.id), ["a", "b", "c"]);
  assertEquals(r.top[0].count, 3);
});

Deno.test("computeRecap finds the longest streak and drops short ones", () => {
  const long = computeRecap(
    [L("a", "2026-07-01"), L("a", "2026-07-02"), L("b", "2026-07-03"), L("b", "2026-07-09")],
    owned("a", "b"), owned("a", "b"), "2026-07",
  );
  assertEquals(long.streak, { days: 3, start: "2026-07-01", end: "2026-07-03" });

  const short = computeRecap(
    [L("a", "2026-07-01"), L("a", "2026-07-02"), L("b", "2026-07-09")],
    owned("a", "b"), owned("a", "b"), "2026-07",
  );
  assertEquals(short.streak, null);
});

Deno.test("computeRecap survives an empty month", () => {
  const r = computeRecap([], owned("a"), owned("a"), "2026-07");
  assertEquals(r.totalWears, 0);
  assertEquals(r.top, []);
  assertEquals(r.streak, null);
});

Deno.test("buildRecapOg summarises the month", () => {
  const recap = { period: "2026-07", totalWears: 37, wearDays: 28, uniqueCount: 14, top: [], streak: null };
  const { ogTitle, ogDescription } = buildRecapOg("Ozgur", recap, "Vacheron Overseas");
  assertEquals(ogTitle, "Ozgur's July 2026 — WRotate");
  assertStringIncludes(ogDescription, "37 wears");
  assertStringIncludes(ogDescription, "14 watches");
  assertStringIncludes(ogDescription, "28 days logged");
  assertStringIncludes(ogDescription, "Most worn: Vacheron Overseas");
});

Deno.test("buildRecapOg singularises and omits an absent most-worn", () => {
  const recap = { period: "2026-01", totalWears: 1, wearDays: 1, uniqueCount: 1, top: [], streak: null };
  const { ogDescription } = buildRecapOg("Sam", recap, null);
  assertEquals(ogDescription, "1 wear · 1 watch · 1 day logged");
});

Deno.test("generateRecapSvg renders the headline numbers and the podium", () => {
  const recap = {
    period: "2026-07",
    totalWears: 37,
    wearDays: 28,
    uniqueCount: 14,
    top: [{ id: "a", count: 8 }, { id: "b", count: 5 }],
    streak: null,
  };
  const svg = generateRecapSvg("Ozgur", recap, {
    a: { brand: "Vacheron", name: "Overseas", image: "https://x/a.jpg" },
    b: { brand: "Omega", name: "Speedmaster" },
  });
  assertStringIncludes(svg, "1200");
  assertStringIncludes(svg, "July 2026");
  assertStringIncludes(svg, ">37<");
  assertStringIncludes(svg, ">14<");
  assertStringIncludes(svg, "Overseas");
  assertStringIncludes(svg, "8 wears");
  assertStringIncludes(svg, "https://x/a.jpg");
  assertStringIncludes(svg, ">OS<", "a watch with no image falls back to initials");
});

Deno.test("generateRecapSvg escapes hostile names", () => {
  const recap = {
    period: "2026-07",
    totalWears: 1,
    wearDays: 1,
    uniqueCount: 1,
    top: [{ id: "a", count: 1 }],
    streak: null,
  };
  const svg = generateRecapSvg("</text><script>alert(1)</script>", recap, {
    a: { brand: "X", name: `"><script>alert(2)</script>` },
  });
  assertNotMatch(svg, /<script>/);
});

Deno.test("htmlPage carries the OG tags and keeps the page out of search", () => {
  const html = htmlPage("T", "D", "https://img/x", "https://c/x", "<p>body</p>");
  assertStringIncludes(html, `<meta property="og:title" content="T">`);
  assertStringIncludes(html, `<meta property="og:image" content="https://img/x">`);
  assertStringIncludes(html, `<meta name="twitter:card" content="summary_large_image">`);
  assertStringIncludes(html, `<meta name="robots" content="noindex">`);
  assertStringIncludes(html, "<p>body</p>");
});

Deno.test("esc neutralises markup", () => {
  assertEquals(esc(`<script>"&`), "&lt;script&gt;&quot;&amp;");
});

Deno.test("isCrawlerUA separates link-preview bots from people", () => {
  assertEquals(isCrawlerUA("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"), true);
  assertEquals(isCrawlerUA("WhatsApp/2.23.20.0"), true);
  assertEquals(isCrawlerUA("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"), true);
  assertEquals(isCrawlerUA("Twitterbot/1.0"), true);
  assertEquals(isCrawlerUA("curl/8.4.0"), true);
  assertEquals(isCrawlerUA(null), true);
  assertEquals(isCrawlerUA(""), true);
  assertEquals(isCrawlerUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"), false);
  assertEquals(isCrawlerUA("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"), false);
});

// ── Languages ────────────────────────────────────────────────────────────────
// The golden files are the page exactly as it was served before it learned any
// other language (captured from the pre-change function, 2026-11-14). English,
// and every request with no usable language, must still produce them byte for
// byte.
const golden = (name: string) => Deno.readTextFileSync(new URL(`./golden/${name}.html`, import.meta.url));
const API = "https://api.wrotate.com";
const PROFILE = { id: "u1", username: "alice", display_name: "Alice <B> & Co", bio: 'Collector of "things"', avatar_url: null, is_official: true };
import { recapStatePage, renderRecapPage } from "./lib.ts";
import { LANGS } from "../_shared/lang.ts";

const RWATCHES = [
  { id: "w1", brand: "Rolex", name: "Submariner", image: "https://x/sub.jpg" },
  { id: "w2", brand: "Omega", name: "Speedmaster", image: null },
  { id: "w3", brand: "", name: "", image: null },
];
const JULY: { watch_id: string; date: string; use_case: string | null }[] = [];
for (let d = 1; d <= 9; d++) JULY.push({ watch_id: d % 3 === 0 ? "w2" : "w1", date: `2026-07-0${d}`, use_case: "casual" });
JULY.push({ watch_id: "w3", date: "2026-07-20", use_case: null });
const IDS = new Set(["w1", "w2", "w3"]);
// deno-lint-ignore no-explicit-any
const BY_ID: Record<string, any> = Object.fromEntries(RWATCHES.map((w) => [w.id, w]));
const RECAP = { supabaseUrl: API, token: null, username: "alice", profile: PROFILE, recap: computeRecap(JULY, IDS, IDS, "2026-07"), watchById: BY_ID };
const NO_WEARS = { ...RECAP, recap: computeRecap([], IDS, IDS, "2026-07") };

Deno.test("share-recap — English pages are byte-identical to the pre-translation pages", () => {
  assertEquals(renderRecapPage(RECAP), golden("recap"));
  assertEquals(renderRecapPage(RECAP, "en"), golden("recap"));
  assertEquals(renderRecapPage(NO_WEARS), golden("no-wears"));
  assertEquals(recapStatePage("bad", API), golden("bad"));
  assertEquals(recapStatePage("private", API), golden("private"));
});

Deno.test("share-recap — German page: German chrome and month, lang=de, the member's words untouched", () => {
  const html = renderRecapPage(RECAP, "de");
  assertStringIncludes(html, '<html lang="de">');
  assertStringIncludes(html, "<title>Alice &lt;B&gt; &amp; Co · Juli 2026 — WRotate</title>");
  assertStringIncludes(html, 'content="10× getragen · 3 Uhren · 10 Tage erfasst · Meistgetragen: Rolex Submariner"');
  assertStringIncludes(html, '<div class="rc-eyebrow">Monatsrückblick</div>');
  assertStringIncludes(html, '<div class="rc-month">Juli</div>');
  assertStringIncludes(html, '<div class="rc-stat-lbl">Trageeinträge</div>');
  assertStringIncludes(html, '<div class="rc-streak-lbl">Tage in Folge erfasst</div>');
  assertStringIncludes(html, ">Erfasse deine eigene Rotation</a>");
  assertStringIncludes(html, '<div class="rc-name">Submariner</div>');
  for (const en of ["Month in review", "Most worn", "Track your own rotation", "days logged in a row", ">July<"]) {
    assertEquals(html.includes(en), false, en);
  }
  assertEquals(html.split("\n").length, golden("recap").split("\n").length);
});

Deno.test("share-recap — German state pages", () => {
  const none = renderRecapPage(NO_WEARS, "de");
  assertStringIncludes(none, '<div class="state-title">Keine Trageeinträge in diesem Monat</div>');
  assertStringIncludes(none, "Alice &lt;B&gt; &amp; Co hat im Juli 2026 nichts eingetragen.");
  assertStringIncludes(recapStatePage("bad", API, "de"), "Hier gibt es nichts zu sehen");
  const priv = recapStatePage("private", API, "de");
  assertStringIncludes(priv, "<title>Privat — WRotate</title>");
  assertStringIncludes(priv, "Diese Sammlung ist privat oder nicht mehr verfügbar.");
});

Deno.test("share-recap — every language renders with its own lang attribute and no leftover hole", () => {
  for (const lang of LANGS) {
    for (const html of [renderRecapPage(RECAP, lang), renderRecapPage(NO_WEARS, lang), recapStatePage("bad", API, lang), recapStatePage("private", API, lang)]) {
      assertStringIncludes(html, `<html lang="${lang}">`);
      assertEquals(/\{[a-z]\}|undefined/.test(html.replace(/<style>[\s\S]*?<\/style>/, "")), false, lang);
    }
  }
});

Deno.test("monthLabel — the locale's own month; English and the og:image unchanged", () => {
  assertEquals(monthLabel("2026-07"), "July 2026");
  assertEquals(monthLabel("2026-07", false), "July");
  assertEquals(monthLabel("2026-07", true, "es"), "julio de 2026");
  assertEquals(monthLabel("2026-07", false, "es"), "Julio", "alone it is a heading, so it gets a capital");
  assertEquals(monthLabel("2026-03", true, "fr"), "mars 2026");
  assertEquals(monthLabel("2026-12", false, "tr"), "Aralık");
  assertEquals(monthLabel("2026-01", true, "pt"), "janeiro de 2026");
  assertEquals(monthLabel("2026-13", true, "de"), " 2026", "a month that does not exist behaves as it does in English");
  assertStringIncludes(generateRecapSvg("Ozgur", RECAP.recap, BY_ID), "MONTH IN REVIEW");
});
