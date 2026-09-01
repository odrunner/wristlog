// Tests for the IO half of the click-tracking gate. No network: the Supabase
// client is stubbed, because what matters here is the FAIL-OPEN behaviour —
// every failure path must yield "untracked", never a tracked message.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { fetchTrackedUids, trackedConfigSet, TRACKED_CONFIG_SET } from "./tracked.ts";

// Minimal stand-in for the PostgREST builder chain used by fetchTrackedUids:
// .from().select().in().not() finally resolves to { data, error }.
function stubDb(result: { data?: unknown; error?: unknown } | (() => never)) {
  const calls: { uids?: string[] } = {};
  const chain = {
    select: () => chain,
    in: (_col: string, uids: string[]) => {
      calls.uids = uids;
      return chain;
    },
    not: () => (typeof result === "function" ? result() : Promise.resolve(result)),
  };
  return { db: { from: () => chain }, calls };
}

Deno.test("fetchTrackedUids — maps rows through the 2.6 gate", async () => {
  const { db, calls } = stubDb({
    data: [
      { user_id: "u1", app_version: "2.6" },
      { user_id: "u2", app_version: "2.5" },
      { user_id: "u3", app_version: "2.7" },
    ],
  });
  const s = await fetchTrackedUids(db, ["u1", "u2", "u3"]);
  assertEquals(s.has("u1"), true);
  assertEquals(s.has("u2"), false);
  assertEquals(s.has("u3"), true);
  assertEquals(calls.uids, ["u1", "u2", "u3"]);
});

Deno.test("fetchTrackedUids — no uids means no query and no tracking", async () => {
  const { db, calls } = stubDb({ data: [{ user_id: "u1", app_version: "2.6" }] });
  assertEquals((await fetchTrackedUids(db, [])).size, 0);
  assertEquals(calls.uids, undefined); // never queried
});

// The three fail-open paths. Each one must behave exactly like "nobody
// qualifies" rather than propagating, because the caller is mid-send.
Deno.test("fetchTrackedUids — a query error fails open to untracked", async () => {
  const { db } = stubDb({ error: { message: "boom" } });
  assertEquals((await fetchTrackedUids(db, ["u1"])).size, 0);
});

Deno.test("fetchTrackedUids — a thrown client error fails open to untracked", async () => {
  const { db } = stubDb(() => {
    throw new Error("network down");
  });
  assertEquals((await fetchTrackedUids(db, ["u1"])).size, 0);
});

Deno.test("fetchTrackedUids — null data fails open to untracked", async () => {
  const { db } = stubDb({ data: null });
  assertEquals((await fetchTrackedUids(db, ["u1"])).size, 0);
});

Deno.test("trackedConfigSet — spreads the tracked set only for a qualifying user", async () => {
  const { db } = stubDb({ data: [{ user_id: "u1", app_version: "2.6" }] });
  assertEquals(await trackedConfigSet(db, "u1"), { configSet: TRACKED_CONFIG_SET });
});

Deno.test("trackedConfigSet — a non-qualifying user spreads nothing", async () => {
  const { db } = stubDb({ data: [{ user_id: "u1", app_version: "2.5" }] });
  assertEquals(await trackedConfigSet(db, "u1"), {});
});

Deno.test("trackedConfigSet — a missing uid spreads nothing and never queries", async () => {
  const { db, calls } = stubDb({ data: [{ user_id: "u1", app_version: "2.6" }] });
  assertEquals(await trackedConfigSet(db, null), {});
  assertEquals(await trackedConfigSet(db, undefined), {});
  assertEquals(await trackedConfigSet(db, ""), {});
  assertEquals(calls.uids, undefined);
});
