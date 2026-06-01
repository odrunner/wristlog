import { assertEquals } from "jsr:@std/assert";
import {
  buildResendBody,
  extractBearerToken,
  FROM_EMAIL,
  hasRequiredFields,
} from "./lib.ts";

Deno.test("extractBearerToken — strips the Bearer prefix", () => {
  assertEquals(extractBearerToken("Bearer abc123"), "abc123");
});

Deno.test("extractBearerToken — missing header yields empty string", () => {
  assertEquals(extractBearerToken(null), "");
  assertEquals(extractBearerToken(undefined), "");
  assertEquals(extractBearerToken(""), "");
});

Deno.test("extractBearerToken — header without prefix passes through", () => {
  // matches .replace("Bearer ", "") behavior — no prefix means unchanged
  assertEquals(extractBearerToken("rawtoken"), "rawtoken");
});

Deno.test("extractBearerToken — only first 'Bearer ' is removed", () => {
  assertEquals(extractBearerToken("Bearer Bearer x"), "Bearer x");
});

Deno.test("hasRequiredFields — true when to/subject/html all present", () => {
  assertEquals(hasRequiredFields({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" }), true);
});

Deno.test("hasRequiredFields — false when any field is missing", () => {
  assertEquals(hasRequiredFields({ subject: "Hi", html: "<p>x</p>" }), false);
  assertEquals(hasRequiredFields({ to: "a@b.com", html: "<p>x</p>" }), false);
  assertEquals(hasRequiredFields({ to: "a@b.com", subject: "Hi" }), false);
});

Deno.test("hasRequiredFields — false for empty-string fields (falsy)", () => {
  assertEquals(hasRequiredFields({ to: "", subject: "Hi", html: "x" }), false);
  assertEquals(hasRequiredFields({ to: "a", subject: "", html: "x" }), false);
  assertEquals(hasRequiredFields({ to: "a", subject: "s", html: "" }), false);
});

Deno.test("hasRequiredFields — false for null/undefined/empty payload", () => {
  assertEquals(hasRequiredFields(null), false);
  assertEquals(hasRequiredFields(undefined), false);
  assertEquals(hasRequiredFields({}), false);
});

Deno.test("buildResendBody — assembles body with default from address", () => {
  assertEquals(buildResendBody("a@b.com", "Hi", "<p>x</p>"), {
    from: FROM_EMAIL,
    to: "a@b.com",
    subject: "Hi",
    html: "<p>x</p>",
  });
});

Deno.test("buildResendBody — preserves array recipients", () => {
  const out = buildResendBody(["a@b.com", "c@d.com"], "S", "H");
  assertEquals(out.to, ["a@b.com", "c@d.com"]);
});

Deno.test("buildResendBody — honors a custom from address", () => {
  assertEquals(buildResendBody("a@b.com", "S", "H", "Other <x@y.com>").from, "Other <x@y.com>");
});

Deno.test("FROM_EMAIL — unchanged sender identity", () => {
  assertEquals(FROM_EMAIL, "WRotate <notifications@wrotate.com>");
});
