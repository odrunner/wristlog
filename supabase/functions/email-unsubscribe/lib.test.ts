import { assertEquals, assertNotEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  applyUnsubscribe,
  CATEGORY_LABELS,
  categoryLabel,
  hmacSign,
  renderPage,
  verifyHmac,
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
  const out = applyUnsubscribe({ comments: true, mentions: true, friends: true, clubs: true, updates: true }, "all");
  assertEquals(out, { comments: false, mentions: false, friends: false, clubs: false, updates: false });
});

Deno.test("applyUnsubscribe — mutates and returns the same object", () => {
  const prefs = { comments: true };
  const out = applyUnsubscribe(prefs, "comments");
  assertEquals(out === prefs, true);
});

// ---- renderPage ----

Deno.test("renderPage — embeds title and body", () => {
  const html = renderPage("Unsubscribed", "<h1>Done</h1>");
  assertStringIncludes(html, "<title>Unsubscribed — WRotate</title>");
  assertStringIncludes(html, "<h1>Done</h1>");
  assertStringIncludes(html, "WRotate");
  assertStringIncludes(html, "<!DOCTYPE html>");
});
