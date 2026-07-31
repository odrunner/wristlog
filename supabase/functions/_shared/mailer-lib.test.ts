// Tests for provider resolution (pure — no Deno env, IO, or network).
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { resolveProvider } from "./mailer-lib.ts";

Deno.test("resolveProvider returns ses only for an explicit ses value", () => {
  assertEquals(resolveProvider("ses"), "ses");
  assertEquals(resolveProvider("SES"), "ses");
  assertEquals(resolveProvider("  ses  "), "ses");
});

Deno.test("resolveProvider returns resend for an explicit resend value", () => {
  assertEquals(resolveProvider("resend"), "resend");
  assertEquals(resolveProvider("RESEND"), "resend");
});

// The whole point of the default: a typo, a cleared secret, or a fresh
// environment must never silently route live mail to the provider being
// cut over to. Unknown input falls back to the known-good one.
Deno.test("resolveProvider falls back to resend for unset or unknown values", () => {
  assertEquals(resolveProvider(undefined), "resend");
  assertEquals(resolveProvider(null), "resend");
  assertEquals(resolveProvider(""), "resend");
  assertEquals(resolveProvider("   "), "resend");
  assertEquals(resolveProvider("sess"), "resend");
  assertEquals(resolveProvider("aws"), "resend");
  assertEquals(resolveProvider("amazon-ses"), "resend");
});
