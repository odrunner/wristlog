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
  assertEquals(routeFor("ios", "2.5", "track", "w1", "u1"), undefined);
  assertEquals(routeFor("ios", "2.6", "track", "w1", "u1"), { w: { route: "track", id: "w1", uid: "u1" } });
  // Android: every token that can exist belongs to a push-capable build — route always attaches,
  // whatever the (Play-line) version says.
  assertEquals(routeFor("android", "1.2", "track", "w1", "u1"), { w: { route: "track", id: "w1", uid: "u1" } });
  assertEquals(routeFor("android", null, "track", "w1", "u1"), { w: { route: "track", id: "w1", uid: "u1" } });
});

Deno.test("buildAlertPayload — extra merges into the root, aps untouched", () => {
  const p = buildAlertPayload({ title: "T", body: "B" }, { w: { route: "measure", id: "x", uid: "u" } }) as Record<string, unknown>;
  assertEquals((p.aps as Record<string, unknown>).badge, 1);
  assertEquals((p.w as Record<string, unknown>).route, "measure");
  assertEquals("w" in (buildAlertPayload({ title: "T", body: "B" }) as Record<string, unknown>), false);
});

// ── applyBounceFilter (audit N6) ─────────────────────────────────────────────
// The bounce lookup used to be the run's single point of failure: one thrown
// error 500'd the hour, pushes included. The filter now takes `null` to mean
// "lookup failed" and fails CLOSED for the email channel only — no email goes
// out without bounce data (a re-send to a suppressed address charges the SES
// reputation that gates the whole account), pushes are untouched, and
// provisional-token users keep their quiet-push fallback so a skipped row
// still writes a ledger entry and the user isn't silently dropped forever.
import { applyBounceFilter } from "./lib.ts";

const T = (channel: string, email: string | null, push_quiet = false) =>
  ({ user_id: "u", channel, email, push_quiet, local_today: "2026-11-06" });

Deno.test("applyBounceFilter — clean lookup: bounced email dropped, quiet-push fallback kept", () => {
  const rows = applyBounceFilter(
    [T("email", "dead@x.com"), T("email", "Dead2@X.com ", true), T("email", "ok@x.com"), T("push", null)],
    new Set(["dead@x.com", "dead2@x.com"]),
  );
  assertEquals(rows.map((r) => [r.channel, r.email]), [
    ["push", "Dead2@X.com "],   // suppressed + provisional token -> quiet push
    ["email", "ok@x.com"],
    ["push", null],
  ]);
});

Deno.test("applyBounceFilter — lookup failed (null): emails fail closed, pushes untouched", () => {
  const rows = applyBounceFilter(
    [T("email", "ok@x.com"), T("email", "prov@x.com", true), T("push", null)],
    null,
  );
  assertEquals(rows.map((r) => [r.channel, r.email]), [
    ["push", "prov@x.com"],     // no bounce data -> same fallback as suppressed
    ["push", null],
  ]);
});

Deno.test("applyBounceFilter — empty set keeps everyone", () => {
  const input = [T("email", "a@x.com"), T("push", null)];
  assertEquals(applyBounceFilter(input, new Set()), input);
});

// ---- languages ----
import { WEAR_STRINGS } from "./strings.ts";
import { LANGS } from "../_shared/lang.ts";

Deno.test("wear reminder — every language names the watch, leaves no hole, and is translated", () => {
  const w = { brand: "Seiko", name: "SKX007" };
  for (const lang of LANGS) {
    const texts = [buildReminderPush(w, lang).body, buildReminderPush(null, lang).body,
      buildReminderEmail(w, lang).subject, buildReminderEmail(w, lang).body, buildReminderEmail(null, lang).body];
    for (const x of texts) assertEquals(/[{}]/.test(x), false, `${lang}: leftover hole in "${x}"`);
    assertEquals(buildReminderPush(w, lang).body.includes("Seiko SKX007"), true);
    assertEquals(buildReminderEmail(w, lang).body.includes("Seiko SKX007"), true);
    if (lang !== "en") assertEquals(buildReminderEmail(w, lang).subject === WEAR_STRINGS.en.subject, false);
  }
  assertEquals(buildReminderPush(w), buildReminderPush(w, "en"));
});

Deno.test("wear reminder email shell — button and footer follow the language", () => {
  const de = buildHtmlEmail("s", "b", "https://u", "de");
  assertEquals(de.includes(">WRotate öffnen</a>"), true);
  assertEquals(de.includes(">Abmelden</a>"), true);
  assertEquals(buildHtmlEmail("s", "b", "https://u"), buildHtmlEmail("s", "b", "https://u", "en"));
});
