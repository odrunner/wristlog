import { assertEquals } from "jsr:@std/assert";
import { buildBadgePushMessage } from "./lib.ts";

Deno.test("buildBadgePushMessage: empty -> null", () => {
  assertEquals(buildBadgePushMessage([]), null);
});

Deno.test("buildBadgePushMessage: single badge names it", () => {
  assertEquals(buildBadgePushMessage(["First Watch"]), {
    title: "WRotate",
    body: 'You earned the "First Watch" badge 🏅',
  });
});

Deno.test("buildBadgePushMessage: multiple badges are counted", () => {
  assertEquals(buildBadgePushMessage(["First Watch", "Five in the Box", "Ten in the Box"]), {
    title: "WRotate",
    body: "You earned 3 badges! 🏅",
  });
});
