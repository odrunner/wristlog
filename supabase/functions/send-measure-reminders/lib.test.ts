import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { buildMeasurePush, fmtRate } from "./lib.ts";
import { buildAlertPayload, routeFor, versionAtLeast } from "./lib.ts";

Deno.test("fmtRate — sign and one decimal", () => {
  assertEquals(fmtRate(6.24), "+6.2 s/d");
  assertEquals(fmtRate(-2), "-2.0 s/d");
  assertEquals(fmtRate(0), "0.0 s/d");
});

Deno.test("buildMeasurePush — first reminder: re-measure to see if it's holding", () => {
  const m = buildMeasurePush({ brand: "Omega", name: "Speedmaster", rate: 6.24, measured_at: "2026-07-20T10:00:00Z", prior_rate: null, prior_at: null });
  assertEquals(m.title, "WRotate");
  assertEquals(m.body, "You measured your Omega Speedmaster at +6.2 s/d on Jul 20. Re-measure to see if it's holding.");
});

Deno.test("buildMeasurePush — with a prior reading: drift vs month (higher rate = faster)", () => {
  const m = buildMeasurePush({ brand: "Omega", name: "Speedmaster", rate: 6.2, measured_at: "2026-07-20T10:00:00Z", prior_rate: 2.2, prior_at: "2026-06-05T10:00:00Z" });
  assertEquals(m.body, "Your Omega Speedmaster is running +6.2 s/d — 4.0 s/d faster than in June. Tap to re-measure.");
});

Deno.test("buildMeasurePush — slower / unchanged wording; numeric strings from PostgREST", () => {
  assertStringIncludes(buildMeasurePush({ brand: "A", name: "B", rate: "-1", measured_at: "2026-07-20T10:00:00Z", prior_rate: "3", prior_at: "2026-06-05T10:00:00Z" }).body, "4.0 s/d slower than in June");
  assertStringIncludes(buildMeasurePush({ brand: "A", name: "B", rate: 3.04, measured_at: "2026-07-20T10:00:00Z", prior_rate: 3, prior_at: "2026-06-05T10:00:00Z" }).body, "same as in June");
});

Deno.test("buildMeasurePush — missing brand/name degrade to 'watch'", () => {
  assertStringIncludes(buildMeasurePush({ brand: "", name: "", rate: 1, measured_at: "2026-07-20T10:00:00Z", prior_rate: null, prior_at: null }).body, "your watch at +1.0 s/d");
});

Deno.test("versionAtLeast / routeFor — routes only for 2.6+ tokens", () => {
  assertEquals(versionAtLeast("2.6", "2.6"), true);
  assertEquals(versionAtLeast("2.10", "2.6"), true);
  assertEquals(versionAtLeast("2.5", "2.6"), false);
  assertEquals(versionAtLeast("", "2.6"), false);
  assertEquals(versionAtLeast(null, "2.6"), false);
  assertEquals(routeFor("2.5", "track", "w1", "u1"), undefined);
  assertEquals(routeFor("2.6", "track", "w1", "u1"), { w: { route: "track", id: "w1", uid: "u1" } });
});

Deno.test("buildAlertPayload — extra merges into the root, aps untouched", () => {
  const p = buildAlertPayload({ title: "T", body: "B" }, { w: { route: "measure", id: "x", uid: "u" } }) as Record<string, unknown>;
  assertEquals((p.aps as Record<string, unknown>).badge, 1);
  assertEquals((p.w as Record<string, unknown>).route, "measure");
  assertEquals("w" in (buildAlertPayload({ title: "T", body: "B" }) as Record<string, unknown>), false);
});
