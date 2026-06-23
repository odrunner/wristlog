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

serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth" }), { status: 401 });
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
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const badgeNames: string[] = Array.isArray(body?.badgeNames) ? body.badgeNames : [];
    const message = buildBadgePushMessage(badgeNames);
    if (!message) {
      return new Response(JSON.stringify({ skipped: "no badges" }), { status: 200 });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: tokens } = await admin
      .from("device_tokens")
      .select("token")
      .eq("user_id", user.id)
      .eq("platform", "ios");

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: "no device tokens" }), { status: 200 });
    }

    const jwt = await createAPNsJWT(APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID);
    const results = await Promise.all(
      tokens.map((t: { token: string }) => sendPush(t.token, message, jwt, APNS_HOST)),
    );

    // Clean up Apple-rejected (410) tokens.
    const expired = results.filter((r) => r.status === 410).map((r) => r.token);
    if (expired.length > 0) {
      await admin.from("device_tokens").delete().in("token", expired);
    }

    return new Response(
      JSON.stringify({
        sent: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        cleaned: expired.length,
      }),
      { status: 200 },
    );
  } catch (err) {
    console.error("[send-badge-push] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
