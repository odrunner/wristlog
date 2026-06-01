import { assertEquals } from "jsr:@std/assert";
import { hasAuthHeader } from "./lib.ts";

Deno.test("hasAuthHeader — true for a present header value", () => {
  assertEquals(hasAuthHeader("Bearer abc.def.ghi"), true);
  assertEquals(hasAuthHeader("anything"), true);
});

Deno.test("hasAuthHeader — false for null/undefined/empty", () => {
  assertEquals(hasAuthHeader(null), false);
  assertEquals(hasAuthHeader(undefined), false);
  assertEquals(hasAuthHeader(""), false);
});
