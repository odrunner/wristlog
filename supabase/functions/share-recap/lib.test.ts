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
  prevPeriodOf,
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

Deno.test("prevPeriodOf steps back a month, rolling the year", () => {
  assertEquals(prevPeriodOf("2026-07"), "2026-06");
  assertEquals(prevPeriodOf("2026-01"), "2025-12");
  assertEquals(prevPeriodOf("2026-10"), "2026-09");
});

Deno.test("monthLabel renders with and without the year", () => {
  assertEquals(monthLabel("2026-07"), "July 2026");
  assertEquals(monthLabel("2026-07", false), "July");
  assertEquals(monthLabel("2026-12"), "December 2026");
});

Deno.test("isRecapViewable requires a public profile and a non-private collection", () => {
  assertEquals(isRecapViewable({ profile_privacy: "public", collection_visibility: "public" }, null), true);
  assertEquals(isRecapViewable({}, null), true, "absent fields default to public");
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
