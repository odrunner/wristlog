import { assertEquals } from "jsr:@std/assert";
import {
  base64UrlEncode,
  buildEmailContent,
  buildHtmlEmail,
  buildUnsubUrl,
  commentQuote,
  DEFAULT_PREFS,
  esc,
  isValidRecord,
  resolveActorName,
  shouldFetchCommentBody,
  TYPE_TO_CATEGORY,
} from "./lib.ts";

Deno.test("TYPE_TO_CATEGORY — maps known types and omits hearts", () => {
  assertEquals(TYPE_TO_CATEGORY["comment"], "comments");
  assertEquals(TYPE_TO_CATEGORY["mention"], "mentions");
  assertEquals(TYPE_TO_CATEGORY["follow"], "friends");
  assertEquals(TYPE_TO_CATEGORY["club_invite"], "clubs");
  // hearts are intentionally excluded
  assertEquals(TYPE_TO_CATEGORY["like"], undefined);
  assertEquals(TYPE_TO_CATEGORY["comment_like"], undefined);
});

Deno.test("DEFAULT_PREFS — matches DB defaults (clubs off)", () => {
  assertEquals(DEFAULT_PREFS, { comments: true, mentions: true, clubs: false, friends: true });
});

Deno.test("isValidRecord — requires user_id and type", () => {
  assertEquals(isValidRecord({ user_id: "u", type: "comment" }), true);
  assertEquals(isValidRecord({ user_id: "u" }), false);
  assertEquals(isValidRecord({ type: "comment" }), false);
  assertEquals(isValidRecord({}), false);
  assertEquals(isValidRecord(null), false);
  assertEquals(isValidRecord(undefined), false);
});

Deno.test("esc — escapes HTML-significant characters", () => {
  assertEquals(esc(`<a href="x">a & b</a>`), "&lt;a href=&quot;x&quot;&gt;a &amp; b&lt;/a&gt;");
});

Deno.test("esc — leaves plain text unchanged", () => {
  assertEquals(esc("hello world"), "hello world");
});

Deno.test("commentQuote — escapes content inside the blockquote", () => {
  const out = commentQuote("<script>");
  assertEquals(out.includes("&lt;script&gt;"), true);
  assertEquals(out.includes("<script>"), false);
});

Deno.test("commentQuote — short text is not truncated (no ellipsis)", () => {
  const out = commentQuote("nice watch");
  assertEquals(out.includes("nice watch"), true);
  assertEquals(out.includes("…"), false);
});

Deno.test("commentQuote — truncates over 300 chars with ellipsis", () => {
  const long = "a".repeat(301);
  const out = commentQuote(long);
  // 300 'a' chars followed by the ellipsis
  assertEquals(out.includes("a".repeat(300) + "…"), true);
  assertEquals(out.includes("a".repeat(301)), false);
});

Deno.test("commentQuote — exactly 300 chars is not truncated", () => {
  const exact = "b".repeat(300);
  const out = commentQuote(exact);
  assertEquals(out.includes("b".repeat(300)), true);
  assertEquals(out.includes("…"), false);
});

Deno.test("buildEmailContent — comment includes name, post phrase, and quote", () => {
  const out = buildEmailContent("comment", "Alice", "love it");
  assertEquals(out?.subject, "Alice commented on your post");
  assertEquals(out?.body.startsWith("Alice commented on your post:"), true);
  assertEquals(out!.body.includes("love it"), true);
});

Deno.test("buildEmailContent — comment without body has empty quote", () => {
  const out = buildEmailContent("comment", "Alice");
  assertEquals(out?.body, "Alice commented on your post:");
});

Deno.test("buildEmailContent — covers each non-quote type", () => {
  assertEquals(buildEmailContent("follow", "Bob")?.subject, "Bob started following you");
  assertEquals(buildEmailContent("follow_request", "Bob")?.subject, "Bob wants to follow you");
  assertEquals(buildEmailContent("follow_accepted", "Bob")?.subject, "Bob accepted your follow request");
  assertEquals(buildEmailContent("friend_request", "Bob")?.subject, "Bob sent a close friend request");
  assertEquals(buildEmailContent("friend_accepted", "Bob")?.subject, "Bob accepted your friend request");
  assertEquals(buildEmailContent("club_invite", "Bob")?.subject, "Bob invited you to a club");
  assertEquals(buildEmailContent("club_join_request", "Bob")?.subject, "Bob wants to join your club");
  assertEquals(buildEmailContent("club_join_accepted", "Bob")?.subject, "Bob approved your club request");
  assertEquals(buildEmailContent("club_promoted", "Bob")?.subject, "You were promoted in a club");
  assertEquals(buildEmailContent("mention", "Bob")?.subject, "Bob mentioned you");
  assertEquals(buildEmailContent("comment_also", "Bob")?.subject, "Bob also commented");
});

Deno.test("buildEmailContent — unknown type returns null", () => {
  assertEquals(buildEmailContent("like", "Bob"), null);
  assertEquals(buildEmailContent("", "Bob"), null);
});

Deno.test("resolveActorName — prefers display_name, then username, then Someone", () => {
  assertEquals(resolveActorName({ display_name: "Dave", username: "d123" }), "Dave");
  assertEquals(resolveActorName({ display_name: null, username: "d123" }), "d123");
  assertEquals(resolveActorName({ display_name: "", username: "" }), "Someone");
  assertEquals(resolveActorName(null), "Someone");
  assertEquals(resolveActorName(undefined), "Someone");
});

Deno.test("resolveActorName — escapes HTML in the name", () => {
  assertEquals(resolveActorName({ display_name: "<b>X</b>" }), "&lt;b&gt;X&lt;/b&gt;");
});

Deno.test("shouldFetchCommentBody — true only for comment-like types with refs", () => {
  assertEquals(shouldFetchCommentBody("comment", "ref1", "actor1"), true);
  assertEquals(shouldFetchCommentBody("comment_also", "ref1", "actor1"), true);
  assertEquals(shouldFetchCommentBody("mention", "ref1", "actor1"), true);
  // wrong type
  assertEquals(shouldFetchCommentBody("follow", "ref1", "actor1"), false);
  // missing refs
  assertEquals(shouldFetchCommentBody("comment", null, "actor1"), false);
  assertEquals(shouldFetchCommentBody("comment", "ref1", null), false);
  assertEquals(shouldFetchCommentBody("comment", undefined, undefined), false);
});

Deno.test("buildUnsubUrl — assembles the signed unsubscribe link", () => {
  assertEquals(
    buildUnsubUrl("https://x.supabase.co", "uid1", "friends", "sigABC"),
    "https://x.supabase.co/functions/v1/email-unsubscribe?uid=uid1&cat=friends&sig=sigABC",
  );
});

Deno.test("base64UrlEncode — produces URL-safe base64 without padding", () => {
  // 0xFB 0xFF -> standard base64 "+/8=" -> url-safe "-_8"
  assertEquals(base64UrlEncode(new Uint8Array([0xFB, 0xFF])), "-_8");
  assertEquals(base64UrlEncode(new Uint8Array([])), "");
});

Deno.test("buildHtmlEmail — embeds subject and body", () => {
  const html = buildHtmlEmail("My Subject", "My Body");
  assertEquals(html.includes("My Subject"), true);
  assertEquals(html.includes("My Body"), true);
});

Deno.test("buildHtmlEmail — with unsubUrl renders an Unsubscribe link", () => {
  const html = buildHtmlEmail("S", "B", "https://x/unsub");
  assertEquals(html.includes(`href="https://x/unsub"`), true);
  assertEquals(html.includes("Unsubscribe"), true);
});

Deno.test("buildHtmlEmail — without unsubUrl uses the fallback footer text", () => {
  const html = buildHtmlEmail("S", "B");
  assertEquals(html.includes("Profile &rarr; Notifications"), true);
  assertEquals(html.includes(">Unsubscribe<"), false);
});
