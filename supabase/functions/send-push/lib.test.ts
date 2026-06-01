import { assertEquals } from "jsr:@std/assert";
import {
  apnsDeviceUrl,
  apnsHost,
  base64UrlEncode,
  base64UrlEncodeBytes,
  buildAlertPayload,
  buildMessage,
  isValidRecord,
  resolveActorName,
  stripPemArmor,
} from "./lib.ts";

Deno.test("isValidRecord — requires user_id and type", () => {
  assertEquals(isValidRecord({ user_id: "u", type: "like" }), true);
  assertEquals(isValidRecord({ user_id: "u" }), false);
  assertEquals(isValidRecord({ type: "like" }), false);
  assertEquals(isValidRecord(null), false);
  assertEquals(isValidRecord(undefined), false);
});

Deno.test("resolveActorName — prefers display_name, then username, then Someone", () => {
  assertEquals(resolveActorName({ display_name: "Eve", username: "e1" }), "Eve");
  assertEquals(resolveActorName({ display_name: null, username: "e1" }), "e1");
  assertEquals(resolveActorName({ display_name: "", username: "" }), "Someone");
  assertEquals(resolveActorName(null), "Someone");
  assertEquals(resolveActorName(undefined), "Someone");
});

Deno.test("resolveActorName — does NOT escape HTML (push is plain text)", () => {
  assertEquals(resolveActorName({ display_name: "<b>X</b>" }), "<b>X</b>");
});

Deno.test("buildMessage — title is always WRotate", () => {
  assertEquals(buildMessage("like", "A")?.title, "WRotate");
  assertEquals(buildMessage("anything", "A")?.title, "WRotate");
});

Deno.test("buildMessage — known types", () => {
  assertEquals(buildMessage("like", "A")?.body, "A liked your post");
  assertEquals(buildMessage("comment", "A")?.body, "A commented on your post");
  assertEquals(buildMessage("follow", "A")?.body, "A started following you");
  assertEquals(buildMessage("follow_request", "A")?.body, "A requested to follow you");
  assertEquals(buildMessage("follow_accepted", "A")?.body, "A accepted your follow request");
  assertEquals(buildMessage("friend_request", "A")?.body, "A sent you a close friend request");
  assertEquals(buildMessage("friend_accepted", "A")?.body, "A accepted your close friend request");
  assertEquals(buildMessage("club_invite", "A")?.body, "A invited you to join a club");
  assertEquals(buildMessage("club_join_request", "A")?.body, "A wants to join your club");
  assertEquals(buildMessage("club_join_accepted", "A")?.body, "A approved your club request");
  assertEquals(buildMessage("mention", "A")?.body, "A mentioned you");
  assertEquals(buildMessage("comment_like", "A")?.body, "A liked your comment");
});

Deno.test("buildMessage — unknown type falls back to generic body", () => {
  assertEquals(buildMessage("zzz", "A")?.body, "A sent you a notification");
  assertEquals(buildMessage("", "A")?.body, "A sent you a notification");
});

Deno.test("buildAlertPayload — shapes the aps payload", () => {
  assertEquals(buildAlertPayload({ title: "T", body: "B" }), {
    aps: { alert: { title: "T", body: "B" }, sound: "default", badge: 1 },
  });
});

Deno.test("apnsHost — production vs sandbox", () => {
  assertEquals(apnsHost(false), "https://api.push.apple.com");
  assertEquals(apnsHost(true), "https://api.sandbox.push.apple.com");
});

Deno.test("apnsDeviceUrl — builds the device path", () => {
  assertEquals(
    apnsDeviceUrl("https://api.push.apple.com", "abc123"),
    "https://api.push.apple.com/3/device/abc123",
  );
});

Deno.test("base64UrlEncode — URL-safe, no padding", () => {
  // JSON header used in the JWT
  const header = JSON.stringify({ alg: "ES256", kid: "K" });
  const enc = base64UrlEncode(header);
  assertEquals(/[+/=]/.test(enc), false);
  // round-trips back to the original string
  assertEquals(atob(enc.replace(/-/g, "+").replace(/_/g, "/")), header);
});

Deno.test("base64UrlEncodeBytes — URL-safe encoding of raw bytes", () => {
  // 0xFB 0xFF -> "+/8=" -> url-safe "-_8"
  assertEquals(base64UrlEncodeBytes(new Uint8Array([0xFB, 0xFF])), "-_8");
  assertEquals(base64UrlEncodeBytes(new Uint8Array([])), "");
});

Deno.test("stripPemArmor — removes header/footer and whitespace", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nABCD\nEFGH\n-----END PRIVATE KEY-----\n";
  assertEquals(stripPemArmor(pem), "ABCDEFGH");
});

Deno.test("stripPemArmor — bare base64 passes through unchanged", () => {
  assertEquals(stripPemArmor("ABCDEFGH"), "ABCDEFGH");
});
