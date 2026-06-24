import { assertEquals } from "jsr:@std/assert";
import {
  buildHtmlEmail,
  dropDone,
  filterEligible,
  personalizeBody,
  signupWindow,
  skipTable,
  splitAlreadySent,
  unsubUrl,
} from "./lib.ts";

const DAY = 24 * 60 * 60 * 1000;

// ---- signupWindow ----
Deno.test("signupWindow — delay 2 days yields a 24h slice ending 2 days before now", () => {
  const now = Date.parse("2026-06-10T00:00:00Z");
  const { windowStart, windowEnd } = signupWindow(now, 2);
  assertEquals(windowEnd, "2026-06-08T00:00:00.000Z");
  assertEquals(windowStart, "2026-06-07T00:00:00.000Z");
});

Deno.test("signupWindow — window is always exactly 24h wide", () => {
  const now = Date.parse("2026-06-10T12:34:56Z");
  const { windowStart, windowEnd } = signupWindow(now, 5);
  assertEquals(Date.parse(windowEnd) - Date.parse(windowStart), DAY);
});

Deno.test("signupWindow — delay 0 ends at now", () => {
  const now = Date.parse("2026-06-10T00:00:00Z");
  const { windowStart, windowEnd } = signupWindow(now, 0);
  assertEquals(windowEnd, "2026-06-10T00:00:00.000Z");
  assertEquals(windowStart, "2026-06-09T00:00:00.000Z");
});

// ---- filterEligible ----
Deno.test("filterEligible — excludes internal accounts", () => {
  const out = filterEligible([{ id: "a" }, { id: "b" }], ["b"]);
  assertEquals(out.map((p) => p.id), ["a"]);
});

Deno.test("filterEligible — excludes updates:false, keeps default + true", () => {
  const out = filterEligible(
    [
      { id: "a" },
      { id: "b", email_prefs: { updates: true } },
      { id: "c", email_prefs: { updates: false } },
    ],
    [],
  );
  assertEquals(out.map((p) => p.id), ["a", "b"]);
});

Deno.test("filterEligible — internal exclusion takes precedence over opted-in", () => {
  const out = filterEligible([{ id: "a", email_prefs: { updates: true } }], new Set(["a"]));
  assertEquals(out.length, 0);
});

Deno.test("filterEligible — null email_prefs is opted in", () => {
  const out = filterEligible([{ id: "a", email_prefs: null }], []);
  assertEquals(out.map((p) => p.id), ["a"]);
});

// ---- splitAlreadySent ----
Deno.test("splitAlreadySent — partitions sent vs pending", () => {
  const { pending, skipped } = splitAlreadySent(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    ["b"],
  );
  assertEquals(pending.map((u) => u.id), ["a", "c"]);
  assertEquals(skipped, 1);
});

Deno.test("splitAlreadySent — none sent", () => {
  const { pending, skipped } = splitAlreadySent([{ id: "a" }, { id: "b" }], []);
  assertEquals(pending.map((u) => u.id), ["a", "b"]);
  assertEquals(skipped, 0);
});

Deno.test("splitAlreadySent — all sent", () => {
  const { pending, skipped } = splitAlreadySent([{ id: "a" }, { id: "b" }], ["a", "b"]);
  assertEquals(pending.length, 0);
  assertEquals(skipped, 2);
});

// ---- personalizeBody ----
Deno.test("personalizeBody — replaces all {{name}} occurrences", () => {
  assertEquals(personalizeBody("Hi {{name}}, welcome {{name}}", "Sam"), "Hi Sam, welcome Sam");
});

Deno.test("personalizeBody — falls back to 'there' on empty/null", () => {
  assertEquals(personalizeBody("Hi {{name}}", ""), "Hi there");
  assertEquals(personalizeBody("Hi {{name}}", null), "Hi there");
  assertEquals(personalizeBody("Hi {{name}}", undefined), "Hi there");
});

Deno.test("personalizeBody — no placeholder leaves body unchanged", () => {
  assertEquals(personalizeBody("Hello world", "Sam"), "Hello world");
});

// ---- buildHtmlEmail ----
Deno.test("buildHtmlEmail — embeds body and unsubscribe URL", () => {
  const out = buildHtmlEmail("Subj", "<p>my body</p>", "https://u/x");
  assertEquals(out.includes("<p>my body</p>"), true);
  assertEquals(out.includes('href="https://u/x"'), true);
  assertEquals(out.includes("Unsubscribe"), true);
  assertEquals(out.startsWith("<!DOCTYPE html>"), true);
});

Deno.test("buildHtmlEmail — standard 'Unsubscribe · Manage preferences' footer", () => {
  const out = buildHtmlEmail("Subj", "<p>b</p>", "https://u/x");
  assertEquals(out.includes("Manage preferences"), true);
  assertEquals(out.includes('href="https://wrotate.com/open"'), true);
  assertEquals(out.includes("recently joined WRotate"), false); // old reason line removed
});

// ---- unsubUrl ----
Deno.test("unsubUrl — builds the expected URL", () => {
  assertEquals(
    unsubUrl("https://x.supabase.co", "uid-1", "sig-1"),
    "https://x.supabase.co/functions/v1/email-unsubscribe?uid=uid-1&cat=updates&sig=sig-1",
  );
});

// ---- skipTable ----
Deno.test("skipTable maps known keys to tables", () => {
  assertEquals(skipTable("has_watch"), "watches");
  assertEquals(skipTable("has_log"), "logs");
  assertEquals(skipTable("has_measurement"), "timegrapher_results");
});

Deno.test("skipTable returns null for null/empty/unknown (never drops everyone)", () => {
  assertEquals(skipTable(null), null);
  assertEquals(skipTable(undefined), null);
  assertEquals(skipTable(""), null);
  assertEquals(skipTable("has_bogus"), null);
});

// ---- dropDone ----
Deno.test("dropDone removes users whose id is in doneIds, keeps the rest", () => {
  const users = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assertEquals(dropDone(users, ["b"]), [{ id: "a" }, { id: "c" }]);
  assertEquals(dropDone(users, new Set(["a", "c"])), [{ id: "b" }]);
  assertEquals(dropDone(users, []), users);
  assertEquals(dropDone(users, ["a", "b", "c"]), []);
});
