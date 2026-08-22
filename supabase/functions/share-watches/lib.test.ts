import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { buildWatchesOg, sortSharedWatches, WATCHES_SHARE_SELECT, watchesHeading } from "./lib.ts";

// The decisive privacy boundary: the columns the public page may read out of
// `watches`. Widening this ships price, market value, wears-adjacent data, notes
// or insurance without failing any other test in the repo.
Deno.test("WATCHES_SHARE_SELECT reads exactly the publishable columns", () => {
  const cols = WATCHES_SHARE_SELECT.split(",").map((s) => s.trim()).sort();
  // created_at + purchase_date are fetched for ORDERING only and stripped before render.
  assertEquals(cols, ["brand", "created_at", "id", "image", "name", "purchase_date", "ref", "url"]);
});

Deno.test("buildWatchesOg: title names the owner's watches, description lists count and first names", () => {
  const { ogTitle, ogDescription } = buildWatchesOg("Ozgur", null, [
    { id: "1", brand: "Rolex", name: "Daytona" },
    { id: "2", brand: "Omega", name: "Speedmaster" },
  ]);
  assertEquals(ogTitle, "Ozgur's watches — WRotate");
  assertEquals(ogDescription, "2 watches · Rolex Daytona, Omega Speedmaster");
});

Deno.test("buildWatchesOg: singular count, label between count and names, empty list", () => {
  assertEquals(buildWatchesOg("A", " for sale ", [{ id: "1", brand: "Tudor", name: "BB58" }]).ogDescription, "1 watch · for sale · Tudor BB58");
  assertEquals(buildWatchesOg("A", "", []).ogDescription, "0 watches");
});

Deno.test("buildWatchesOg: caps the name list at three", () => {
  const items = ["a", "b", "c", "d"].map((n) => ({ id: n, brand: "B", name: n }));
  const { ogDescription } = buildWatchesOg("A", null, items);
  assertStringIncludes(ogDescription, "B a, B b, B c");
  assertEquals(ogDescription.includes("B d"), false);
});

Deno.test("watchesHeading uses 'watches' rather than 'wishlist'", () => {
  assertEquals(watchesHeading("Ozgur"), "Ozgur's watches");
});

// The OG image is the wishlist one with a different heading; the default must
// stay "'s Wishlist" so share-wishlist previews are unchanged.
Deno.test("generateWishlistOgSvg: heading is swappable for the collection page", async () => {
  const { generateWishlistOgSvg } = await import("./lib.ts");
  const svg = generateWishlistOgSvg("Ozgur", [], watchesHeading);
  assertStringIncludes(svg, "Ozgur's watches");
  assertEquals(svg.includes("Wishlist"), false);
  assertStringIncludes(generateWishlistOgSvg("Ozgur", []), "Ozgur's Wishlist");
});

// The page lists watches the way the Collection tab does by default: purchase
// date, newest first; undated watches last; ties and undated ones by when they
// were added, newest first — so a link never reads as a random shuffle.
Deno.test("sortSharedWatches: purchase date desc, nulls last, then created_at desc", () => {
  const rows = [
    { id: "a", purchase_date: "2024-01-15", created_at: "2025-01-01T00:00:00Z" },
    { id: "b", purchase_date: null,         created_at: "2025-03-01T00:00:00Z" },
    { id: "c", purchase_date: "2026-05-27", created_at: "2025-02-01T00:00:00Z" },
    { id: "d", purchase_date: "2024-01-15", created_at: "2025-06-01T00:00:00Z" },
    { id: "e", purchase_date: null,         created_at: "2025-04-01T00:00:00Z" },
  ];
  assertEquals(sortSharedWatches(rows).map((r) => r.id), ["c", "d", "a", "e", "b"]);
});

Deno.test("sortSharedWatches: does not mutate its input and tolerates missing fields", () => {
  const rows = [{ id: "x" }, { id: "y", purchase_date: "2020-01-01" }];
  const out = sortSharedWatches(rows);
  assertEquals(out.map((r) => r.id), ["y", "x"]);
  assertEquals(rows.map((r) => r.id), ["x", "y"]);
});
