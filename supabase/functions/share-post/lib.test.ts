import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  avatarInnerHtml,
  buildPostOg,
  esc,
  formatPostDate,
  htmlPage,
  profileUrl,
  useCaseLabel,
  watchDisplayName,
} from "./lib.ts";

const FALLBACK = "https://api.wrotate.com/storage/v1/object/public/media/landing/collection.PNG";

Deno.test("esc — escapes &, <, >, \"", () => {
  assertEquals(esc(`a & b < c > "d"`), "a &amp; b &lt; c &gt; &quot;d&quot;");
});

Deno.test("useCaseLabel — known slug maps to label", () => {
  assertEquals(useCaseLabel("special"), "Special Occasion");
  assertEquals(useCaseLabel("dive"), "Dive");
});

Deno.test("useCaseLabel — 'unspecified' has empty mapped label so falls back to the slug", () => {
  // Map value is "" (falsy), so `labels[k] || k` returns the slug itself — matches original index.ts behavior.
  assertEquals(useCaseLabel("unspecified"), "unspecified");
});

Deno.test("useCaseLabel — unknown slug falls back to itself", () => {
  assertEquals(useCaseLabel("gardening"), "gardening");
});

Deno.test("useCaseLabel — null/empty yields empty string", () => {
  assertEquals(useCaseLabel(null), "");
  assertEquals(useCaseLabel(undefined), "");
  assertEquals(useCaseLabel(""), "");
});

Deno.test("watchDisplayName — joins brand and name trimmed", () => {
  assertEquals(watchDisplayName({ brand: "Rolex", name: "Submariner" }), "Rolex Submariner");
});

Deno.test("watchDisplayName — brand only / name only", () => {
  assertEquals(watchDisplayName({ brand: "Omega" }), "Omega");
  assertEquals(watchDisplayName({ name: "Speedmaster" }), "Speedmaster");
});

Deno.test("watchDisplayName — null watch yields empty string", () => {
  assertEquals(watchDisplayName(null), "");
  assertEquals(watchDisplayName(undefined), "");
});

Deno.test("formatPostDate — formats YYYY-MM-DD as en-US", () => {
  assertEquals(formatPostDate("2026-06-01"), "Jun 1, 2026");
});

Deno.test("formatPostDate — empty input yields empty string", () => {
  assertEquals(formatPostDate(""), "");
  assertEquals(formatPostDate(null), "");
  assertEquals(formatPostDate(undefined), "");
});

Deno.test("buildPostOg — with watch and caption", () => {
  const og = buildPostOg({
    displayName: "Alice", watchName: "Rolex Sub", caption: "Great day", photoUrl: "https://p/1.jpg", fallbackImage: FALLBACK,
  });
  assertEquals(og.ogTitle, "Alice's Rolex Sub — WRotate");
  assertEquals(og.ogDescription, "Great day");
  assertEquals(og.ogImage, "https://p/1.jpg");
});

Deno.test("buildPostOg — no caption falls back to 'wore their' line", () => {
  const og = buildPostOg({
    displayName: "Alice", watchName: "Rolex Sub", caption: "", photoUrl: "", fallbackImage: FALLBACK,
  });
  assertEquals(og.ogDescription, "Alice wore their Rolex Sub");
  assertEquals(og.ogImage, FALLBACK);
});

Deno.test("buildPostOg — no watch, no caption uses generic title and description", () => {
  const og = buildPostOg({
    displayName: "Alice", watchName: "", caption: "", photoUrl: "", fallbackImage: FALLBACK,
  });
  assertEquals(og.ogTitle, "Alice's post — WRotate");
  assertEquals(og.ogDescription, "Check out this post on WRotate");
});

Deno.test("buildPostOg — caption truncated to 200 chars", () => {
  const long = "x".repeat(250);
  const og = buildPostOg({
    displayName: "Alice", watchName: "", caption: long, photoUrl: "", fallbackImage: FALLBACK,
  });
  assertEquals(og.ogDescription.length, 200);
});

Deno.test("avatarInnerHtml — escaped img when url present", () => {
  assertEquals(avatarInnerHtml("https://x/a.png?a=1&b=2", "Alice"), `<img src="https://x/a.png?a=1&amp;b=2" alt="">`);
});

Deno.test("avatarInnerHtml — initials when no url", () => {
  assertEquals(avatarInnerHtml(null, "Alice Smith"), "AS");
});

Deno.test("avatarInnerHtml — empty name falls back to '?'", () => {
  assertEquals(avatarInnerHtml(null, ""), "?");
});

Deno.test("profileUrl — encodes username", () => {
  assertEquals(profileUrl("a b"), "https://wrotate.com/profile?u=a%20b");
});

Deno.test("profileUrl — null username goes to home", () => {
  assertEquals(profileUrl(null), "https://wrotate.com/");
  assertEquals(profileUrl(undefined), "https://wrotate.com/");
});

Deno.test("htmlPage — embeds escaped OG meta and body, article type", () => {
  const html = htmlPage("A & B", "desc", "https://img/x", "https://wrotate.com/", "<p>hi</p>");
  assertStringIncludes(html, `<meta property="og:title" content="A &amp; B">`);
  assertStringIncludes(html, `<meta property="og:type" content="article">`);
  assertStringIncludes(html, `<meta property="og:image" content="https://img/x">`);
  assertStringIncludes(html, "<p>hi</p>");
});
