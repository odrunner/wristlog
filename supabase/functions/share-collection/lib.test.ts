import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  avatarInnerHtml,
  buildCollectionOg,
  computeWearCounts,
  esc,
  generateOgSvg,
  htmlPage,
  initials,
  isCollectionViewable,
  sortByWears,
} from "./lib.ts";

Deno.test("esc — escapes &, <, >, \"", () => {
  assertEquals(esc(`a & b < c > d "e"`), "a &amp; b &lt; c &gt; d &quot;e&quot;");
});

Deno.test("esc — leaves plain text unchanged", () => {
  assertEquals(esc("Rolex Submariner"), "Rolex Submariner");
});

Deno.test("initials — first letters of brand + name, upper, max 2", () => {
  assertEquals(initials("Rolex", "Submariner"), "RS");
});

Deno.test("initials — single word still works", () => {
  assertEquals(initials("Omega", ""), "O");
});

Deno.test("initials — empty inputs fall back to '?'", () => {
  assertEquals(initials("", ""), "?");
});

Deno.test("initials — collapses extra whitespace", () => {
  assertEquals(initials("  Grand   Seiko  ", ""), "GS");
});

Deno.test("isCollectionViewable — public profile + default visibility is viewable", () => {
  assertEquals(isCollectionViewable({}, null), true);
  assertEquals(isCollectionViewable({ profile_privacy: "public", collection_visibility: "public" }, null), true);
});

Deno.test("isCollectionViewable — null/missing profile or error is not viewable", () => {
  assertEquals(isCollectionViewable(null, null), false);
  assertEquals(isCollectionViewable(undefined, null), false);
  assertEquals(isCollectionViewable({}, new Error("boom")), false);
});

Deno.test("isCollectionViewable — non-public profile or private collection is not viewable", () => {
  assertEquals(isCollectionViewable({ profile_privacy: "private" }, null), false);
  assertEquals(isCollectionViewable({ collection_visibility: "private" }, null), false);
});

Deno.test("isCollectionViewable — followers-only collection still viewable (only 'private' blocks)", () => {
  assertEquals(isCollectionViewable({ collection_visibility: "followers" }, null), true);
});

Deno.test("computeWearCounts — counts unique (watch, date) pairs", () => {
  const logs = [
    { watch_id: "a", date: "2026-06-01" },
    { watch_id: "a", date: "2026-06-01" }, // duplicate, ignored
    { watch_id: "a", date: "2026-06-02" },
    { watch_id: "b", date: "2026-06-01" },
  ];
  assertEquals(computeWearCounts(logs), { a: 2, b: 1 });
});

Deno.test("computeWearCounts — null/empty input yields empty object", () => {
  assertEquals(computeWearCounts(null), {});
  assertEquals(computeWearCounts([]), {});
});

Deno.test("computeWearCounts — allowedIds drops logs of private/deleted watches", () => {
  // The logs query now fetches by user_id alone (so it can run in parallel with
  // the watches query); a private watch's logs must not leak into the counts —
  // they would inflate the OG description's total wears.
  const logs = [
    { watch_id: "pub", date: "2026-06-01" },
    { watch_id: "pub", date: "2026-06-01" }, // duplicate, still ignored
    { watch_id: "priv", date: "2026-06-01" },
    { watch_id: "deleted", date: "2026-06-02" },
  ];
  assertEquals(computeWearCounts(logs, new Set(["pub"])), { pub: 1 });
});

Deno.test("computeWearCounts — an empty allowedIds set counts nothing", () => {
  const logs = [{ watch_id: "a", date: "2026-06-01" }];
  assertEquals(computeWearCounts(logs, new Set()), {});
});

Deno.test("computeWearCounts — omitting allowedIds keeps the old count-everything behaviour", () => {
  const logs = [
    { watch_id: "a", date: "2026-06-01" },
    { watch_id: "b", date: "2026-06-01" },
  ];
  assertEquals(computeWearCounts(logs), { a: 1, b: 1 });
});

Deno.test("sortByWears — orders by descending wear count", () => {
  const watches = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const out = sortByWears(watches, { a: 1, b: 5, c: 3 });
  assertEquals(out.map((w) => w.id), ["b", "c", "a"]);
});

Deno.test("sortByWears — does not mutate input array", () => {
  const watches = [{ id: "a" }, { id: "b" }];
  const copy = [...watches];
  sortByWears(watches, { a: 1, b: 2 });
  assertEquals(watches, copy);
});

Deno.test("buildCollectionOg — includes most-worn watch when wears > 0", () => {
  const watches = [{ id: "a", brand: "Rolex", name: "Sub" }, { id: "b", brand: "Omega", name: "Speedy" }];
  const sorted = [{ id: "a", brand: "Rolex", name: "Sub" }, { id: "b", brand: "Omega", name: "Speedy" }];
  const out = buildCollectionOg("Alice", watches, sorted, { a: 3, b: 1 });
  assertEquals(out.ogTitle, "Alice's Watch Collection — WRotate");
  assertEquals(out.ogDescription, "2 watches · 4 total wears · Most worn: Rolex Sub");
});

Deno.test("buildCollectionOg — omits most-worn when top watch has 0 wears", () => {
  const watches = [{ id: "a", brand: "Rolex", name: "Sub" }];
  const out = buildCollectionOg("Bob", watches, watches, {});
  assertEquals(out.ogDescription, "1 watch · 0 total wears");
});

Deno.test("buildCollectionOg — singular vs plural agreement", () => {
  const watches = [{ id: "a", brand: "Rolex", name: "Sub" }];
  const out = buildCollectionOg("Bob", watches, watches, { a: 1 });
  assertEquals(out.ogDescription, "1 watch · 1 total wear · Most worn: Rolex Sub");
});

Deno.test("avatarInnerHtml — renders escaped img when url present", () => {
  assertEquals(
    avatarInnerHtml('https://x/a.png?a=1&b=2', "Alice"),
    `<img src="https://x/a.png?a=1&amp;b=2" alt="">`,
  );
});

Deno.test("avatarInnerHtml — renders initials when no url", () => {
  assertEquals(avatarInnerHtml(null, "Alice Smith"), "AS");
  assertEquals(avatarInnerHtml(undefined, "Cher"), "C");
});

Deno.test("generateOgSvg — empty collection shows fallback text", () => {
  const svg = generateOgSvg("Alice", [], {});
  assertStringIncludes(svg, "No public watches yet");
  assertStringIncludes(svg, `width="1200" height="630"`);
  assertStringIncludes(svg, "Alice's Collection"); // name label appends "'s Collection"
});

Deno.test("generateOgSvg — renders a tile per watch (capped at 6)", () => {
  const watches = Array.from({ length: 8 }, (_, i) => ({ id: String(i), brand: "B", name: "N" + i }));
  const svg = generateOgSvg("Alice", watches, {});
  // 6 clip paths for 6 displayed tiles
  const clipCount = (svg.match(/clipPath/g) || []).length / 2; // open+close tags
  assertEquals(clipCount, 6);
});

Deno.test("generateOgSvg — escapes a malicious watch name", () => {
  const watches = [{ id: "1", brand: "B", name: `<script>x</script>` }];
  const svg = generateOgSvg("Alice", watches, {});
  assertStringIncludes(svg, "&lt;script&gt;");
});

Deno.test("htmlPage — embeds escaped OG meta and body", () => {
  const html = htmlPage(`A & B`, "desc", "https://img/x", "https://wrotate.com/", "<p>hi</p>");
  assertStringIncludes(html, `<meta property="og:title" content="A &amp; B">`);
  assertStringIncludes(html, `<meta property="og:image" content="https://img/x">`);
  assertStringIncludes(html, "<p>hi</p>");
  assertStringIncludes(html, `<meta property="og:type" content="profile">`);
});
