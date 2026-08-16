import { assertEquals, assertNotEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  CATEGORY_LABELS,
  applyUnsubscribe,
  categoryLabel,
  hmacSign,
  renderPage,
  unsubscribeKeys,
  verifyHmac,
  verifyHmacAny,
} from "./lib.ts";

// ---- categoryLabel ----

Deno.test("categoryLabel — known categories", () => {
  assertEquals(categoryLabel("comments"), "Comments & replies");
  assertEquals(categoryLabel("mentions"), "Mentions");
  assertEquals(categoryLabel("friends"), "Follows & friend requests");
  assertEquals(categoryLabel("clubs"), "Clubs");
  assertEquals(categoryLabel("updates"), "Updates & new features");
  assertEquals(categoryLabel("all"), "All emails");
});

Deno.test("categoryLabel — unknown category falls back to raw value", () => {
  assertEquals(categoryLabel("weird"), "weird");
  assertEquals(CATEGORY_LABELS.comments, "Comments & replies");
});

// ---- hmacSign / verifyHmac ----

Deno.test("hmacSign — deterministic for same inputs", async () => {
  const a = await hmacSign("user-1", "comments", "secret-key");
  const b = await hmacSign("user-1", "comments", "secret-key");
  assertEquals(a, b);
});

Deno.test("hmacSign — base64url safe (no + / =)", async () => {
  const sig = await hmacSign("user-1", "all", "another-secret-key-value");
  assertEquals(/[+/=]/.test(sig), false);
});

Deno.test("hmacSign — differs by uid, cat, and key", async () => {
  const base = await hmacSign("user-1", "comments", "key");
  assertNotEquals(base, await hmacSign("user-2", "comments", "key"));
  assertNotEquals(base, await hmacSign("user-1", "mentions", "key"));
  assertNotEquals(base, await hmacSign("user-1", "comments", "key2"));
});

Deno.test("verifyHmac — accepts a valid signature", async () => {
  const sig = await hmacSign("uid-x", "clubs", "k");
  assertEquals(await verifyHmac("uid-x", "clubs", sig, "k"), true);
});

Deno.test("verifyHmac — rejects tampered signature / wrong params", async () => {
  const sig = await hmacSign("uid-x", "clubs", "k");
  assertEquals(await verifyHmac("uid-x", "clubs", sig + "x", "k"), false);
  assertEquals(await verifyHmac("uid-y", "clubs", sig, "k"), false);
  assertEquals(await verifyHmac("uid-x", "friends", sig, "k"), false);
  assertEquals(await verifyHmac("uid-x", "clubs", sig, "wrongkey"), false);
});

// ---- applyUnsubscribe ----

Deno.test("applyUnsubscribe — single category disables only that key", () => {
  const prefs = { comments: true, mentions: true };
  const out = applyUnsubscribe(prefs, "comments");
  assertEquals(out.comments, false);
  assertEquals(out.mentions, true);
});

Deno.test("applyUnsubscribe — single category adds key if absent", () => {
  const out = applyUnsubscribe({}, "updates");
  assertEquals(out.updates, false);
});

Deno.test("applyUnsubscribe — 'all' disables every category", () => {
  const out = applyUnsubscribe({ comments: true, mentions: true, friends: true, clubs: true, updates: true, reminders: true }, "all");
  assertEquals(out, { comments: false, mentions: false, friends: false, clubs: false, updates: false, reminders: false, digest: false });
});

Deno.test("applyUnsubscribe — mutates and returns the same object", () => {
  const prefs = { comments: true };
  const out = applyUnsubscribe(prefs, "comments");
  assertEquals(out === prefs, true);
});

Deno.test("applyUnsubscribe — reminders sets email_prefs.reminders=false", () => {
  assertEquals(applyUnsubscribe({}, "reminders").reminders, false);
});

Deno.test("applyUnsubscribe — all also clears reminders", () => {
  assertEquals(applyUnsubscribe({}, "all").reminders, false);
});

Deno.test("CATEGORY_LABELS has a reminders label", () => {
  assertEquals(typeof CATEGORY_LABELS.reminders, "string");
});

// ---- renderPage ----

Deno.test("renderPage — embeds title and body", () => {
  const html = renderPage("Unsubscribed", "<h1>Done</h1>");
  assertStringIncludes(html, "<title>Unsubscribed — WRotate</title>");
  assertStringIncludes(html, "<h1>Done</h1>");
  assertStringIncludes(html, "WRotate");
  assertStringIncludes(html, "<!DOCTYPE html>");
});

// ── Signing-key transition (audit S4) ────────────────────────────────────────
// Links were signed with SUPABASE_SERVICE_ROLE_KEY. Rotating that key — a routine
// security action — would have invalidated the unsubscribe link in every email
// already delivered, and a broken unsubscribe is a compliance problem. A dedicated
// secret decouples them; the verifier accepts both so there is no flag day.

Deno.test("unsubscribeKeys — prefers the dedicated secret, keeps the fallback", () => {
  const env: Record<string, string> = {
    UNSUBSCRIBE_HMAC_SECRET: "dedicated",
    SUPABASE_SERVICE_ROLE_KEY: "service",
  };
  assertEquals(unsubscribeKeys((k) => env[k]), ["dedicated", "service"]);
});

Deno.test("unsubscribeKeys — before the secret is set, behaviour is unchanged", () => {
  const env: Record<string, string> = { SUPABASE_SERVICE_ROLE_KEY: "service" };
  assertEquals(unsubscribeKeys((k) => env[k]), ["service"]);
});

Deno.test("verifyHmacAny — a link signed with the OLD key still works after the switch", async () => {
  const old = await hmacSign("u1", "updates", "service");
  assertEquals(await verifyHmacAny("u1", "updates", old, ["dedicated", "service"]), true);
});

Deno.test("verifyHmacAny — a link signed with the NEW key verifies", async () => {
  const sig = await hmacSign("u1", "updates", "dedicated");
  assertEquals(await verifyHmacAny("u1", "updates", sig, ["dedicated", "service"]), true);
});

Deno.test("verifyHmacAny — once the fallback is dropped, old links stop working", async () => {
  // The point of the transition window: this is what happens after the service-role
  // key is removed from the accepted list, so it must be a deliberate step.
  const old = await hmacSign("u1", "updates", "service");
  assertEquals(await verifyHmacAny("u1", "updates", old, ["dedicated"]), false);
});

Deno.test("verifyHmacAny — a forged signature is rejected by every key", async () => {
  assertEquals(await verifyHmacAny("u1", "updates", "not-a-signature", ["dedicated", "service"]), false);
});

Deno.test("verifyHmacAny — a signature for a DIFFERENT category is rejected", async () => {
  const sig = await hmacSign("u1", "reminders", "dedicated");
  assertEquals(await verifyHmacAny("u1", "updates", sig, ["dedicated", "service"]), false);
});

Deno.test("verifyHmacAny — a signature for a DIFFERENT user is rejected", async () => {
  const sig = await hmacSign("u2", "updates", "dedicated");
  assertEquals(await verifyHmacAny("u1", "updates", sig, ["dedicated", "service"]), false);
});
