import { assertEquals, assertMatch, assertNotMatch, assertStringIncludes } from "jsr:@std/assert";
import {
  avatarInnerHtml,
  buildWishlistOg,
  esc,
  generateWishlistOgSvg,
  htmlPage,
  initials,
  isShareUsable,
  wishlistCardsHtml,
} from "./lib.ts";

const W = (id: string, brand: string, name: string, ref = "", image: string | null = null) =>
  ({ id, brand, name, ref, image });

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
// The function takes only the four whitelisted fields, so extra keys on the
// input object can never reach the markup.
Deno.test("wishlistCardsHtml never emits price, market value, notes, tags or the saved URL", () => {
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
  assertNotMatch(html, /chrono24/);
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
