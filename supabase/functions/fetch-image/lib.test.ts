import { assertEquals } from "jsr:@std/assert";
import { isAllowedImageType, requestedUrl } from "./lib.ts";

Deno.test("isAllowedImageType — raster images only", () => {
  assertEquals(isAllowedImageType("image/jpeg"), true);
  assertEquals(isAllowedImageType("image/webp; charset=binary"), true);
  assertEquals(isAllowedImageType("image/svg+xml"), false);
  assertEquals(isAllowedImageType("text/html"), false);
  assertEquals(isAllowedImageType(null), false);
});

Deno.test("requestedUrl — http(s) strings only, bounded", () => {
  assertEquals(requestedUrl({ url: "https://shop.example/a.jpg" }), "https://shop.example/a.jpg");
  assertEquals(requestedUrl({ url: "javascript:alert(1)" }), null);
  assertEquals(requestedUrl({ url: "https://x/" + "a".repeat(3000) }), null);
  assertEquals(requestedUrl({}), null);
  assertEquals(requestedUrl(null), null);
});
