import { assertEquals } from "jsr:@std/assert";
import { clampText, isDemoUser, oversized, sanitizeCollection } from "./ai-guard.ts";

Deno.test("isDemoUser — only the shared demo account, any case", () => {
  assertEquals(isDemoUser({ email: "demo@wrotate.com" }), true);
  assertEquals(isDemoUser({ email: " DEMO@wrotate.com" }), true);
  assertEquals(isDemoUser({ email: "someone@example.com" }), false);
  assertEquals(isDemoUser(null), false);
  assertEquals(isDemoUser({}), false);
});

Deno.test("clampText — strings trimmed, numbers stringified, others empty", () => {
  assertEquals(clampText("x".repeat(500)).length, 120);
  assertEquals(clampText("Rolex", 3), "Rol");
  assertEquals(clampText(1968), "1968");
  assertEquals(clampText({ a: 1 }), "");
  assertEquals(clampText(undefined), "");
});

Deno.test("sanitizeCollection — caps items and fields, drops junk shapes", () => {
  const big = Array.from({ length: 5000 }, () => ({ brand: "B".repeat(1000), name: "N", ref: "R".repeat(500) }));
  const out = sanitizeCollection(big);
  assertEquals(out.length, 300);
  assertEquals(out[0].brand.length, 120);
  assertEquals(out[0].ref.length, 60);
  assertEquals(sanitizeCollection("not an array"), []);
  assertEquals(sanitizeCollection([null])[0], { brand: "", name: "", ref: "" });
});

Deno.test("sanitizeCollection — a normal collection passes through unchanged", () => {
  const c = [{ brand: "Omega", name: "Speedmaster", ref: "310.30.42" }];
  assertEquals(sanitizeCollection(c), c);
});

Deno.test("oversized — measures serialised length; absent values are fine", () => {
  assertEquals(oversized({ brand: "x".repeat(5000) }, 4000), true);
  assertEquals(oversized({ brand: "Omega" }, 4000), false);
  assertEquals(oversized(undefined, 10), false);
  assertEquals(oversized(null, 10), false);
});
