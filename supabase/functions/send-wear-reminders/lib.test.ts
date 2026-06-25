import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { buildReminderEmail, buildReminderPush, buildHtmlEmail, unsubUrl } from "./lib.ts";

Deno.test("buildReminderPush — fixed nudge with WRotate title", () => {
  const m = buildReminderPush();
  assertEquals(m.title, "WRotate");
  assertStringIncludes(m.body, "What did you wear today");
});

Deno.test("buildReminderEmail — subject + body", () => {
  const e = buildReminderEmail();
  assertStringIncludes(e.subject, "wrist");
  assertStringIncludes(e.body, "Log");
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
