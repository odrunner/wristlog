// Tests for the pure Resend payload helpers (no Deno/IO/network).
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildResendPayload,
  chunk,
  extractBatchIds,
  isRetryableStatus,
} from "./resend-lib.ts";

Deno.test("buildResendPayload maps from/to/subject/html", () => {
  const p = buildResendPayload({
    from: "WRotate <hello@wrotate.com>",
    to: ["a@b.com"],
    subject: "Hi",
    html: "<p>x</p>",
  });
  assertEquals(p, {
    from: "WRotate <hello@wrotate.com>",
    to: ["a@b.com"],
    subject: "Hi",
    html: "<p>x</p>",
  });
  assertEquals(p.headers, undefined); // no headers → field omitted
});

Deno.test("buildResendPayload passes the unsubscribe headers through", () => {
  const p = buildResendPayload({
    from: "f@x.com",
    to: ["a@b.com"],
    subject: "s",
    html: "h",
    headers: {
      "List-Unsubscribe": "<https://u>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  assertEquals(p.headers, {
    "List-Unsubscribe": "<https://u>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
});

// A permanent failure marked retryable strands rows in the queue; a retryable
// failure marked permanent drops those recipients for good (the drain only ever
// re-selects 'pending'). Both directions matter.
Deno.test("isRetryableStatus: throttling, 5xx and network throws only", () => {
  assertEquals(isRetryableStatus(429), true);
  assertEquals(isRetryableStatus(0), true);
  assertEquals(isRetryableStatus(500), true);
  assertEquals(isRetryableStatus(503), true);
  assertEquals(isRetryableStatus(400), false);
  assertEquals(isRetryableStatus(401), false);
  assertEquals(isRetryableStatus(403), false);
  assertEquals(isRetryableStatus(422), false);
  assertEquals(isRetryableStatus(200), false);
});

Deno.test("extractBatchIds reads ids in request order", () => {
  const body = { data: [{ id: "a1" }, { id: "b2" }, { id: "c3" }] };
  assertEquals(extractBatchIds(body, 3), ["a1", "b2", "c3"]);
});

Deno.test("extractBatchIds pads when the response is short or malformed", () => {
  assertEquals(extractBatchIds({ data: [{ id: "a1" }] }, 3), ["a1", "", ""]);
  assertEquals(extractBatchIds({}, 2), ["", ""]);
  assertEquals(extractBatchIds(null, 2), ["", ""]);
  assertEquals(extractBatchIds({ data: "nope" }, 1), [""]);
  assertEquals(extractBatchIds({ data: [{ id: 7 }] }, 1), [""]);
});

Deno.test("chunk splits arrays and preserves order", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 2), []);
  assertEquals(chunk([1], 10), [[1]]);
});
