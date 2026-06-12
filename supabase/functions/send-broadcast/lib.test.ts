import { assertEquals } from "jsr:@std/assert";
import {
  batchSegment,
  capRecipients,
  COHORTS,
  dormantCutoffMs,
  effectiveLimit,
  excludeIds,
  filterNeverMeasured,
  filterOptedIn,
  isDormant,
  sanitizeHtml,
  SEGMENT_DATE_GTE,
  segmentDateGte,
  unsubFooter,
  unsubUrl,
  validateBroadcastInput,
} from "./lib.ts";

const DAY = 24 * 60 * 60 * 1000;

// ---- sanitizeHtml ----
Deno.test("sanitizeHtml — strips <script> blocks", () => {
  assertEquals(sanitizeHtml('<p>hi</p><script>alert(1)</script>'), "<p>hi</p>");
});

Deno.test("sanitizeHtml — strips iframe/object/embed/form", () => {
  assertEquals(sanitizeHtml('<iframe src=x></iframe>a'), "a");
  assertEquals(sanitizeHtml('<object data=x></object>b'), "b");
  assertEquals(sanitizeHtml('<embed src=x>c'), "c");
  assertEquals(sanitizeHtml('<form action=x>d</form>'), "");
});

Deno.test("sanitizeHtml — removes inline event handlers (quoted + unquoted)", () => {
  assertEquals(sanitizeHtml('<a onclick="evil()">x</a>'), "<a>x</a>");
  assertEquals(sanitizeHtml('<a onmouseover=evil>x</a>'), "<a>x</a>");
});

Deno.test("sanitizeHtml — neutralizes javascript:/vbscript: URIs", () => {
  assertEquals(sanitizeHtml('<a href="javascript:evil">x</a>'), '<a href="blocked:evil">x</a>');
  assertEquals(sanitizeHtml('<a href="vbscript:evil">x</a>'), '<a href="blocked:evil">x</a>');
});

Deno.test("sanitizeHtml — leaves safe markup untouched", () => {
  const safe = '<h1>Hello</h1><p style="color:red">World</p><a href="https://wrotate.com">link</a>';
  assertEquals(sanitizeHtml(safe), safe);
});

// ---- validateBroadcastInput ----
Deno.test("validateBroadcastInput — valid minimal input passes", () => {
  assertEquals(validateBroadcastInput({ subject: "s", html: "<p>h</p>" }), null);
});

Deno.test("validateBroadcastInput — missing subject or html", () => {
  assertEquals(validateBroadcastInput({ html: "<p>h</p>" }), "subject and html are required");
  assertEquals(validateBroadcastInput({ subject: "s" }), "subject and html are required");
});

Deno.test("validateBroadcastInput — unknown cohort", () => {
  assertEquals(
    validateBroadcastInput({ subject: "s", html: "h", cohort: "nope", campaign_id: "c1" }),
    "Unknown cohort: nope",
  );
});

Deno.test("validateBroadcastInput — cohort requires campaign_id", () => {
  assertEquals(
    validateBroadcastInput({ subject: "s", html: "h", cohort: "april" }),
    "campaign_id is required when cohort is set",
  );
});

Deno.test("validateBroadcastInput — valid cohort + campaign_id passes", () => {
  assertEquals(
    validateBroadcastInput({ subject: "s", html: "h", cohort: "may", campaign_id: "c1" }),
    null,
  );
});

Deno.test("validateBroadcastInput — html over 500KB rejected", () => {
  const big = "x".repeat(512001);
  assertEquals(validateBroadcastInput({ subject: "s", html: big }), "Email body too large (max 500KB)");
});

Deno.test("validateBroadcastInput — html exactly 512000 passes", () => {
  const exact = "x".repeat(512000);
  assertEquals(validateBroadcastInput({ subject: "s", html: exact }), null);
});

// ---- COHORTS ----
Deno.test("COHORTS — has expected windows", () => {
  assertEquals(COHORTS.pre_april, { lt: "2026-04-01T00:00:00Z" });
  assertEquals(COHORTS.april, { gte: "2026-04-01T00:00:00Z", lt: "2026-05-01T00:00:00Z" });
  assertEquals(COHORTS.may, { gte: "2026-05-01T00:00:00Z", lt: "2026-06-01T00:00:00Z" });
});

// ---- filterOptedIn ----
Deno.test("filterOptedIn — default (no prefs) is opted in", () => {
  const out = filterOptedIn([{ id: "a" }, { id: "b", email_prefs: {} }]);
  assertEquals(out.map((p) => p.id), ["a", "b"]);
});

Deno.test("filterOptedIn — explicit updates:false is excluded", () => {
  const out = filterOptedIn([
    { id: "a", email_prefs: { updates: true } },
    { id: "b", email_prefs: { updates: false } },
  ]);
  assertEquals(out.map((p) => p.id), ["a"]);
});

Deno.test("filterOptedIn — null email_prefs treated as opted in", () => {
  const out = filterOptedIn([{ id: "a", email_prefs: null }]);
  assertEquals(out.map((p) => p.id), ["a"]);
});

// ---- excludeIds ----
Deno.test("excludeIds — removes matching ids from an array source", () => {
  const out = excludeIds([{ id: "a" }, { id: "b" }, { id: "c" }], ["b"]);
  assertEquals(out.map((p) => p.id), ["a", "c"]);
});

Deno.test("excludeIds — accepts a Set source", () => {
  const out = excludeIds([{ id: "a" }, { id: "b" }], new Set(["a"]));
  assertEquals(out.map((p) => p.id), ["b"]);
});

Deno.test("excludeIds — empty excluded set keeps all", () => {
  const out = excludeIds([{ id: "a" }], []);
  assertEquals(out.map((p) => p.id), ["a"]);
});

// ---- filterNeverMeasured ----
Deno.test("filterNeverMeasured — drops users who measured", () => {
  const out = filterNeverMeasured([{ id: "a" }, { id: "b" }], ["b"]);
  assertEquals(out.map((p) => p.id), ["a"]);
});

Deno.test("filterNeverMeasured — ignores null/undefined ids in measured set", () => {
  const out = filterNeverMeasured([{ id: "a" }, { id: "b" }], [null, undefined, "a"]);
  assertEquals(out.map((p) => p.id), ["b"]);
});

// ---- isDormant / dormantCutoffMs ----
Deno.test("dormantCutoffMs — 21 days before now", () => {
  const now = Date.parse("2026-06-01T00:00:00Z");
  assertEquals(dormantCutoffMs(now), now - 21 * DAY);
});

Deno.test("isDormant — never signed in (null) is dormant", () => {
  const cutoff = Date.parse("2026-05-11T00:00:00Z");
  assertEquals(isDormant(null, cutoff), true);
  assertEquals(isDormant(undefined, cutoff), true);
});

Deno.test("isDormant — signed in before cutoff is dormant", () => {
  const cutoff = Date.parse("2026-05-11T00:00:00Z");
  assertEquals(isDormant("2026-05-01T00:00:00Z", cutoff), true);
});

Deno.test("isDormant — signed in at/after cutoff is active (not dormant)", () => {
  const cutoff = Date.parse("2026-05-11T00:00:00Z");
  assertEquals(isDormant("2026-05-11T00:00:00Z", cutoff), false); // equal → active (strict <)
  assertEquals(isDormant("2026-05-20T00:00:00Z", cutoff), false);
});

// ---- effectiveLimit ----
Deno.test("effectiveLimit — positive number floored", () => {
  assertEquals(effectiveLimit(20), 20);
  assertEquals(effectiveLimit(20.9), 20);
});

Deno.test("effectiveLimit — zero/negative/non-number → null", () => {
  assertEquals(effectiveLimit(0), null);
  assertEquals(effectiveLimit(-5), null);
  assertEquals(effectiveLimit(undefined), null);
  assertEquals(effectiveLimit("10"), null);
});

// ---- capRecipients ----
Deno.test("capRecipients — caps when limit smaller than list", () => {
  assertEquals(capRecipients([1, 2, 3, 4], 2), [1, 2]);
});

Deno.test("capRecipients — null limit returns full list", () => {
  assertEquals(capRecipients([1, 2, 3], null), [1, 2, 3]);
});

Deno.test("capRecipients — limit >= length returns full list", () => {
  assertEquals(capRecipients([1, 2, 3], 3), [1, 2, 3]);
  assertEquals(capRecipients([1, 2, 3], 10), [1, 2, 3]);
});

// ---- batchSegment ----
Deno.test("batchSegment — splits 7 into 3 batches (3,3,1)", () => {
  const list = [1, 2, 3, 4, 5, 6, 7];
  assertEquals(batchSegment(list, "batch_1"), [1, 2, 3]);
  assertEquals(batchSegment(list, "batch_2"), [4, 5, 6]);
  assertEquals(batchSegment(list, "batch_3"), [7]);
});

Deno.test("batchSegment — non-batch segment returns input unchanged", () => {
  const list = [1, 2, 3];
  assertEquals(batchSegment(list, "all"), [1, 2, 3]);
  assertEquals(batchSegment(list, "never_measured"), [1, 2, 3]);
});

Deno.test("batchSegment — batches partition the list with no overlap", () => {
  const list = Array.from({ length: 10 }, (_, i) => i);
  const combined = [
    ...batchSegment(list, "batch_1"),
    ...batchSegment(list, "batch_2"),
    ...batchSegment(list, "batch_3"),
  ];
  assertEquals(combined, list);
});

// ---- batchSegment: generalized "_NofM" form ----
Deno.test("batchSegment — may_onward 2-way split (108 → 54 + 54)", () => {
  const list = Array.from({ length: 108 }, (_, i) => i);
  const b1 = batchSegment(list, "may_onward_1of2");
  const b2 = batchSegment(list, "may_onward_2of2");
  assertEquals(b1.length, 54);
  assertEquals(b2.length, 54);
  assertEquals([...b1, ...b2], list); // partition, no overlap, no gap
});

Deno.test("batchSegment — _NofM with odd length (7 → 4 + 3)", () => {
  const list = [1, 2, 3, 4, 5, 6, 7];
  assertEquals(batchSegment(list, "may_onward_1of2"), [1, 2, 3, 4]);
  assertEquals(batchSegment(list, "may_onward_2of2"), [5, 6, 7]);
});

Deno.test("batchSegment — invalid _NofM (num > count) returns input unchanged", () => {
  const list = [1, 2, 3];
  assertEquals(batchSegment(list, "may_onward_3of2"), [1, 2, 3]);
});

// ---- segmentDateGte ----
Deno.test("segmentDateGte — may_onward (and its batches) map to May 1 gte", () => {
  assertEquals(segmentDateGte("may_onward"), "2026-05-01T00:00:00Z");
  assertEquals(segmentDateGte("may_onward_1of2"), "2026-05-01T00:00:00Z");
  assertEquals(segmentDateGte("may_onward_2of2"), "2026-05-01T00:00:00Z");
});

Deno.test("segmentDateGte — non-date segments return null", () => {
  assertEquals(segmentDateGte("all"), null);
  assertEquals(segmentDateGte("batch_1"), null);
  assertEquals(segmentDateGte("never_measured"), null);
});

Deno.test("SEGMENT_DATE_GTE — may_onward window has no upper bound", () => {
  assertEquals(SEGMENT_DATE_GTE.may_onward, "2026-05-01T00:00:00Z");
});

// ---- unsub helpers ----
Deno.test("unsubUrl — builds the unsubscribe URL", () => {
  assertEquals(
    unsubUrl("https://x.supabase.co", "uid-1", "sig-1"),
    "https://x.supabase.co/functions/v1/email-unsubscribe?uid=uid-1&cat=updates&sig=sig-1",
  );
});

Deno.test("unsubFooter — embeds the URL in the anchor", () => {
  const out = unsubFooter("https://u/x");
  assertEquals(out.includes('href="https://u/x"'), true);
  assertEquals(out.includes("Unsubscribe"), true);
});

Deno.test("unsubFooter — standard 'Unsubscribe · Manage preferences' footer", () => {
  const out = unsubFooter("https://u/x");
  assertEquals(out.includes('href="https://u/x"'), true);            // signed unsubscribe link
  assertEquals(out.includes("Unsubscribe"), true);
  assertEquals(out.includes("Manage preferences"), true);
  assertEquals(out.includes('href="https://wrotate.com/open"'), true); // manage prefs → open app
});
