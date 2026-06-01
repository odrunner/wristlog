// Supabase Edge Function: demo-login
// Returns a session for the read-only demo account.
// POST /demo-login  (no body needed)
// The demo password is stored server-side only — never exposed to the client.
// Rate limited: 5 requests per IP per 10-minute window.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, isWithinWindow, rateKey, resolveIp, windowStartIso } from "./lib.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  // Rate limit by IP
  const ip = resolveIp((name) => req.headers.get(name));
  const key = rateKey(ip);
  const windowStart = windowStartIso(Date.now());

  const { data: rl } = await adminClient
    .from("rate_limits")
    .select("request_count, window_start")
    .eq("function_name", key)
    .eq("user_id", "00000000-0000-0000-0000-000000000000")
    .single();

  if (isRateLimited(rl, windowStart)) {
    return new Response(JSON.stringify({ error: "Too many requests — try again later" }), {
      status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Update or insert rate limit counter
  if (isWithinWindow(rl, windowStart)) {
    await adminClient.from("rate_limits")
      .update({ request_count: rl.request_count + 1 })
      .eq("function_name", key)
      .eq("user_id", "00000000-0000-0000-0000-000000000000");
  } else {
    await adminClient.from("rate_limits")
      .upsert({
        user_id: "00000000-0000-0000-0000-000000000000",
        function_name: key,
        window_start: new Date().toISOString(),
        request_count: 1,
      }, { onConflict: "user_id,function_name" });
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

  return new Response(JSON.stringify({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  }), {
    status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
