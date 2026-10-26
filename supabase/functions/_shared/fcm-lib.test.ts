import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { buildFcmMessage, buildOauthClaims, fcmSendUrl, isDeadFcmResult } from "./fcm-lib.ts";

Deno.test("buildFcmMessage — notification + string-only data, high priority", () => {
  const m = buildFcmMessage(
    "tok1",
    { title: "New like", body: "someone liked your post" },
    { route: "post", id: "abc-123", uid: "u-1", n: "n-9", t: "like" },
  ) as Record<string, unknown>;
  const msg = m.message as Record<string, unknown>;
  assertEquals(msg.token, "tok1");
  assertEquals(msg.notification, { title: "New like", body: "someone liked your post" });
  assertEquals(msg.data, { route: "post", id: "abc-123", uid: "u-1", n: "n-9", t: "like" });
  assertEquals((msg.android as Record<string, unknown>).priority, "high");
});

Deno.test("buildFcmMessage — null/undefined data values are omitted (FCM v1 rejects non-strings)", () => {
  const m = buildFcmMessage("tok", { title: "t", body: "b" }, { route: "bell", id: null, uid: "u", n: null }) as Record<
    string,
    { data: Record<string, string> }
  >;
  assertEquals(m.message.data, { route: "bell", uid: "u" });
});

Deno.test("buildFcmMessage — no route payload means no data key", () => {
  const m = buildFcmMessage("tok", { title: "t", body: "b" }) as Record<string, Record<string, unknown>>;
  assertEquals("data" in m.message, false);
});

Deno.test("buildOauthClaims — firebase messaging scope, 1h expiry", () => {
  const c = buildOauthClaims("svc@wrotate.iam.gserviceaccount.com", 1000) as Record<string, unknown>;
  assertEquals(c.iss, "svc@wrotate.iam.gserviceaccount.com");
  assertEquals(c.scope, "https://www.googleapis.com/auth/firebase.messaging");
  assertEquals(c.aud, "https://oauth2.googleapis.com/token");
  assertEquals(c.iat, 1000);
  assertEquals(c.exp, 4600);
});

Deno.test("fcmSendUrl — project-scoped v1 endpoint", () => {
  assertEquals(fcmSendUrl("wrotate"), "https://fcm.googleapis.com/v1/projects/wrotate/messages:send");
});

Deno.test("isDeadFcmResult — only unregistered tokens are dead", () => {
  assertEquals(isDeadFcmResult(404, "NOT_FOUND"), true);
  assertEquals(isDeadFcmResult(400, "UNREGISTERED"), true);
  // INVALID_ARGUMENT also fires for malformed PAYLOADS — treating it as a dead token would
  // let one payload bug delete every Android token it was sent to (review M2, re-graded).
  assertEquals(isDeadFcmResult(400, "INVALID_ARGUMENT"), false);
  assertEquals(isDeadFcmResult(400, "QUOTA_EXCEEDED"), false);
  assertEquals(isDeadFcmResult(500, "INTERNAL"), false);
  assertEquals(isDeadFcmResult(503, undefined), false);
  assertEquals(isDeadFcmResult(401, undefined), false);
});
