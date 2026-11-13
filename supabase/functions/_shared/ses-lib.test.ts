// Tests for the pure SES payload builders (no Deno/IO/network).
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { buildSesPayload, chunk, sesEndpoint } from "./ses-lib.ts";

Deno.test("sesEndpoint builds the v2 outbound-emails URL for the region", () => {
  assertEquals(
    sesEndpoint("us-east-1"),
    "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails",
  );
});

Deno.test("buildSesPayload maps from/to/subject/html and config set", () => {
  const p = buildSesPayload(
    { from: "WRotate <hello@wrotate.com>", to: ["a@b.com"], subject: "Hi", html: "<p>x</p>" },
    "wrotate-events",
  ) as Record<string, any>;
  assertEquals(p.FromEmailAddress, "WRotate <hello@wrotate.com>");
  assertEquals(p.Destination, { ToAddresses: ["a@b.com"] });
  assertEquals(p.Content.Simple.Subject, { Data: "Hi", Charset: "UTF-8" });
  assertEquals(p.Content.Simple.Body, { Html: { Data: "<p>x</p>", Charset: "UTF-8" } });
  assertEquals(p.ConfigurationSetName, "wrotate-events");
  assertEquals(p.Content.Simple.Headers, undefined); // no headers → field omitted
});

Deno.test("buildSesPayload converts headers map to SES Name/Value array", () => {
  const p = buildSesPayload(
    {
      from: "f@x.com", to: ["a@b.com"], subject: "s", html: "h",
      headers: {
        "List-Unsubscribe": "<https://u>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    },
    "wrotate-events",
  ) as Record<string, any>;
  assertEquals(p.Content.Simple.Headers, [
    { Name: "List-Unsubscribe", Value: "<https://u>" },
    { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
  ]);
});

Deno.test("chunk splits arrays and preserves order", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 2), []);
  assertEquals(chunk([1], 10), [[1]]);
});

Deno.test("buildSesPayload honours a per-message configSet override", () => {
  const p = buildSesPayload(
    { from: "f@x.com", to: ["a@b.com"], subject: "s", html: "h", configSet: "wrotate-events-tracked" },
    "wrotate-events",
  ) as Record<string, any>;
  assertEquals(p.ConfigurationSetName, "wrotate-events-tracked");
});

Deno.test("buildSesPayload — msgKey becomes the wr_msg tag; none or an unsafe one sends no tags", () => {
  const base = { from: "f@x.com", to: ["a@b.com"], subject: "s", html: "h" };
  assertEquals(buildSesPayload({ ...base, msgKey: "wear_reminder" }, "cs").EmailTags, [{ Name: "wr_msg", Value: "wear_reminder" }]);
  assertEquals("EmailTags" in buildSesPayload(base, "cs"), false);
  assertEquals("EmailTags" in buildSesPayload({ ...base, msgKey: "has space" }, "cs"), false);
  assertEquals("EmailTags" in buildSesPayload({ ...base, msgKey: "" }, "cs"), false);
});
