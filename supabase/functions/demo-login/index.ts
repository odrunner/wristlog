// Supabase Edge Function: demo-login
// Returns a session for the read-only demo account.
// POST /demo-login  (no body needed)
// The demo password is stored server-side only — never exposed to the client.
// Rate limited: 5 requests per IP per 10-minute window.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { GLOBAL_KEY, GLOBAL_LIMIT, GLOBAL_WINDOW_MS, RATE_LIMIT, RATE_WINDOW_MS, hashIp, rateKey, resolveIp } from "./lib.ts";
import { serviceKey, publishableKey } from "../_shared/keys.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// The demo account's id, looked up once per isolate (username "alexrivera").
let _demoId: string | null = null;
// deno-lint-ignore no-explicit-any
async function demoUserId(admin: any): Promise<string | null> {
  if (_demoId) return _demoId;
  const { data } = await admin.from("profiles").select("id").eq("username", "alexrivera").maybeSingle();
  _demoId = data?.id ?? null;
  return _demoId;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svcKey = serviceKey();
  const anonKey = publishableKey();
  const adminClient = createClient(supabaseUrl, svcKey);

  // Rate limits (audit SEC-23-18). The old counter was written under a
  // placeholder user id the rate_limits FK rejects, silently — so it never
  // counted anything. Counters now hang off the demo account's real id via the
  // atomic bump_rate_limit RPC, per hashed IP and globally; errors refuse.
  const demoId = await demoUserId(adminClient);
  const ip = resolveIp((name) => req.headers.get(name));
  const ipKey = rateKey((await hashIp(ip)) ?? "unknown");
  const nowMs = Date.now();
  const bump = async (fn: string, windowMs: number) => {
    const { data, error } = await adminClient.rpc("bump_rate_limit", {
      p_user: demoId, p_fn: fn,
      p_window_floor: new Date(nowMs - windowMs).toISOString(), p_now: new Date(nowMs).toISOString(),
    });
    return error || typeof data !== "number" ? null : data;
  };
  const perIp = demoId ? await bump(ipKey, RATE_WINDOW_MS) : null;
  const global = demoId ? await bump(GLOBAL_KEY, GLOBAL_WINDOW_MS) : null;
  if (perIp === null || global === null || perIp > RATE_LIMIT || global > GLOBAL_LIMIT) {
    return new Response(JSON.stringify({ error: "Too many requests — try again in a few minutes" }), {
      status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Sign in as the demo user
  const anonClient = createClient(supabaseUrl, anonKey);
  const { data, error } = await anonClient.auth.signInWithPassword({
    email: "demo@wrotate.com",
    password: Deno.env.get("DEMO_PASSWORD")!,
  });

  if (error || !data.session) {
    return new Response(JSON.stringify({ error: error?.message || "Login failed" }), {
      status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Log the demo view (distinct hashed IP) for admin traffic stats. Best-effort:
  // a logging failure must never break the demo login.
  try {
    await adminClient.from("demo_views").insert({ ip_hash: await hashIp(ip) });
  } catch (_e) { /* ignore */ }

  return new Response(JSON.stringify({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  }), {
    status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
