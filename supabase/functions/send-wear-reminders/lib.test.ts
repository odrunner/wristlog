import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { buildReminderEmail, buildReminderPush, buildHtmlEmail, unsubUrl } from "./lib.ts";

Deno.test("buildReminderPush — names the last-worn watch when known", () => {
  const m = buildReminderPush({ brand: "Omega", name: "Seamaster" });
  assertEquals(m.title, "WRotate");
  assertEquals(m.body, "Wearing the Omega Seamaster again today? Tap to log it — or pick another watch.");
});

Deno.test("buildReminderPush — generic nudge when no watch is known", () => {
  assertStringIncludes(buildReminderPush(null).body, "What did you wear today");
  assertStringIncludes(buildReminderPush().body, "What did you wear today");
  assertStringIncludes(buildReminderPush({ brand: "", name: "" }).body, "What did you wear today");
});

Deno.test("buildReminderEmail — names the watch, keeps the generic subject", () => {
  const e = buildReminderEmail({ brand: "Omega", name: "Seamaster" });
  assertStringIncludes(e.subject, "wrist");
  assertStringIncludes(e.body, "Omega Seamaster");
  assertStringIncludes(buildReminderEmail(null).body, "Log");
});

Deno.test("unsubUrl — carries uid + cat=reminders", () => {
  const u = unsubUrl("https://api.wrotate.com", "uid-1", "sig-1", "reminders");
  assertStringIncludes(u, "uid=uid-1");
  assertStringIncludes(u, "cat=reminders");
});

Deno.test("buildHtmlEmail — wraps subject, body, unsub link", () => {
  const html = buildHtmlEmail("Hi", "Body here", "https://x/unsub");
  assertStringIncludes(html, "Body here");
  assertStringIncludes(html, "https://x/unsub");
});
