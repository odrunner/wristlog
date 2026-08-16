import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { buildReminderEmail, buildReminderPush, buildHtmlEmail, unsubUrl } from "./lib.ts";
import { buildAlertPayload, routeFor, versionAtLeast } from "./lib.ts";

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

Deno.test("versionAtLeast / routeFor — routes only for 2.6+ tokens", () => {
  assertEquals(versionAtLeast("2.6", "2.6"), true);
  assertEquals(versionAtLeast("2.10", "2.6"), true);
  assertEquals(versionAtLeast("2.5", "2.6"), false);
  assertEquals(versionAtLeast("", "2.6"), false);
  assertEquals(versionAtLeast(null, "2.6"), false);
  assertEquals(routeFor("2.5", "track", "w1", "u1"), undefined);
  assertEquals(routeFor("2.6", "track", "w1", "u1"), { w: { route: "track", id: "w1", uid: "u1" } });
});

Deno.test("buildAlertPayload — extra merges into the root, aps untouched", () => {
  const p = buildAlertPayload({ title: "T", body: "B" }, { w: { route: "measure", id: "x", uid: "u" } }) as Record<string, unknown>;
  assertEquals((p.aps as Record<string, unknown>).badge, 1);
  assertEquals((p.w as Record<string, unknown>).route, "measure");
  assertEquals("w" in (buildAlertPayload({ title: "T", body: "B" }) as Record<string, unknown>), false);
});
