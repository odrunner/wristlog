import { assertEquals, assertStringIncludes, assert } from "jsr:@std/assert";
import { buildDigestEmail, buildHtmlEmail, fmtMoney, unsubUrl } from "./lib.ts";

const base = { display_name: "Oz", total_value: "111379", priced_count: 13, watch_count: 19, unpriced_count: 6, stale_count: 13,
  last_checked: "2026-04-18", gain: "14129", gain_n: 13, top_brand: "Rolex", top_name: "GMT-Master II", top_value: "18500" };

Deno.test("fmtMoney", () => { assertEquals(fmtMoney("111379"), "$111,379"); assertEquals(fmtMoney(null), "—"); });

Deno.test("digest — subject carries the total; body has total, gain, top watch, staleness nudge, no-auto-change note", () => {
  const e = buildDigestEmail(base, "August 2026");
  assertEquals(e.subject, "Your collection is worth $111,379 — August 2026");
  assertStringIncludes(e.body, "<strong>$111,379</strong>");
  assertStringIncludes(e.body, "13 of 19");
  assertStringIncludes(e.body, "+$14,129");
  assertStringIncludes(e.body, "Rolex GMT-Master II</strong> at $18,500");
  assertStringIncludes(e.body, "13 haven't been checked in 60+ days, and 6 have no value yet");
  assertStringIncludes(e.body, "Update prices");
  assertStringIncludes(e.body, "we don't change them without you");
  assert(!e.body.includes("Oz"), "no personal salutation — team voice");
});

Deno.test("digest — loss is signed with a minus; no gain line when gain_n = 0; fresh collection has no nudge", () => {
  assertStringIncludes(buildDigestEmail({ ...base, gain: "-2000" }, "M").body, "−$2,000");
  assert(!buildDigestEmail({ ...base, gain: null, gain_n: 0 }, "M").body.includes("Against what you paid"));
  const fresh = buildDigestEmail({ ...base, stale_count: 0, unpriced_count: 0, watch_count: 13 }, "M").body;
  assertStringIncludes(fresh, "nothing to do");
  assert(!fresh.includes("13 of 19"));
});

Deno.test("digest — brand/name are HTML-escaped", () => {
  assertStringIncludes(buildDigestEmail({ ...base, top_brand: "<b>", top_name: "x&y" }, "M").body, "&lt;b&gt; x&amp;y");
});

Deno.test("html wrapper — CTA to /open with the value-digest campaign; unsubscribe cat=digest", () => {
  const html = buildHtmlEmail("s", "<p>b</p>", unsubUrl("https://api.wrotate.com", "u1", "sig", "digest"));
  assertStringIncludes(html, "https://wrotate.com/open?utm_source=email&utm_medium=campaign&utm_campaign=value-digest");
  assertStringIncludes(html, "cat=digest");
});
