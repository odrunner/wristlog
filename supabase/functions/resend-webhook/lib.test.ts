import { assertEquals } from "jsr:@std/assert";
import { buildEmailEventRow, isValidPayload, normalizeEventType } from "./lib.ts";

Deno.test("isValidPayload — true with both type and data", () => {
  assertEquals(isValidPayload({ type: "email.delivered", data: {} }), true);
});

Deno.test("isValidPayload — false when type or data missing", () => {
  assertEquals(isValidPayload({ type: "email.delivered" }), false);
  assertEquals(isValidPayload({ data: {} }), false);
  assertEquals(isValidPayload({}), false);
  assertEquals(isValidPayload(null), false);
  assertEquals(isValidPayload(undefined), false);
});

Deno.test("normalizeEventType — strips email. prefix", () => {
  assertEquals(normalizeEventType("email.delivered"), "delivered");
  assertEquals(normalizeEventType("email.bounced"), "bounced");
});

Deno.test("normalizeEventType — only removes first occurrence / leaves unprefixed as-is", () => {
  assertEquals(normalizeEventType("delivered"), "delivered");
});

Deno.test("buildEmailEventRow — full payload with array recipient", () => {
  const body = {
    type: "email.delivered",
    data: {
      email_id: "abc-123",
      to: ["user@example.com", "second@example.com"],
      subject: "Welcome",
      created_at: "2026-06-01T10:00:00Z",
    },
  };
  assertEquals(buildEmailEventRow(body, "2026-06-01T12:00:00Z"), {
    email_id: "abc-123",
    event_type: "delivered",
    email_to: "user@example.com",
    subject: "Welcome",
    created_at: "2026-06-01T10:00:00Z",
    raw: body,
  });
});

Deno.test("buildEmailEventRow — string recipient kept as-is", () => {
  const body = {
    type: "email.opened",
    data: { email_id: "x", to: "solo@example.com", subject: "Hi", created_at: "2026-06-01T09:00:00Z" },
  };
  const row = buildEmailEventRow(body, "2026-06-01T12:00:00Z");
  assertEquals(row.email_to, "solo@example.com");
  assertEquals(row.event_type, "opened");
});

Deno.test("buildEmailEventRow — missing fields default to null, created_at falls back to nowIso", () => {
  const body = { type: "email.bounced", data: {} };
  assertEquals(buildEmailEventRow(body, "2026-06-01T12:00:00Z"), {
    email_id: null,
    event_type: "bounced",
    email_to: null,
    subject: null,
    created_at: "2026-06-01T12:00:00Z",
    raw: body,
  });
});

Deno.test("buildEmailEventRow — empty recipient array yields undefined→null first element", () => {
  const body = { type: "email.delivered", data: { to: [] as string[] } };
  const row = buildEmailEventRow(body, "2026-06-01T12:00:00Z");
  // matches original: Array.isArray ? to[0] : ... → undefined for empty array
  assertEquals(row.email_to, undefined);
});
