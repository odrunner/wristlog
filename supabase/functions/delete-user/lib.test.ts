import { assertEquals } from "jsr:@std/assert";
import { hasAuthHeader, isUndeletable } from "./lib.ts";

Deno.test("hasAuthHeader — true for a present header value", () => {
  assertEquals(hasAuthHeader("Bearer abc.def.ghi"), true);
  assertEquals(hasAuthHeader("anything"), true);
});

Deno.test("hasAuthHeader — false for null/undefined/empty", () => {
  assertEquals(hasAuthHeader(null), false);
  assertEquals(hasAuthHeader(undefined), false);
  assertEquals(hasAuthHeader(""), false);
});

Deno.test("isUndeletable — the shared demo account is protected (any case)", () => {
  assertEquals(isUndeletable("demo@wrotate.com"), true);
  assertEquals(isUndeletable(" Demo@WRotate.com "), true);
});

Deno.test("isUndeletable — ordinary accounts and missing email are not", () => {
  assertEquals(isUndeletable("someone@example.com"), false);
  assertEquals(isUndeletable(null), false);
  assertEquals(isUndeletable(undefined), false);
  assertEquals(isUndeletable(""), false);
});
