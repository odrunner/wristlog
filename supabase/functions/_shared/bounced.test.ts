import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  excludeBounced,
  fetchBouncedEmails,
  isPermanentBounce,
  latestPermanentBounces,
  suppressedEmails,
} from "./bounced.ts";

Deno.test("isPermanentBounce: Transient bounces are not suppressed", () => {
  assertEquals(isPermanentBounce("Transient"), false);
  assertEquals(isPermanentBounce("transient"), false);
  assertEquals(isPermanentBounce("  Transient  "), false);
});

Deno.test("isPermanentBounce: Permanent and Undetermined are suppressed", () => {
  assertEquals(isPermanentBounce("Permanent"), true);
  assertEquals(isPermanentBounce("Undetermined"), true);
});

Deno.test("isPermanentBounce: unknown/null type is suppressed (fail closed)", () => {
  // Non-SES webhook payloads have no bounceType. An unclassifiable bounce must
  // stop the sending, not keep it going.
  assertEquals(isPermanentBounce(null), true);
  assertEquals(isPermanentBounce(undefined), true);
  assertEquals(isPermanentBounce(""), true);
});

Deno.test("latestPermanentBounces: keeps permanent, drops transient, lowercases", () => {
  const m = latestPermanentBounces([
    { email_to: "Dead@Example.com", created_at: "2026-08-01T00:00:00Z", bounce_type: "Permanent" },
    { email_to: "full-inbox@example.com", created_at: "2026-08-01T00:00:00Z", bounce_type: "Transient" },
    { email_to: "  Spaced@Example.com  ", created_at: "2026-08-01T00:00:00Z", bounce_type: null },
  ]);
  assertEquals(m.has("dead@example.com"), true);
  assertEquals(m.has("full-inbox@example.com"), false);
  assertEquals(m.has("spaced@example.com"), true);
  assertEquals(m.size, 2);
});

Deno.test("latestPermanentBounces: keeps the newest bounce per address", () => {
  const m = latestPermanentBounces([
    { email_to: "a@example.com", created_at: "2026-07-01T00:00:00Z", bounce_type: "Permanent" },
    { email_to: "a@example.com", created_at: "2026-08-01T00:00:00Z", bounce_type: "Permanent" },
  ]);
  assertEquals(m.get("a@example.com"), Date.parse("2026-08-01T00:00:00Z"));
});

Deno.test("latestPermanentBounces: tolerates null/missing addresses", () => {
  const m = latestPermanentBounces([
    { email_to: null, created_at: "2026-08-01T00:00:00Z", bounce_type: "Permanent" },
    { email_to: "ok@example.com", created_at: "2026-08-01T00:00:00Z", bounce_type: "Permanent" },
  ]);
  assertEquals([...m.keys()], ["ok@example.com"]);
});

Deno.test("suppressedEmails: an address that delivered after bouncing is NOT suppressed", () => {
  // The real test@wrotate.com case: hard-bounced 2026-07-31 with routing
  // missing, delivered fine on 2026-08-07 once the rule was added.
  const set = suppressedEmails(
    [{ email_to: "test@wrotate.com", created_at: "2026-07-31T04:15:11Z", bounce_type: "Permanent" }],
    [{ email_to: "test@wrotate.com", created_at: "2026-08-07T20:20:45Z" }],
  );
  assertEquals(set.size, 0);
});

Deno.test("suppressedEmails: a delivery BEFORE the bounce does not rescue the address", () => {
  const set = suppressedEmails(
    [{ email_to: "dead@example.com", created_at: "2026-08-07T00:00:00Z", bounce_type: "Permanent" }],
    [{ email_to: "dead@example.com", created_at: "2026-03-01T00:00:00Z" }],
  );
  assertEquals([...set], ["dead@example.com"]);
});

Deno.test("suppressedEmails: bounced with no delivery history stays suppressed", () => {
  const set = suppressedEmails(
    [{ email_to: "gone@example.com", created_at: "2026-08-07T00:00:00Z", bounce_type: "Permanent" }],
    [],
  );
  assertEquals([...set], ["gone@example.com"]);
});

Deno.test("suppressedEmails: re-bounce after a recovery suppresses again", () => {
  const set = suppressedEmails(
    [
      { email_to: "flaky@example.com", created_at: "2026-06-01T00:00:00Z", bounce_type: "Permanent" },
      { email_to: "flaky@example.com", created_at: "2026-08-08T00:00:00Z", bounce_type: "Permanent" },
    ],
    [{ email_to: "flaky@example.com", created_at: "2026-07-01T00:00:00Z" }],
  );
  assertEquals([...set], ["flaky@example.com"]);
});

Deno.test("excludeBounced: removes blocked recipients case-insensitively", () => {
  const recipients = [
    { uid: "1", email: "Dead@Example.com" },
    { uid: "2", email: "live@example.com" },
  ];
  const out = excludeBounced(recipients, new Set(["dead@example.com"]));
  assertEquals(out.map((r) => r.uid), ["2"]);
});

Deno.test("excludeBounced: empty block set returns the input untouched", () => {
  const recipients = [{ uid: "1", email: "a@example.com" }];
  assertEquals(excludeBounced(recipients, new Set()), recipients);
});

// Minimal PostgREST-shaped stub: .from().select().eq() is awaitable and also
// chains .in(), matching how fetchBouncedEmails queries bounces then deliveries.
function stubDb(
  byEvent: Record<string, { data: unknown; error?: { message: string } }>,
  calls: Record<string, unknown> = {},
) {
  return {
    from(table: string) {
      calls.table = table;
      return {
        select(cols: string) {
          (calls.selects ??= [] as string[]) as string[];
          (calls.selects as string[]).push(cols);
          return {
            eq(_col: string, val: string) {
              const res = byEvent[val] ?? { data: [], error: null };
              const settled = Promise.resolve({ data: res.data, error: res.error ?? null });
              return Object.assign(settled, {
                in(_c: string, addrs: string[]) {
                  calls.inAddrs = addrs;
                  return settled;
                },
              });
            },
          };
        },
      };
    },
  };
}

Deno.test("fetchBouncedEmails: builds the set from email_events", async () => {
  const calls: Record<string, unknown> = {};
  const set = await fetchBouncedEmails(stubDb({
    bounced: {
      data: [
        { email_to: "dead@example.com", created_at: "2026-08-01T00:00:00Z", bounce_type: "Permanent" },
        { email_to: "soft@example.com", created_at: "2026-08-01T00:00:00Z", bounce_type: "Transient" },
      ],
    },
    delivered: { data: [] },
  }, calls));
  assertEquals(calls.table, "email_events");
  assertEquals([...set], ["dead@example.com"]);
});

Deno.test("fetchBouncedEmails: a later delivery un-suppresses the address", async () => {
  const set = await fetchBouncedEmails(stubDb({
    bounced: {
      data: [{ email_to: "test@wrotate.com", created_at: "2026-07-31T04:15:11Z", bounce_type: "Permanent" }],
    },
    delivered: {
      data: [{ email_to: "test@wrotate.com", created_at: "2026-08-07T20:20:45Z" }],
    },
  }));
  assertEquals(set.size, 0);
});

Deno.test("fetchBouncedEmails: only looks up deliveries for addresses that bounced", async () => {
  const calls: Record<string, unknown> = {};
  await fetchBouncedEmails(stubDb({
    bounced: {
      data: [
        { email_to: "a@example.com", created_at: "2026-08-01T00:00:00Z", bounce_type: "Permanent" },
        { email_to: "a@example.com", created_at: "2026-08-02T00:00:00Z", bounce_type: "Permanent" },
      ],
    },
    delivered: { data: [] },
  }, calls));
  assertEquals(calls.inAddrs, ["a@example.com"]);
});

Deno.test("fetchBouncedEmails: no bounces means no delivery lookup at all", async () => {
  const calls: Record<string, unknown> = {};
  const set = await fetchBouncedEmails(stubDb({ bounced: { data: [] } }, calls));
  assertEquals(set.size, 0);
  assertEquals(calls.inAddrs, undefined);
});

Deno.test("fetchBouncedEmails: throws rather than returning an empty set on error", async () => {
  // A silent empty set would disable suppression without anyone noticing —
  // exactly the RLS failure mode this guards against.
  const supabase = stubDb({ bounced: { data: null, error: { message: "permission denied" } } });
  await assertRejects(() => fetchBouncedEmails(supabase), Error, "permission denied");
});
