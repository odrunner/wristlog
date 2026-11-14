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

// ── Languages ────────────────────────────────────────────────────────────────
// The golden files are the page exactly as it was served before it learned any
// other language (captured from the pre-change function, 2026-11-14). English,
// and every request with no usable language, must still produce them byte for
// byte.
const golden = (name: string) => Deno.readTextFileSync(new URL(`./golden/${name}.html`, import.meta.url));
const API = "https://api.wrotate.com";
const PROFILE = { id: "u1", username: "alice", display_name: "Alice <B> & Co", bio: 'Collector of "things"', avatar_url: null, is_official: true };
const WATCHES = [
  { id: "w1", brand: "Rolex", name: "Submariner", ref: "124060", image: "https://x/sub.jpg", url: "https://www.chrono24.com/rolex/x" },
  { id: "w2", brand: "Omega", name: "Speedmaster", ref: null, image: null, url: null },
  { id: "w3", brand: "", name: "", ref: "", image: null, url: "javascript:alert(1)" },
];
const NOW = Date.parse("2026-11-14T12:00:00Z");
const COMMENTS = [
  { id: "c1", name: "Sarah", body: "Love the <Daytona>!", created_at: "2026-11-14T11:59:40Z" },
  { id: "c2", name: "Bob", body: "Nice", created_at: "2026-11-14T11:15:00Z" },
  { id: "c3", name: "Cy", body: "Old", created_at: "2026-11-14T02:00:00Z" },
  { id: "c4", name: "Di", body: "Older", created_at: "2026-11-01T02:00:00Z" },
  { id: "c5", name: "Ed", body: "Oldest", created_at: "2026-01-01T02:00:00Z" },
];
const LABEL = "For my <dealer>\nBudget 10k";
import { renderSharePage, shareStatePage } from "./lib.ts";
import { LANGS } from "../_shared/lang.ts";

const SHARED = { supabaseUrl: API, token: "tok", profile: PROFILE, items: WATCHES, label: LABEL, comments: COMMENTS, nowMs: NOW };
const EMPTIED = { supabaseUrl: API, token: "tok", profile: { ...PROFILE, display_name: null, username: null }, items: [], label: LABEL, comments: [], nowMs: NOW };

Deno.test("share-wishlist — English pages are byte-identical to the pre-translation pages", () => {
  assertEquals(renderSharePage("wishlist", SHARED), golden("wishlist"));
  assertEquals(renderSharePage("wishlist", SHARED, "en"), golden("wishlist"));
  assertEquals(renderSharePage("wishlist", EMPTIED), golden("wishlist-emptied"));
  assertEquals(shareStatePage("wishlist", "missing", API), golden("missing"));
  assertEquals(shareStatePage("wishlist", "dead", API), golden("dead"));
});

Deno.test("share-wishlist — German page: German chrome and comment form, lang=de, the member's words untouched", () => {
  const html = renderSharePage("wishlist", SHARED, "de");
  assertStringIncludes(html, '<html lang="de">');
  assertStringIncludes(html, "<title>Wunschliste von Alice &lt;B&gt; &amp; Co — WRotate</title>");
  assertStringIncludes(html, '<div class="col-name">Wunschliste von Alice &lt;B&gt; &amp; Co</div>');
  assertStringIncludes(html, '<div class="col-uname">3 Uhren</div>');
  assertStringIncludes(html, '<div class="sc-title">Kommentare (5)</div>');
  assertStringIncludes(html, '<label for="sc-name">Dein Name</label>');
  assertStringIncludes(html, '>Kommentar posten</button>');
  assertStringIncludes(html, '<span class="sc-time">vor 45 Min.</span>');
  assertStringIncludes(html, "Geteilt über WRotate · <a href=\"https://wrotate.com/open\">Starte deine eigene Wunschliste</a>");
  // What the owner and the commenters wrote is left alone.
  assertStringIncludes(html, '<div class="col-label">For my &lt;dealer&gt;\nBudget 10k</div>');
  assertStringIncludes(html, '<div class="sc-body">Love the &lt;Daytona&gt;!</div>');
  assertStringIncludes(html, '<div class="wl-card-ref">Ref. 124060</div>');
  // The comment is posted back with the page's language, so the server's own
  // error messages match the form.
  assertStringIncludes(html, "encodeURIComponent(payload.t) + '&lang=de', {");
  for (const en of ["Your name", "Post comment", "Visible to everyone", "Start your own wishlist", "just now", "Could not post"]) {
    assertEquals(html.includes(en), false, en);
  }
  assertEquals(html.split("\n").length, golden("wishlist").split("\n").length);
});

Deno.test("share-wishlist — German state pages and the emptied list", () => {
  const dead = shareStatePage("wishlist", "dead", API, "de");
  assertStringIncludes(dead, "<title>Wunschlisten-Link — WRotate</title>");
  assertStringIncludes(dead, '<div class="state-title">Dieser Wunschlisten-Link ist nicht mehr verfügbar</div>');
  assertStringIncludes(shareStatePage("wishlist", "missing", API, "de"), "Keine Wunschliste angegeben");
  const html = renderSharePage("wishlist", EMPTIED, "de");
  assertStringIncludes(html, "Wunschliste von Jemand");
  assertStringIncludes(html, "Auf dieser Liste ist nichts mehr");
  assertStringIncludes(html, "Noch keine Kommentare — schreib den ersten.");
});

Deno.test("share-wishlist — every language renders with its own lang attribute, no leftover hole, a script that parses", () => {
  for (const lang of LANGS) {
    for (const html of [renderSharePage("wishlist", SHARED, lang), renderSharePage("wishlist", EMPTIED, lang), shareStatePage("wishlist", "missing", API, lang), shareStatePage("wishlist", "dead", API, lang)]) {
      assertStringIncludes(html, `<html lang="${lang}">`);
      assertEquals(/\{[a-z]\}|undefined/.test(html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, "")), false, lang);
      // French and Italian strings carry apostrophes into the inline script.
      const script = /<script>([\s\S]*?)<\/script>/.exec(html);
      if (script) new Function(script[1]);
    }
  }
});

Deno.test("buildWishlistOg — follows the language; the og:image SVG stays English", () => {
  const og = buildWishlistOg("Ana", " regalo ", [W("1", "Rolex", "Daytona")], "es");
  assertEquals(og.ogTitle, "Lista de deseos de Ana — WRotate");
  assertEquals(og.ogDescription, "1 reloj · regalo · Rolex Daytona");
  assertStringIncludes(generateWishlistOgSvg("Ozgur", []), "Ozgur's Wishlist");
});
