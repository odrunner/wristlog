import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { MIN_TRACKED_APP_VERSION, TRACKED_CONFIG_SET, trackedUidSet, versionAtLeast } from "./tracked-lib.ts";

Deno.test("versionAtLeast — the 2.6 gate", () => {
  assertEquals(versionAtLeast("2.6", "2.6"), true);
  assertEquals(versionAtLeast("2.7", "2.6"), true);
  assertEquals(versionAtLeast("3.0", "2.6"), true);
  assertEquals(versionAtLeast("2.10", "2.6"), true);  // segment-wise, not parseFloat
  assertEquals(versionAtLeast("2.5", "2.6"), false);
  assertEquals(versionAtLeast("2.4", "2.6"), false);
  assertEquals(versionAtLeast(null, "2.6"), false);
  assertEquals(versionAtLeast(undefined, "2.6"), false);
  assertEquals(versionAtLeast("", "2.6"), false);
  assertEquals(versionAtLeast("garbage", "2.6"), false);
  assertEquals(versionAtLeast("2.6.1", "2.6"), true);
  assertEquals(versionAtLeast("2", "2.6"), false);
});

Deno.test("trackedUidSet — any qualifying token admits the user, stale rows can't veto", () => {
  const s = trackedUidSet([
    { user_id: "u1", app_version: "2.6" },
    { user_id: "u1", app_version: null },      // older token, same user
    { user_id: "u2", app_version: "2.5" },
    { user_id: "u3", app_version: null },
  ]);
  assertEquals(s.has("u1"), true);
  assertEquals(s.has("u2"), false);
  assertEquals(s.has("u3"), false);
  assertEquals(trackedUidSet(null).size, 0);
  assertEquals(trackedUidSet([]).size, 0);
});

Deno.test("constants are what the AWS side was built with", () => {
  assertEquals(TRACKED_CONFIG_SET, "wrotate-events-tracked");
  assertEquals(MIN_TRACKED_APP_VERSION, "2.6");
});
