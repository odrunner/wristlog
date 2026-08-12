import { assertEquals, assertMatch, assertNotMatch, assertStringIncludes } from "jsr:@std/assert";
import {
  avatarInnerHtml,
  buildWishlistOg,
  esc,
  generateWishlistOgSvg,
  htmlPage,
  initials,
  isShareUsable,
  linkDomain,
  safeLinkUrl,
  SHARE_SELECT,
  wishlistCardsHtml,
} from "./lib.ts";

const W = (id: string, brand: string, name: string, ref = "", image: string | null = null) =>
  ({ id, brand, name, ref, image });

// SHARE_SELECT is what actually decides which columns leave the database. Every
// other privacy guard in this feature operates on rows that this list already
// admitted, so it is the one place where a widening slips past all of them:
// index.ts has no test of its own, and changing its query to "*" would publish
// price, notes and market value without failing anything else in the repo.
const SHARE_SELECT_COLUMNS = SHARE_SELECT.split(",").map((c) => c.trim());

Deno.test("SHARE_SELECT admits exactly the five published columns plus sort_order", () => {
  assertEquals(SHARE_SELECT_COLUMNS, ["id", "brand", "name", "ref", "image", "url", "sort_order"]);
});

Deno.test("SHARE_SELECT is never a wildcard", () => {
  assertNotMatch(SHARE_SELECT, /\*/);
});

// Named one by one rather than as a loop over a blob, so a failure says which
// field would have shipped.
Deno.test("SHARE_SELECT excludes every suppressed wishlist column", () => {
  for (
    const forbidden of [
      "price",
      "market_price",
      "market_price_date",
      "market_price_src",
      "watch_charts_url",
      "notes",
      "tags",
      "added_date",
      "wish_privacy",
    ]
  ) {
    assertEquals(
      SHARE_SELECT_COLUMNS.includes(forbidden),
      false,
      `SHARE_SELECT must not fetch "${forbidden}" — it would reach a share recipient`,
    );
  }
});

Deno.test("isShareUsable accepts a live row", () => {
  assertEquals(isShareUsable({ revoked_at: null }, null), true);
});

Deno.test("isShareUsable refuses a revoked, missing or errored row", () => {
  assertEquals(isShareUsable({ revoked_at: "2026-08-11T10:00:00Z" }, null), false);
  assertEquals(isShareUsable(null, null), false);
  assertEquals(isShareUsable(undefined, null), false);
  assertEquals(isShareUsable({ revoked_at: null }, new Error("boom")), false);
});

Deno.test("wishlistCardsHtml renders brand, model and reference", () => {
  const html = wishlistCardsHtml([W("1", "Rolex", "Cosmograph Daytona", "126519LN")]);
  assertStringIncludes(html, "Rolex");
  assertStringIncludes(html, "Cosmograph Daytona");
  assertStringIncludes(html, "126519LN");
});

// The whole point of the feature's privacy promise: a dealer link must never
// carry what the owner is willing to pay, what the market says, or their notes.
// The function takes only the five whitelisted fields, so extra keys on the
// input object can never reach the markup. (The saved url IS published, on
// purpose — see the url tests below.)
Deno.test("wishlistCardsHtml never emits price, market value, notes or tags", () => {
  const html = wishlistCardsHtml([
    // deno-lint-ignore no-explicit-any
    ({
      id: "1", brand: "Rolex", name: "Daytona", ref: "126519LN", image: null,
      price: 42700, market_price: 51000, notes: "birthday present",
      tags: ["grail"], url: "https://chrono24.com/x", wish_privacy: "private",
    } as any),
  ]);
  assertNotMatch(html, /42700/);
  assertNotMatch(html, /51000/);
  assertNotMatch(html, /birthday present/);
  assertNotMatch(html, /grail/);
  assertNotMatch(html, /private/);
});

Deno.test("wishlistCardsHtml escapes every field it renders", () => {
  const html = wishlistCardsHtml([W("1", '<script>x</script>', '"quoted"', "<b>ref</b>")]);
  assertNotMatch(html, /<script>/);
  assertNotMatch(html, /<b>ref<\/b>/);
  assertStringIncludes(html, "&lt;script&gt;");
});

Deno.test("wishlistCardsHtml falls back to initials when a watch has no photo", () => {
  const html = wishlistCardsHtml([W("1", "Grand Seiko", "Snowflake")]);
  assertStringIncludes(html, "GS");
  assertNotMatch(html, /<img/);
});

Deno.test("wishlistCardsHtml handles an empty list", () => {
  assertEquals(wishlistCardsHtml([]), "");
});

Deno.test("buildWishlistOg names the owner and counts the watches", () => {
  const { ogTitle, ogDescription } = buildWishlistOg("Ozgur", null, [
    W("1", "Rolex", "Daytona"), W("2", "Omega", "Speedmaster"),
  ]);
  assertEquals(ogTitle, "Ozgur's wishlist — WRotate");
  assertStringIncludes(ogDescription, "2 watches");
  assertStringIncludes(ogDescription, "Rolex Daytona");
});

Deno.test("buildWishlistOg singularises a one-watch share", () => {
  const { ogDescription } = buildWishlistOg("Ozgur", null, [W("1", "Rolex", "Daytona")]);
  assertStringIncludes(ogDescription, "1 watch");
  assertNotMatch(ogDescription, /1 watches/);
});

Deno.test("buildWishlistOg puts the label in the description when set", () => {
  const { ogDescription } = buildWishlistOg("Ozgur", "Watches of Switzerland", [W("1", "Rolex", "Daytona")]);
  assertStringIncludes(ogDescription, "Watches of Switzerland");
});

Deno.test("buildWishlistOg survives an empty share", () => {
  const { ogTitle, ogDescription } = buildWishlistOg("Ozgur", null, []);
  assertEquals(ogTitle, "Ozgur's wishlist — WRotate");
  assertStringIncludes(ogDescription, "0 watches");
});

Deno.test("generateWishlistOgSvg returns a 1200x630 SVG", () => {
  const svg = generateWishlistOgSvg("Ozgur", [W("1", "Rolex", "Daytona")]);
  assertMatch(svg, /^<svg/);
  assertStringIncludes(svg, 'width="1200"');
  assertStringIncludes(svg, 'height="630"');
});

Deno.test("generateWishlistOgSvg still renders with no watches", () => {
  const svg = generateWishlistOgSvg("Ozgur", []);
  assertMatch(svg, /^<svg/);
  assertStringIncludes(svg, "No watches");
});

// A dealer link in a search result would be a privacy failure, so every page
// this function serves carries the robots directive.
Deno.test("htmlPage tells crawlers not to index", () => {
  const html = htmlPage("t", "d", "i", "c", "<p>body</p>");
  assertStringIncludes(html, '<meta name="robots" content="noindex,nofollow">');
});

Deno.test("htmlPage escapes the metadata it interpolates", () => {
  const html = htmlPage('a"b', "d", "i", "c", "<p>body</p>");
  assertStringIncludes(html, "a&quot;b");
});

Deno.test("esc escapes the five HTML-significant characters", () => {
  assertEquals(esc('<&>"'), "&lt;&amp;&gt;&quot;");
});

Deno.test("initials takes two letters and copes with blanks", () => {
  assertEquals(initials("Grand", "Seiko"), "GS");
  assertEquals(initials("", ""), "?");
});

Deno.test("avatarInnerHtml uses the photo when present, initials otherwise", () => {
  assertStringIncludes(avatarInnerHtml("https://x/a.jpg", "Ozgur Dogan"), "<img");
  assertEquals(avatarInnerHtml(null, "Ozgur Dogan"), "OD");
});

// The saved listing link is published deliberately (2026-08-12) — it is the page
// the owner had in mind, and the point of sending the list to a dealer.
Deno.test("wishlistCardsHtml links out to the saved url, labelled by domain", () => {
  const html = wishlistCardsHtml([
    { id: "1", brand: "Rolex", name: "Daytona", ref: "", image: null, url: "https://www.chrono24.com/rolex/daytona.htm" },
  ]);
  assertStringIncludes(html, 'href="https://www.chrono24.com/rolex/daytona.htm"');
  assertStringIncludes(html, "chrono24.com");
  assertStringIncludes(html, 'rel="noopener noreferrer nofollow"');
});

Deno.test("wishlistCardsHtml omits the link entirely when no url was saved", () => {
  const html = wishlistCardsHtml([W("1", "Rolex", "Daytona")]);
  assertNotMatch(html, /wl-card-url/);
});

// A wishlist url is user-supplied text, so it is the one attacker-controlled value
// that becomes an href. Anything but http(s) must not survive.
Deno.test("safeLinkUrl passes http and https and nothing else", () => {
  assertEquals(safeLinkUrl("https://chrono24.com/x"), "https://chrono24.com/x");
  assertEquals(safeLinkUrl("http://example.com/"), "http://example.com/");
  for (
    const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "not a url",
      "",
      null,
      undefined,
    ]
  ) {
    assertEquals(safeLinkUrl(bad), "", `safeLinkUrl must refuse ${String(bad)}`);
  }
});

Deno.test("wishlistCardsHtml refuses to render a javascript: url as a link", () => {
  const html = wishlistCardsHtml([
    { id: "1", brand: "Rolex", name: "Daytona", ref: "", image: null, url: "javascript:alert(1)" },
  ]);
  assertNotMatch(html, /javascript:/);
  assertNotMatch(html, /wl-card-url/);
});

Deno.test("linkDomain strips www and refuses an unsafe scheme", () => {
  assertEquals(linkDomain("https://www.chrono24.com/a/b"), "chrono24.com");
  assertEquals(linkDomain("https://watchbox.com"), "watchbox.com");
  assertEquals(linkDomain("javascript:alert(1)"), "");
  assertEquals(linkDomain(null), "");
});
