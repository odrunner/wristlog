import { assertEquals } from "jsr:@std/assert";
import { isFresh, timingSafeEqual, triggerSecretOk } from "./trigger-auth.ts";

Deno.test("timingSafeEqual — equal / different / different lengths", () => {
  assertEquals(timingSafeEqual("abc", "abc"), true);
  assertEquals(timingSafeEqual("abc", "abd"), false);
  assertEquals(timingSafeEqual("abc", "abcd"), false);
  assertEquals(timingSafeEqual("", ""), true);
});

Deno.test("triggerSecretOk — matches only a configured, identical secret", () => {
  assertEquals(triggerSecretOk("s3cret", "s3cret"), true);
  assertEquals(triggerSecretOk("wrong", "s3cret"), false);
  assertEquals(triggerSecretOk(null, "s3cret"), false);
  assertEquals(triggerSecretOk("", ""), false, "unset secret authorises nobody");
  assertEquals(triggerSecretOk("anything", undefined), false);
});

Deno.test("isFresh — recent rows only, tolerate small clock skew", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  assertEquals(isFresh("2026-09-25T11:50:00Z", now), true);
  assertEquals(isFresh("2026-09-25T11:40:00Z", now), false);
  assertEquals(isFresh("2026-09-25T12:00:30Z", now), true);
  assertEquals(isFresh("2026-09-25T12:05:00Z", now), false);
  assertEquals(isFresh(null, now), false);
  assertEquals(isFresh("not a date", now), false);
});
