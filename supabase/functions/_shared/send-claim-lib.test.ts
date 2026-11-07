import { assertEquals } from "jsr:@std/assert";
import { claimVerdict } from "./send-claim-lib.ts";

Deno.test("claimVerdict — row returned means we own the send", () => {
  assertEquals(claimVerdict([{ id: "n1" }], null), true);
});

Deno.test("claimVerdict — empty result means already claimed: skip", () => {
  assertEquals(claimVerdict([], null), false);
});

Deno.test("claimVerdict — null/undefined data without error means skip", () => {
  // PostgREST returns [] for a no-match update; null data with no error is
  // treated the same — nothing was claimed by us.
  assertEquals(claimVerdict(null, null), false);
  assertEquals(claimVerdict(undefined, null), false);
});

Deno.test("claimVerdict — any error fails open (send proceeds)", () => {
  assertEquals(claimVerdict(null, { message: "permission denied" }), true);
  assertEquals(claimVerdict([], { code: "57014" }), true);
  assertEquals(claimVerdict([{ id: "n1" }], { message: "x" }), true);
});

Deno.test("claimVerdict — non-array data without error means skip", () => {
  assertEquals(claimVerdict("weird" as unknown as unknown[], null), false);
});
