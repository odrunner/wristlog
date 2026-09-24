import { assertEquals } from "jsr:@std/assert";
import { pickKey } from "./keys-lib.ts";

Deno.test("pickKey — prefers the named new key", () => {
  assertEquals(pickKey('{"default":"sb_secret_new"}', "legacy-jwt"), "sb_secret_new");
});

Deno.test("pickKey — other names are selectable", () => {
  assertEquals(pickKey('{"default":"a","billing":"b"}', "l", "billing"), "b");
});

Deno.test("pickKey — falls back to legacy when the new env is missing, empty or malformed", () => {
  assertEquals(pickKey(undefined, "legacy-jwt"), "legacy-jwt");
  assertEquals(pickKey("", "legacy-jwt"), "legacy-jwt");
  assertEquals(pickKey("not json", "legacy-jwt"), "legacy-jwt");
  assertEquals(pickKey('{"other":"x"}', "legacy-jwt"), "legacy-jwt");
  assertEquals(pickKey('{"default":""}', "legacy-jwt"), "legacy-jwt");
});

Deno.test("pickKey — nothing configured yields empty string", () => {
  assertEquals(pickKey(undefined, undefined), "");
});
