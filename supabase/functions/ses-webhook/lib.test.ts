// Tests for ses-webhook pure logic (no Deno/IO/network).
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildCanonicalString,
  buildEmailEventRow,
  isValidCertUrl,
  isValidSnsEnvelope,
  isValidSubscribeUrl,
  mapSesEventType,
  timestampWithinTolerance,
} from "./lib.ts";

Deno.test("mapSesEventType maps SES names to legacy email_events values", () => {
  assertEquals(mapSesEventType("Send"), "sent");
  assertEquals(mapSesEventType("Delivery"), "delivered");
  assertEquals(mapSesEventType("Open"), "opened");
  assertEquals(mapSesEventType("Click"), "clicked");
  assertEquals(mapSesEventType("Bounce"), "bounced");
  assertEquals(mapSesEventType("Complaint"), "complained");
  assertEquals(mapSesEventType("Rendering Failure"), "rendering failure"); // unknown → lowercased
});

Deno.test("buildEmailEventRow shapes a row from a SES event", () => {
  const ev = {
    eventType: "Delivery",
    mail: {
      messageId: "ses-msg-1",
      timestamp: "2026-07-19T10:00:00.000Z",
      destination: ["user@example.com"],
      commonHeaders: { subject: "Welcome to WRotate" },
    },
  };
  const row = buildEmailEventRow(ev, "2026-07-19T10:05:00.000Z");
  assertEquals(row, {
    email_id: "ses-msg-1",
    event_type: "delivered",
    email_to: "user@example.com",
    subject: "Welcome to WRotate",
    created_at: "2026-07-19T10:00:00.000Z",
    raw: ev,
  });
});

Deno.test("buildEmailEventRow falls back to nowIso and nulls", () => {
  const row = buildEmailEventRow({ eventType: "Send", mail: {} }, "2026-07-19T10:05:00.000Z");
  assertEquals(row.email_id, null);
  assertEquals(row.email_to, null);
  assertEquals(row.subject, null);
  assertEquals(row.created_at, "2026-07-19T10:05:00.000Z");
});

Deno.test("isValidCertUrl accepts only https sns.<region>.amazonaws.com .pem URLs", () => {
  assertEquals(isValidCertUrl("https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem"), true);
  assertEquals(isValidCertUrl("http://sns.us-east-1.amazonaws.com/x.pem"), false);
  assertEquals(isValidCertUrl("https://evil.com/sns.us-east-1.amazonaws.com/x.pem"), false);
  assertEquals(isValidCertUrl("https://sns.us-east-1.amazonaws.com.evil.com/x.pem"), false);
  assertEquals(isValidCertUrl("https://sns.us-east-1.amazonaws.com/x.txt"), false);
});

Deno.test("isValidSubscribeUrl accepts only https sns.<region>.amazonaws.com", () => {
  assertEquals(isValidSubscribeUrl("https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=x"), true);
  assertEquals(isValidSubscribeUrl("https://evil.com/?Action=ConfirmSubscription"), false);
});

Deno.test("buildCanonicalString orders Notification keys per SNS spec", () => {
  const s = buildCanonicalString({
    Type: "Notification",
    Message: "m",
    MessageId: "id",
    Timestamp: "t",
    TopicArn: "arn",
  });
  assertEquals(s, "Message\nm\nMessageId\nid\nTimestamp\nt\nTopicArn\narn\nType\nNotification\n");
});

Deno.test("buildCanonicalString includes Subject when present", () => {
  const s = buildCanonicalString({
    Type: "Notification", Message: "m", MessageId: "id",
    Subject: "s", Timestamp: "t", TopicArn: "arn",
  });
  assertEquals(s, "Message\nm\nMessageId\nid\nSubject\ns\nTimestamp\nt\nTopicArn\narn\nType\nNotification\n");
});

Deno.test("buildCanonicalString uses confirmation keys for SubscriptionConfirmation", () => {
  const s = buildCanonicalString({
    Type: "SubscriptionConfirmation", Message: "m", MessageId: "id",
    SubscribeURL: "u", Timestamp: "t", Token: "tok", TopicArn: "arn",
  });
  assertEquals(
    s,
    "Message\nm\nMessageId\nid\nSubscribeURL\nu\nTimestamp\nt\nToken\ntok\nTopicArn\narn\nType\nSubscriptionConfirmation\n",
  );
});

Deno.test("isValidSnsEnvelope requires Type, MessageId, TopicArn", () => {
  assertEquals(isValidSnsEnvelope({ Type: "Notification", MessageId: "1", TopicArn: "a", Message: "{}" }), true);
  assertEquals(isValidSnsEnvelope({ Type: "Notification" }), false);
  assertEquals(isValidSnsEnvelope(null), false);
});

Deno.test("timestampWithinTolerance accepts fresh ISO timestamps", () => {
  const now = Date.parse("2026-07-19T12:00:00.000Z");
  assertEquals(timestampWithinTolerance("2026-07-19T11:58:00.000Z", now), true);
  assertEquals(timestampWithinTolerance("2026-07-19T12:04:59.000Z", now), true);
});

Deno.test("timestampWithinTolerance rejects stale, missing, and garbage timestamps", () => {
  const now = Date.parse("2026-07-19T12:00:00.000Z");
  assertEquals(timestampWithinTolerance("2026-07-19T11:54:59.000Z", now), false);
  assertEquals(timestampWithinTolerance("2026-07-19T12:05:01.000Z", now), false);
  assertEquals(timestampWithinTolerance(undefined, now), false);
  assertEquals(timestampWithinTolerance("not-a-date", now), false);
});

// 2026-07-19 audit: every opened/clicked row was stamped with mail.timestamp
// (the SEND time) instead of the event time, so engagement windows were wrong.
Deno.test("buildEmailEventRow uses the open timestamp, not the send timestamp", () => {
  const row = buildEmailEventRow({
    eventType: "Open",
    mail: { messageId: "m1", timestamp: "2026-07-19T00:00:00.000Z", destination: ["a@b.com"] },
    open: { timestamp: "2026-07-26T12:34:56.000Z" },
  }, "2026-07-30T00:00:00.000Z");
  assertEquals(row.created_at, "2026-07-26T12:34:56.000Z");
  assertEquals(row.event_type, "opened");
});

Deno.test("buildEmailEventRow uses the click timestamp", () => {
  const row = buildEmailEventRow({
    eventType: "Click",
    mail: { messageId: "m2", timestamp: "2026-07-19T00:00:00.000Z" },
    click: { timestamp: "2026-07-22T08:00:00.000Z" },
  }, "2026-07-30T00:00:00.000Z");
  assertEquals(row.created_at, "2026-07-22T08:00:00.000Z");
});

Deno.test("buildEmailEventRow uses the delivery timestamp", () => {
  const row = buildEmailEventRow({
    eventType: "Delivery",
    mail: { messageId: "m3", timestamp: "2026-07-19T00:00:00.000Z" },
    delivery: { timestamp: "2026-07-19T00:00:03.000Z" },
  }, "2026-07-30T00:00:00.000Z");
  assertEquals(row.created_at, "2026-07-19T00:00:03.000Z");
});

Deno.test("buildEmailEventRow falls back to mail.timestamp for Send", () => {
  // For a Send event the two are legitimately the same.
  const row = buildEmailEventRow({
    eventType: "Send",
    mail: { messageId: "m4", timestamp: "2026-07-19T00:00:00.000Z" },
  }, "2026-07-30T00:00:00.000Z");
  assertEquals(row.created_at, "2026-07-19T00:00:00.000Z");
});

Deno.test("buildEmailEventRow falls back to now when no timestamp at all", () => {
  const row = buildEmailEventRow({ eventType: "Open" }, "2026-07-30T00:00:00.000Z");
  assertEquals(row.created_at, "2026-07-30T00:00:00.000Z");
});
