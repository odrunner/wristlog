import { assertEquals } from "jsr:@std/assert";
import {
  batchSegment,
  capRecipients,
  COHORTS,
  dormantCutoffMs,
  effectiveLimit,
  excludeAlreadyEmailed,
  excludeIds,
  filterNeverMeasured,
  isCredentialFailure,
  keepIds,
  filterOptedIn,
  isDormant,
  isKnownSegment,
  nextBatchSlice,
  parseBatchSuffix,
  resolveBatchOutcome,
  sanitizeHtml,
  SEGMENT_DATE_GTE,
  segmentDateGte,
  segmentUserId,
  shouldTripBreaker,
  splitFirstBatch,
  unsubFooter,
  withUnsubFooter,
  unsubUrl,
  validateBroadcastInput,
} from "./lib.ts";

const DAY = 24 * 60 * 60 * 1000;

// ---- isKnownSegment ----
Deno.test("isKnownSegment — accepts every recognized form", () => {
  for (const s of ["all", "", undefined, null, "never_measured", "batch_1", "batch_2", "batch_3", "may_onward", "may_onward_1of2", "may_onward_2of2", "uid:" + "a".repeat(8) + "-aaaa-aaaa-aaaa-" + "a".repeat(12)]) {
    assertEquals(isKnownSegment(s as string), true, `expected known: ${s}`);
  }
});

Deno.test("isKnownSegment — rejects typos / unknown segments", () => {
  for (const s of ["all_users", "never_measure", "everyone", "may", "june_onward", "batch_4", "uid:not-a-uuid", "may_onward_3of2"]) {
    assertEquals(isKnownSegment(s), false, `expected unknown: ${s}`);
  }
});

Deno.test("validateBroadcastInput — rejects an unknown segment", () => {
  assertEquals(
    validateBroadcastInput({ subject: "s", html: "h", segment: "everyone" }),
    "Unknown segment: everyone",
  );
  assertEquals(validateBroadcastInput({ subject: "s", html: "h", segment: "all" }), null);
  assertEquals(validateBroadcastInput({ subject: "s", html: "h" }), null);
});

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

// ---- batchSegment: "_NofM" no longer handled here (index.ts wires the
// history-based parseBatchSuffix + excludeAlreadyEmailed + nextBatchSlice) ----
Deno.test("batchSegment — _NofM segment passes through unchanged", () => {
  const list = [1, 2, 3];
  assertEquals(batchSegment(list, "may_onward_1of2"), [1, 2, 3]);
});

// ---- parseBatchSuffix ----
Deno.test("parseBatchSuffix — parses valid _NofM suffixes", () => {
  assertEquals(parseBatchSuffix("may_onward_1of2"), { num: 1, count: 2 });
  assertEquals(parseBatchSuffix("may_onward_2of2"), { num: 2, count: 2 });
  assertEquals(parseBatchSuffix("x_3of5"), { num: 3, count: 5 });
});

Deno.test("parseBatchSuffix — non-batched segments return null", () => {
  assertEquals(parseBatchSuffix("all"), null);
  assertEquals(parseBatchSuffix("may_onward"), null);
  assertEquals(parseBatchSuffix("batch_1"), null);
  assertEquals(parseBatchSuffix("never_measured"), null);
});

Deno.test("parseBatchSuffix — invalid suffix (num > count, zero) returns null", () => {
  assertEquals(parseBatchSuffix("may_onward_3of2"), null);
  assertEquals(parseBatchSuffix("may_onward_0of2"), null);
});

// ---- excludeAlreadyEmailed ----
Deno.test("excludeAlreadyEmailed — drops recipients already sent, case-insensitive", () => {
  const recipients = [
    { uid: "a", email: "A@x.com" },
    { uid: "b", email: "b@x.com" },
    { uid: "c", email: "c@x.com" },
  ];
  const out = excludeAlreadyEmailed(recipients, ["a@X.com", "C@x.com"]);
  assertEquals(out.map((r) => r.uid), ["b"]);
});

Deno.test("excludeAlreadyEmailed — ignores null/undefined in sent list, empty keeps all", () => {
  const recipients = [{ uid: "a", email: "a@x.com" }];
  assertEquals(excludeAlreadyEmailed(recipients, [null, undefined]).length, 1);
  assertEquals(excludeAlreadyEmailed(recipients, []).length, 1);
});

// ---- nextBatchSlice ----
Deno.test("nextBatchSlice — 1of2 takes half, 2of2 takes everything remaining", () => {
  const list = [1, 2, 3, 4, 5, 6, 7];
  assertEquals(nextBatchSlice(list, 1, 2), [1, 2, 3, 4]); // ceil(7/2)
  assertEquals(nextBatchSlice(list, 2, 2), [1, 2, 3, 4, 5, 6, 7]); // last batch: all remaining
});

Deno.test("nextBatchSlice — two rounds with exclusion partition the list (no overlap, no skip)", () => {
  // Simulates the real flow: batch 1 sends, its members land in email_events,
  // batch 2 excludes them and takes everything left.
  const all = Array.from({ length: 108 }, (_, i) => ({ uid: `u${i}`, email: `u${i}@x.com` }));
  const b1 = nextBatchSlice(all, 1, 2);
  const remaining = excludeAlreadyEmailed(all, b1.map((r) => r.email));
  const b2 = nextBatchSlice(remaining, 2, 2);
  assertEquals(b1.length, 54);
  assertEquals(b2.length, 54);
  assertEquals([...b1, ...b2].map((r) => r.uid), all.map((r) => r.uid));
});

Deno.test("nextBatchSlice — re-clicking batch 1 after it sent cannot double-send", () => {
  const all = Array.from({ length: 10 }, (_, i) => ({ uid: `u${i}`, email: `u${i}@x.com` }));
  const b1 = nextBatchSlice(all, 1, 2); // 5 sent
  const remaining = excludeAlreadyEmailed(all, b1.map((r) => r.email));
  const b1again = nextBatchSlice(remaining, 1, 2); // re-click: only not-yet-sent users
  assertEquals(b1again.every((r) => !b1.includes(r)), true);
});

Deno.test("nextBatchSlice — 3-way batches converge to full coverage", () => {
  const all = Array.from({ length: 10 }, (_, i) => ({ uid: `u${i}`, email: `u${i}@x.com` }));
  const sent: string[] = [];
  for (let n = 1; n <= 3; n++) {
    const remaining = excludeAlreadyEmailed(all, sent);
    const batch = nextBatchSlice(remaining, n, 3);
    sent.push(...batch.map((r) => r.email));
  }
  assertEquals(sent.length, 10); // everyone exactly once
  assertEquals(new Set(sent).size, 10);
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

// ---- segmentUserId ----
Deno.test("segmentUserId — extracts the uuid from a uid: segment", () => {
  assertEquals(
    segmentUserId("uid:bbbc3d2b-4fbf-4a79-92e9-bf99dd2e934d"),
    "bbbc3d2b-4fbf-4a79-92e9-bf99dd2e934d",
  );
});

Deno.test("segmentUserId — non-uid segments return null", () => {
  assertEquals(segmentUserId("all"), null);
  assertEquals(segmentUserId("may_onward"), null);
  assertEquals(segmentUserId("uid:not-a-uuid"), null);
  assertEquals(segmentUserId("uid:"), null);
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

Deno.test("isKnownSegment — accepts one_done_winback", () => {
  assertEquals(isKnownSegment("one_done_winback"), true);
});

// Every segment the admin UI offers must pass validation. never_logged was
// implemented end to end — dropdown option, index.ts filter, never_logged_users
// RPC — but missing from this whitelist, so choosing it failed with
// "Unknown segment: never_logged" before the filter ever ran.
Deno.test("isKnownSegment — accepts every segment the admin dropdown offers", () => {
  for (const s of ["all", "one_done_winback", "never_logged"]) {
    assertEquals(isKnownSegment(s), true, `expected known: ${s}`);
  }
});

Deno.test("validateBroadcastInput — accepts never_logged", () => {
  assertEquals(
    validateBroadcastInput({ subject: "s", html: "<p>h</p>", segment: "never_logged" }),
    null,
  );
});

// Reads the real dropdown rather than a copied list: a new <option> added to the
// admin UI without a matching whitelist entry fails here instead of at send time.
Deno.test("isKnownSegment — every #broadcast-segment option in index.html validates", () => {
  const html = Deno.readTextFileSync(
    new URL("../../../index.html", import.meta.url),
  );
  const select = /<select id="broadcast-segment">([\s\S]*?)<\/select>/.exec(html);
  assertEquals(select !== null, true, "could not find the #broadcast-segment select");
  const values = [...select![1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assertEquals(values.length > 0, true, "no <option> values parsed");
  for (const v of values) {
    assertEquals(isKnownSegment(v), true, `dropdown offers "${v}" but isKnownSegment rejects it`);
  }
});

Deno.test("keepIds — intersects the eligible set with a server-resolved segment", () => {
  const profiles = [{ id: "a" }, { id: "b" }, { id: "c" }];
  // one_and_done_winback_users() returns the segment; keepIds narrows to it.
  assertEquals(keepIds(profiles, ["a", "c"]).map((p) => p.id), ["a", "c"]);
  assertEquals(keepIds(profiles, new Set(["b"])).map((p) => p.id), ["b"]);
  // Ids not present among the profiles are simply ignored.
  assertEquals(keepIds(profiles, ["a", "zzz"]).map((p) => p.id), ["a"]);
});

Deno.test("keepIds — an empty segment sends to nobody, never to everybody", () => {
  // The dangerous failure for a broadcast filter: an empty result must NOT be
  // treated as "no filter" and blast the whole eligible list.
  const profiles = [{ id: "a" }, { id: "b" }];
  assertEquals(keepIds(profiles, []).length, 0);
  assertEquals(keepIds(profiles, new Set()).length, 0);
  assertEquals(keepIds([], ["a"]).length, 0);
});

Deno.test("isCredentialFailure flags auth rejections only", () => {
  assertEquals(isCredentialFailure(401), true);
  assertEquals(isCredentialFailure(403), true);
  // Not credentials: a rejected recipient, a throttle, a provider outage.
  assertEquals(isCredentialFailure(400), false);
  assertEquals(isCredentialFailure(422), false);
  assertEquals(isCredentialFailure(429), false);
  assertEquals(isCredentialFailure(500), false);
  assertEquals(isCredentialFailure(0), false);
});

Deno.test("shouldTripBreaker fires whenever the batch has any non-retryable failure", () => {
  // Even the proportional (majority-failed) rule left a window: SES sends in
  // waves of 10, so a mid-batch failure can produce e.g. 50 ok / 38
  // non-retryable out of 88 — 50*2 > 88, so a majority rule does not trip,
  // and 38 people are dropped forever. The owner accepted the trade of the
  // stricter rule explicitly: one real bad address gets a few retries before
  // anyone notices (a deferral costs a night's delay); an actual transport
  // break gets caught on the first non-retryable row instead of the 39th
  // (a `failed` costs a person their email permanently).
  assertEquals(shouldTripBreaker(1, 100), true);
  assertEquals(shouldTripBreaker(38, 88), true); // the wave-6 scenario above
  assertEquals(shouldTripBreaker(1, 1), true);
  // Only retryable failures (throttling, 5xx, network) present. Those
  // already defer through the normal per-row path — no permanent-looking
  // verdict occurred, so there's nothing to distrust the rest of the batch
  // over.
  assertEquals(shouldTripBreaker(0, 100), false);
  assertEquals(shouldTripBreaker(0, 1), false);
  // An empty batch is not evidence of anything.
  assertEquals(shouldTripBreaker(0, 0), false);
});

Deno.test("resolveBatchOutcome — a single non-retryable failure defers the whole batch, fails none", () => {
  // Same shape as the 2026-07-25 incident, but now catchable on the FIRST
  // permanent-looking row rather than needing every row to look permanent:
  // one 400-class rejection is enough to distrust the rest of the batch.
  const result = resolveBatchOutcome(
    [1, 2, 3],
    [{ id: 4, error: "400 MailFromDomainNotVerified" }],
    [{ id: 5, error: "429 throttled" }],
    5,
  );
  // A successful send is never undone — it's already been delivered.
  assertEquals(result.sentIds, [1, 2, 3]);
  assertEquals(result.failedRows, []);
  assertEquals(result.deferredRows.map((r) => r.id).sort(), [4, 5]);
});

Deno.test("resolveBatchOutcome — only retryable failures present does not trip", () => {
  // No non-retryable verdict occurred, so there's no signal the transport is
  // broken — the retryable rows already defer through the ordinary path,
  // and there are no failedRows for the breaker to fold.
  const result = resolveBatchOutcome(
    [1],
    [],
    [{ id: 2, error: "429 throttled" }, { id: 3, error: "500 server error" }],
    3,
  );
  assertEquals(result.sentIds, [1]);
  assertEquals(result.failedRows, []);
  assertEquals(result.deferredRows.map((r) => r.id), [2, 3]);
});

Deno.test("resolveBatchOutcome — an empty batch is untouched (not treated as a trip)", () => {
  const result = resolveBatchOutcome([], [], [], 0);
  assertEquals(result.sentIds, []);
  assertEquals(result.failedRows, []);
  assertEquals(result.deferredRows, []);
});

// ── splitFirstBatch ──────────────────────────────────────────────────────────
const TEN = Array.from({ length: 10 }, (_, i) => i + 1);

Deno.test("splitFirstBatch — holds everything past the first N", () => {
  const { pending, held } = splitFirstBatch(TEN, 3);
  assertEquals(pending, [1, 2, 3]);
  assertEquals(held, [4, 5, 6, 7, 8, 9, 10]);
});

Deno.test("splitFirstBatch — no batch size means send it all, the old behaviour", () => {
  for (const v of [undefined, null, 0, "", false]) {
    const { pending, held } = splitFirstBatch(TEN, v);
    assertEquals(pending.length, 10, `${JSON.stringify(v)} should hold nothing`);
    assertEquals(held.length, 0);
  }
});

Deno.test("splitFirstBatch — junk is treated as no batch, never as a hold-everything", () => {
  // A NaN reaching the slice as 0 would hold the ENTIRE audience behind a
  // review gate the operator never asked for — silence is the wrong failure.
  for (const v of ["abc", {}, [], NaN, Infinity, -Infinity, -5]) {
    const { pending, held } = splitFirstBatch(TEN, v);
    assertEquals(pending.length, 10, `${JSON.stringify(v)} should hold nothing`);
    assertEquals(held.length, 0);
  }
});

Deno.test("splitFirstBatch — a batch at or above the audience holds nothing", () => {
  // Not a staged send at all. Holding zero rows while flagging the campaign
  // HELD would strand a "Send remaining 0" button in the admin list.
  for (const n of [10, 11, 500]) {
    const { pending, held } = splitFirstBatch(TEN, n);
    assertEquals(pending.length, 10);
    assertEquals(held.length, 0);
  }
});

Deno.test("splitFirstBatch — a fractional batch truncates rather than throwing", () => {
  const { pending, held } = splitFirstBatch(TEN, 2.9);
  assertEquals(pending, [1, 2]);
  assertEquals(held.length, 8);
});

Deno.test("splitFirstBatch — every row lands in exactly one side, order preserved", () => {
  const { pending, held } = splitFirstBatch(TEN, 4);
  assertEquals([...pending, ...held], TEN);
});

Deno.test("splitFirstBatch — an empty audience is not a staged send", () => {
  const { pending, held } = splitFirstBatch([], 50);
  assertEquals(pending, []);
  assertEquals(held, []);
});

// ── withUnsubFooter ──────────────────────────────────────────────────────────
// Regression: the footer used to be appended AFTER </html>. Mail clients hoist
// trailing content into the body with no surrounding layout, so it rendered
// full-bleed and flush-left below the card in every broadcast ever sent.
const DOC = `<!DOCTYPE html><html><head></head><body style="background:#f4f4f4;">` +
  `<table><tr><td>card</td></tr></table>` +
  `</body></html>`;

Deno.test("withUnsubFooter — lands inside <body>, never after </html>", () => {
  const out = withUnsubFooter(DOC, "https://u/x");
  assertEquals(out.endsWith("</body></html>"), true);
  assertEquals(out.indexOf("Unsubscribe") < out.indexOf("</body>"), true);
  // Nothing at all may trail the document.
  assertEquals(out.slice(out.indexOf("</html>") + "</html>".length), "");
});

Deno.test("withUnsubFooter — the footer follows the card, not precedes it", () => {
  const out = withUnsubFooter(DOC, "https://u/x");
  assertEquals(out.indexOf("card") < out.indexOf("Unsubscribe"), true);
});

Deno.test("withUnsubFooter — carries its own centred, card-width layout", () => {
  // Whatever template it lands in, it must bring the page background, the
  // gutter and the card's 480px so it lines up instead of going full-bleed.
  const out = unsubFooter("https://u/x");
  assertEquals(out.includes("max-width:480px"), true);
  assertEquals(out.includes("background:#f4f4f4"), true);
  assertEquals(out.includes('align="center"'), true);
  // The old bare div is what broke the layout; it must not come back.
  assertEquals(out.startsWith("<table"), true);
});

Deno.test("withUnsubFooter — a template with no </body> still gets a link", () => {
  // An unsubscribe link is a legal requirement, so a partial template appends
  // rather than silently dropping it.
  const out = withUnsubFooter("<div>fragment</div>", "https://u/x");
  assertEquals(out.includes('href="https://u/x"'), true);
  assertEquals(out.startsWith("<div>fragment</div>"), true);
});

Deno.test("withUnsubFooter — targets the LAST </body>, not one inside the copy", () => {
  // Body copy quoting markup must not capture the footer into the middle.
  const html = `<html><body><p>write &lt;/body&gt; like this</p></body></html>`;
  const out = withUnsubFooter(html, "https://u/x");
  assertEquals(out.endsWith("</body></html>"), true);
  assertEquals(out.indexOf("Unsubscribe") > out.indexOf("write"), true);
});
