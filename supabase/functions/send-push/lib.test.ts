import { assertEquals } from "jsr:@std/assert";
import {
  apnsDeviceUrl,
  apnsHost,
  base64UrlEncode,
  base64UrlEncodeBytes,
  buildAlertPayload,
  buildMessage,
  buildRoute,
  isDeadToken,
  isValidRecord,
  parseApnsReason,
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
  // comment_also is the third-most-common notification type. It fell through to
  // the generic "sent you a notification" body, which reads as a direct
  // interaction the actor never made. Wording matches the bell panel.
  assertEquals(
    buildMessage("comment_also", "A")?.body,
    "A also commented on a post you liked or commented on",
  );
});

// A `system` row is the auto-add-brand confirmation: actor-less, with the brand
// name in ref_id. Without the ref it pushed "Someone sent you a notification".
Deno.test("buildMessage — system names the brand that was added", () => {
  assertEquals(
    buildMessage("system", "Someone", "Aviator")?.body,
    'Your requested brand "Aviator" has been added to WRotate!',
  );
  // A system row with no brand has nothing to say — skip the push rather than
  // deliver an empty one. (No such row exists; this is the safety net.)
  assertEquals(buildMessage("system", "Someone"), null);
  assertEquals(buildMessage("system", "Someone", ""), null);
});

Deno.test("buildMessage — unknown type falls back to generic body", () => {
  assertEquals(buildMessage("zzz", "A")?.body, "A sent you a notification");
  assertEquals(buildMessage("", "A")?.body, "A sent you a notification");
});

Deno.test("buildAlertPayload — shapes the aps payload", () => {
  assertEquals(buildAlertPayload({ title: "T", body: "B" }), {
    aps: { alert: { title: "T", body: "B" }, sound: "default" },
  });
});

Deno.test("buildAlertPayload — carries the real unread count, not a hardcoded 1", () => {
  const p = buildAlertPayload({ title: "T", body: "B" }, { badge: 7 });
  assertEquals((p.aps as Record<string, unknown>).badge, 7);
});

Deno.test("buildAlertPayload — a zero count clears the icon badge", () => {
  const p = buildAlertPayload({ title: "T", body: "B" }, { badge: 0 });
  assertEquals((p.aps as Record<string, unknown>).badge, 0);
});

Deno.test("buildAlertPayload — omits badge when the count is unknown", () => {
  // APNs leaves the icon untouched when the key is absent. Guessing would be
  // worse than saying nothing.
  for (const badge of [null, undefined, NaN]) {
    const p = buildAlertPayload({ title: "T", body: "B" }, { badge });
    assertEquals("badge" in (p.aps as Record<string, unknown>), false);
  }
});

Deno.test("buildAlertPayload — attaches routing data for the tap", () => {
  const p = buildAlertPayload({ title: "T", body: "B" }, {
    badge: 2,
    route: { route: "post", id: "log-1" },
    userId: "user-1",
    notifId: "notif-1",
    type: "like",
  });
  assertEquals(p.w, {
    route: "post",
    id: "log-1",
    uid: "user-1",
    n: "notif-1",
    t: "like",
  });
});

Deno.test("buildRoute — post types route to the post", () => {
  for (const t of ["like", "comment", "comment_also", "comment_like", "mention"]) {
    assertEquals(buildRoute(t, "log-1", "actor-1"), { route: "post", id: "log-1" });
  }
});

Deno.test("buildRoute — people types route to the actor's profile", () => {
  for (const t of ["follow", "follow_accepted", "friend_accepted"]) {
    assertEquals(buildRoute(t, "log-1", "actor-1"), { route: "profile", id: "actor-1" });
  }
});

Deno.test("buildRoute — club types route to the club", () => {
  for (const t of ["club_join_accepted", "club_promoted"]) {
    assertEquals(buildRoute(t, "club-1", "actor-1"), { route: "club", id: "club-1" });
  }
});

Deno.test("buildRoute — request types go to the bell, where they can be actioned", () => {
  // These render Accept/Decline buttons and have no click target in the panel.
  for (const t of ["follow_request", "friend_request", "club_invite", "club_join_request", "system"]) {
    assertEquals(buildRoute(t, "ref-1", "actor-1"), { route: "bell", id: null });
  }
});

Deno.test("buildRoute — badges route to the badge wall", () => {
  assertEquals(buildRoute("badge_earned", null, null), { route: "badges", id: null });
});

Deno.test("buildRoute — falls back to the bell when the target is missing", () => {
  // A route with no id would open nothing — exactly the dead tap we're fixing.
  assertEquals(buildRoute("like", null, "actor-1"), { route: "bell", id: null });
  assertEquals(buildRoute("follow", "log-1", null), { route: "bell", id: null });
  assertEquals(buildRoute("club_invite", null, null), { route: "bell", id: null });
  assertEquals(buildRoute("system", null, null), { route: "bell", id: null });
  assertEquals(buildRoute("something_new", null, null), { route: "bell", id: null });
});

Deno.test("isDeadToken — prunes permanent rejections only", () => {
  assertEquals(isDeadToken(410, "Unregistered"), true);
  assertEquals(isDeadToken(410, null), true);
  // The 400s that used to accumulate untouched.
  assertEquals(isDeadToken(400, "BadDeviceToken"), true);
  assertEquals(isDeadToken(400, "DeviceTokenNotForTopic"), true);
  // Retryable / not the token's fault — must survive.
  assertEquals(isDeadToken(400, "BadMessageId"), false);
  assertEquals(isDeadToken(429, "TooManyRequests"), false);
  assertEquals(isDeadToken(500, "InternalServerError"), false);
  assertEquals(isDeadToken(503, null), false);
  assertEquals(isDeadToken(0, null), false); // network failure
});

Deno.test("parseApnsReason — reads the reason, tolerates junk", () => {
  assertEquals(parseApnsReason('{"reason":"BadDeviceToken"}'), "BadDeviceToken");
  assertEquals(parseApnsReason(""), null);
  assertEquals(parseApnsReason(null), null);
  assertEquals(parseApnsReason(undefined), null);
  assertEquals(parseApnsReason("not json"), null);
  assertEquals(parseApnsReason('{"reason":123}'), null);
  assertEquals(parseApnsReason("{}"), null);
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

Deno.test("buildMessage returns null for badge_earned (webhook must not push badges)", () => {
  assertEquals(buildMessage("badge_earned", "Anyone"), null);
});
