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

Deno.test("trackedUidSet — any qualifying iOS token admits the user, stale iOS rows can't veto", () => {
  const s = trackedUidSet([
    { user_id: "u1", app_version: "2.6", platform: "ios" },
    { user_id: "u1", app_version: null, platform: "ios" },      // older token, same user
    { user_id: "u2", app_version: "2.5", platform: "ios" },
    { user_id: "u3", app_version: null, platform: "ios" },
    { user_id: "u5", app_version: "2.7" },                       // legacy row, no platform → ios
  ]);
  assertEquals(s.has("u1"), true);
  assertEquals(s.has("u2"), false);
  assertEquals(s.has("u3"), false);
  assertEquals(s.has("u5"), true);
  assertEquals(trackedUidSet(null).size, 0);
  assertEquals(trackedUidSet([]).size, 0);
});

// Spec anti-goal (android-port design §anti-goals): a tracked link is rewritten to
// click.wrotate.com, whose .well-known has no assetlinks.json — on Android the CTA would open
// the browser, not the app. ANY android token vetoes tracking for that user, even version-less.
Deno.test("trackedUidSet — an android token vetoes, whatever its version", () => {
  const s = trackedUidSet([
    { user_id: "u1", app_version: "2.6", platform: "ios" },
    { user_id: "u1", app_version: "1.2", platform: "android" },  // dual-device user
    { user_id: "u2", app_version: "2.6", platform: "ios" },
    { user_id: "u3", app_version: null, platform: "android" },   // android only, no version
    { user_id: "u3", app_version: "2.6", platform: "ios" },
  ]);
  assertEquals(s.has("u1"), false);
  assertEquals(s.has("u2"), true);
  assertEquals(s.has("u3"), false);
});

Deno.test("constants are what the AWS side was built with", () => {
  assertEquals(TRACKED_CONFIG_SET, "wrotate-events-tracked");
  assertEquals(MIN_TRACKED_APP_VERSION, "2.6");
});
