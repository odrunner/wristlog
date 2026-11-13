import { assertEquals } from "jsr:@std/assert";
import { buildBadgePushMessage } from "./lib.ts";

Deno.test("buildBadgePushMessage: empty -> null", () => {
  assertEquals(buildBadgePushMessage([]), null);
});

Deno.test("buildBadgePushMessage: single badge names it", () => {
  assertEquals(buildBadgePushMessage(["First Watch"]), {
    title: "WRotate",
    body: 'You earned the "First Watch" badge',
  });
});

Deno.test("buildBadgePushMessage: multiple badges are counted", () => {
  assertEquals(buildBadgePushMessage(["First Watch", "Five in the Box", "Ten in the Box"]), {
    title: "WRotate",
    body: "You earned 3 badges!",
  });
});

import { BADGE_STRINGS } from "./lib.ts";
import { LANGS } from "../_shared/lang.ts";

Deno.test("buildBadgePushMessage: every language names the badge or the count, with no emoji", () => {
  for (const lang of LANGS) {
    const one = buildBadgePushMessage(["Primer reloj"], lang)!.body;
    const many = buildBadgePushMessage(["a", "b", "c"], lang)!.body;
    assertEquals(one.includes("Primer reloj"), true);
    assertEquals(many.includes("3"), true);
    assertEquals(/[{}]/.test(one + many), false);
    assertEquals(/\p{Extended_Pictographic}/u.test(one + many), false);
    assertEquals(BADGE_STRINGS[lang].length, 2);
  }
  assertEquals(buildBadgePushMessage(["Primer reloj"], "es")!.body, 'Ganaste la insignia "Primer reloj"');
});
