import { assertEquals } from "jsr:@std/assert";
import { buildHtmlBody, buildSubject, esc, profileName } from "./lib.ts";

// ---- esc ----
Deno.test("esc — escapes &, <, >, and double-quote", () => {
  assertEquals(esc(`a & b < c > d "e"`), "a &amp; b &lt; c &gt; d &quot;e&quot;");
});

Deno.test("esc — ampersand escaped before entities (no double-escape order bug)", () => {
  assertEquals(esc("<script>"), "&lt;script&gt;");
});

Deno.test("esc — plain text unchanged", () => {
  assertEquals(esc("hello world"), "hello world");
});

// ---- profileName ----
Deno.test("profileName — prefers display_name", () => {
  assertEquals(profileName({ display_name: "Sam Smith", username: "sam" }), "Sam Smith");
});

Deno.test("profileName — falls back to username", () => {
  assertEquals(profileName({ username: "sam", display_name: null }), "sam");
});

Deno.test("profileName — Unknown when both missing or profile null", () => {
  assertEquals(profileName({}), "Unknown");
  assertEquals(profileName(null), "Unknown");
  assertEquals(profileName(undefined), "Unknown");
});

// ---- buildSubject ----
Deno.test("buildSubject — formats reason, content type, reported name", () => {
  assertEquals(
    buildSubject({ reason: "spam", content_type: "post" }, "Sam"),
    "[WRotate Report] spam — post by Sam",
  );
});

// ---- buildHtmlBody ----
Deno.test("buildHtmlBody — includes pre-escaped names and escaped record fields", () => {
  const out = buildHtmlBody(
    { content_type: "post", reason: "spam", details: "bad <b>", created_at: "2026-06-01" },
    "Reporter &amp; Co",
    "Reported",
  );
  assertEquals(out.includes("Reporter &amp; Co"), true);
  assertEquals(out.includes("Reported"), true);
  assertEquals(out.includes("bad &lt;b&gt;"), true); // details escaped
  assertEquals(out.includes("2026-06-01"), true);
  assertEquals(out.includes("Action required within 24 hours."), true);
});

Deno.test("buildHtmlBody — missing details renders 'None', missing fields render empty", () => {
  const out = buildHtmlBody({}, "R", "U");
  assertEquals(out.includes("<td>None</td>"), true); // details fallback
});
