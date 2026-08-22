import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildCommentEmail, cleanText, commentsSectionHtml, hashIp, isHoneypotTripped, isRateLimited,
  rateKeys, relativeTime, resolveIp, validateComment, windowStartIso,
} from "./share-comments-lib.ts";

Deno.test("cleanText strips control chars, keeps newlines, trims", () => {
  assertEquals(cleanText("  hi there\n\nok  "), "hi there\n\nok");
  const ctl = "a" + String.fromCharCode(1) + "b" + String.fromCharCode(7) + "c";
  assertEquals(cleanText(ctl), "a b c");
  assertEquals(cleanText("x\n\n\n\n\ny"), "x\n\ny");
  assertEquals(cleanText(null), "");
  assertEquals(cleanText(42), "42");
});

Deno.test("validateComment accepts a normal comment and returns cleaned fields", () => {
  const r = validateComment({ name: "  Sarah ", body: " Love the Daytona!\n" });
  assertEquals(r, { ok: true, name: "Sarah", body: "Love the Daytona!" });
});

Deno.test("validateComment rejects empty name/body and over-long fields with a reason", () => {
  assertEquals(validateComment({ name: "", body: "x" }), { ok: false, reason: "Please add your name" });
  assertEquals(validateComment({ name: "A", body: "   " }), { ok: false, reason: "Please write a comment" });
  assertEquals(validateComment({ name: "a".repeat(41), body: "x" }), { ok: false, reason: "Name is too long (40 characters max)" });
  assertEquals(validateComment({ name: "A", body: "x".repeat(501) }), { ok: false, reason: "Comment is too long (500 characters max)" });
  assertEquals(validateComment({}), { ok: false, reason: "Please add your name" });
});

Deno.test("honeypot: any non-empty value trips it", () => {
  assertEquals(isHoneypotTripped(""), false);
  assertEquals(isHoneypotTripped(undefined), false);
  assertEquals(isHoneypotTripped("   "), false);
  assertEquals(isHoneypotTripped("http://spam"), true);
});

Deno.test("resolveIp prefers x-forwarded-for's first hop, then cf-connecting-ip, else unknown", () => {
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  assertEquals(resolveIp(h({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "1.2.3.4");
  assertEquals(resolveIp(h({ "cf-connecting-ip": "9.9.9.9" })), "9.9.9.9");
  assertEquals(resolveIp(h({})), "unknown");
});

Deno.test("hashIp is stable, hex, and null for unknown", async () => {
  const a = await hashIp("1.2.3.4"), b = await hashIp("1.2.3.4");
  assertEquals(a, b);
  assert(/^[0-9a-f]{64}$/.test(a!));
  assertEquals(await hashIp("unknown"), null);
  assertEquals(await hashIp(""), null);
});

Deno.test("rateKeys are namespaced per token and per ip hash", () => {
  assertEquals(rateKeys("tok1", "abc"), {
    ip: "share-comment:ip:abc", token: "share-comment:token:tok1", email: "share-comment-email:tok1",
  });
  assertEquals(rateKeys("tok1", null).ip, "share-comment:ip:unknown");
});

Deno.test("isRateLimited: in-window and at limit is limited; stale window is not", () => {
  const now = 1_000_000_000_000;
  const ws = windowStartIso(now, 3_600_000);
  assertEquals(isRateLimited({ request_count: 10, window_start: new Date(now).toISOString() }, ws, 10), true);
  assertEquals(isRateLimited({ request_count: 9, window_start: new Date(now).toISOString() }, ws, 10), false);
  assertEquals(isRateLimited({ request_count: 99, window_start: new Date(now - 7_200_000).toISOString() }, ws, 10), false);
  assertEquals(isRateLimited(null, ws, 10), false);
});

Deno.test("relativeTime buckets", () => {
  const now = Date.parse("2026-08-22T12:00:00Z");
  assertEquals(relativeTime("2026-08-22T11:59:40Z", now), "just now");
  assertEquals(relativeTime("2026-08-22T11:55:00Z", now), "5 min ago");
  assertEquals(relativeTime("2026-08-22T09:00:00Z", now), "3 h ago");
  assertEquals(relativeTime("2026-08-20T12:00:00Z", now), "2 d ago");
  assertEquals(relativeTime("2026-07-01T12:00:00Z", now), "2026-07-01");
  assertEquals(relativeTime("garbage", now), "");
});

Deno.test("commentsSectionHtml escapes comments, renders the form, and says the thread is public", () => {
  const now = Date.parse("2026-08-22T12:00:00Z");
  const html = commentsSectionHtml("wishlist", "tok<1>", [
    { id: "c1", name: "<b>Sarah</b>", body: "Love it & want it", created_at: "2026-08-22T11:55:00Z" },
  ], now);
  assertStringIncludes(html, "&lt;b&gt;Sarah&lt;/b&gt;");
  assertStringIncludes(html, "Love it &amp; want it");
  assertStringIncludes(html, "5 min ago");
  assertStringIncludes(html, 'name="hp"');
  assertStringIncludes(html, "Visible to everyone who has this link");
  assertStringIncludes(html, 'data-token="tok&lt;1&gt;"');
  assertStringIncludes(html, "Comments (1)");
  assertEquals(html.includes("<b>Sarah</b>"), false);
});

Deno.test("commentsSectionHtml with no comments still renders the form and an empty-state line", () => {
  const html = commentsSectionHtml("collection", "t", [], 0);
  assertStringIncludes(html, "No comments yet");
  assertStringIncludes(html, 'id="sc-form"');
  assertEquals(html.includes("Comments ("), false);
});

Deno.test("buildCommentEmail: we-voice, escaped content, CTA to /open, unsubscribe link, kind-specific subject", () => {
  const { subject, html } = buildCommentEmail("collection", { name: "Sa<ra>h", body: "Is the GMT available?" }, "For the insurer", "https://u/unsub");
  assertEquals(subject, "New comment on your shared watches");
  assertStringIncludes(html, "Sa&lt;ra&gt;h");
  assertStringIncludes(html, "Is the GMT available?");
  assertStringIncludes(html, "For the insurer");
  assertStringIncludes(html, 'href="https://wrotate.com/open');
  assertStringIncludes(html, 'href="https://u/unsub"');
  assertEquals(buildCommentEmail("wishlist", { name: "A", body: "b" }, null, "u").subject, "New comment on your shared wishlist");
  assertStringIncludes(buildCommentEmail("wishlist", { name: "A", body: "b" }, null, "u").html, "a wishlist link you shared");
  assertEquals(/Ozgur|founder/i.test(html), false);
});
