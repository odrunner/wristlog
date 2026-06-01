import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { buildEmailHtml, buildSubject, esc, providerFromEmail } from "./lib.ts";

Deno.test("esc — escapes &, <, >, \"", () => {
  assertEquals(esc(`a & b < c > "d"`), "a &amp; b &lt; c &gt; &quot;d&quot;");
});

Deno.test("providerFromEmail — Apple private relay", () => {
  assertEquals(providerFromEmail("abc123@privaterelay.appleid.com"), "Apple");
});

Deno.test("providerFromEmail — gmail / googlemail", () => {
  assertEquals(providerFromEmail("user@gmail.com"), "Google (likely)");
  assertEquals(providerFromEmail("user@googlemail.com"), "Google (likely)");
});

Deno.test("providerFromEmail — other domains", () => {
  assertEquals(providerFromEmail("user@outlook.com"), "Google or Email");
  assertEquals(providerFromEmail("Unknown"), "Google or Email");
});

Deno.test("providerFromEmail — Apple takes precedence over generic", () => {
  // Apple relay check runs first.
  assertEquals(providerFromEmail("x@privaterelay.appleid.com"), "Apple");
});

Deno.test("buildSubject — formats name and username", () => {
  assertEquals(buildSubject("Alice", "alice99"), "New WRotate user: Alice (@alice99)");
});

Deno.test("buildEmailHtml — includes provided fields", () => {
  const html = buildEmailHtml({
    displayName: "Alice",
    username: "alice99",
    userEmail: "alice@gmail.com",
    provider: "Google (likely)",
    createdAt: "2026-06-01T00:00:00Z",
    count: 42,
  });
  assertStringIncludes(html, ">Alice<");
  assertStringIncludes(html, "@alice99<");
  assertStringIncludes(html, "alice@gmail.com");
  assertStringIncludes(html, "Google (likely)");
  assertStringIncludes(html, "2026-06-01T00:00:00Z");
  assertStringIncludes(html, ">42<");
  assertStringIncludes(html, "New User Signup");
});

Deno.test("buildEmailHtml — escapes the userEmail (mirrors index.ts esc(userEmail))", () => {
  const html = buildEmailHtml({
    displayName: "Alice",
    username: "alice99",
    userEmail: `a<b>@x.com&y`,
    provider: "Google or Email",
    createdAt: "2026-06-01",
    count: 1,
  });
  assertStringIncludes(html, "a&lt;b&gt;@x.com&amp;y");
});

Deno.test("buildEmailHtml — null count renders '?'", () => {
  const html = buildEmailHtml({
    displayName: "Alice",
    username: "alice99",
    userEmail: "alice@gmail.com",
    provider: "Google (likely)",
    createdAt: "2026-06-01",
    count: null,
  });
  assertStringIncludes(html, ">?<");
});

Deno.test("buildEmailHtml — does not double-escape pre-escaped name (caller esc's it)", () => {
  // index.ts passes esc(displayName); buildEmailHtml inserts it verbatim.
  const preEscaped = esc("A & B");
  const html = buildEmailHtml({
    displayName: preEscaped,
    username: "ab",
    userEmail: "ab@x.com",
    provider: "Google or Email",
    createdAt: "2026-06-01",
    count: 1,
  });
  assertStringIncludes(html, "A &amp; B");
});
