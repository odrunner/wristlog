// Supabase Edge Function: send-badge-push
// Called BY THE CLIENT (not a webhook) once after a badge-award pass.
// Authenticates the caller, then sends ONE APNs push summarizing the badges
// they just earned. A user can only push to themselves.
//
// Required Supabase secrets: APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID,
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto).
// Deploy with --no-verify-jwt (auth is handled here).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apnsHost, buildBadgePushMessage, createAPNsJWT, sendPush } from "./lib.ts";

const APNS_KEY_P8 = Deno.env.get("APNS_KEY_P8") ?? "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const USE_SANDBOX = Deno.env.get("APNS_SANDBOX") === "true";
const APNS_HOST = apnsHost(USE_SANDBOX);

// The browser preflights this call (it carries an Authorization header), and a
// preflight never carries one itself. Without an OPTIONS branch the guard below
// answered 401 and the real request was never sent — badge pushes had never
// actually left the web client.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "No auth" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Identify the caller from their token (they can only push to themselves).
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: "Invalid token" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const badgeNames: string[] = Array.isArray(body?.badgeNames) ? body.badgeNames : [];
    const message = buildBadgePushMessage(badgeNames);
    if (!message) {
      return json({ skipped: "no badges" }, 200);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: tokens } = await admin
      .from("device_tokens")
      .select("token")
      .eq("user_id", user.id)
      .eq("platform", "ios");

    if (!tokens || tokens.length === 0) {
      return json({ skipped: "no device tokens" }, 200);
    }

    const { count: unreadCount } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_read", false);

    const jwt = await createAPNsJWT(APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID);
    const results = await Promise.all(
      tokens.map((t: { token: string }) =>
        sendPush(t.token, message, jwt, APNS_HOST, { badge: unreadCount, userId: user.id })
      ),
    );

    // Clean up Apple-rejected (410) tokens.
    const expired = results.filter((r) => r.status === 410).map((r) => r.token);
    if (expired.length > 0) {
      await admin.from("device_tokens").delete().in("token", expired);
    }

    return json({
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      cleaned: expired.length,
    }, 200);
  } catch (err) {
    console.error("[send-badge-push] Error:", err);
    return json({ error: String(err) }, 500);
  }
});
