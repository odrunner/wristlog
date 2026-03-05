// Supabase Edge Function: send-push
// Triggered by Database Webhook on INSERT into notifications table.
// Sends an APNs push notification to the target user's iOS device(s).
//
// Required Supabase secrets (set via `supabase secrets set`):
//   APNS_KEY_P8       — the .p8 key file contents (full PEM string)
//   APNS_KEY_ID       — the Key ID from Apple Developer
//   APNS_TEAM_ID      — your Apple Developer Team ID
//   SUPABASE_URL      — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// APNs configuration
const APNS_KEY_P8 = Deno.env.get("APNS_KEY_P8") ?? "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const BUNDLE_ID = "com.wrotate.Wrotate";

// Use production APNs by default; set APNS_SANDBOX=true for development
const USE_SANDBOX = Deno.env.get("APNS_SANDBOX") === "true";
const APNS_HOST = USE_SANDBOX
  ? "https://api.sandbox.push.apple.com"
  : "https://api.push.apple.com";

// Notification type → human-readable message
function buildMessage(
  type: string,
  actorName: string
): { title: string; body: string } | null {
  const title = "WRotate";
  switch (type) {
    case "like":
      return { title, body: `${actorName} liked your post` };
    case "comment":
      return { title, body: `${actorName} commented on your post` };
    case "follow":
      return { title, body: `${actorName} started following you` };
    case "follow_request":
      return { title, body: `${actorName} requested to follow you` };
    case "follow_accepted":
      return { title, body: `${actorName} accepted your follow request` };
    case "friend_request":
      return { title, body: `${actorName} sent you a close friend request` };
    case "friend_accepted":
      return { title, body: `${actorName} accepted your close friend request` };
    case "club_invite":
      return { title, body: `${actorName} invited you to join a club` };
    case "club_join_request":
      return { title, body: `${actorName} wants to join your club` };
    case "club_join_accepted":
      return { title, body: `${actorName} approved your club request` };
    case "mention":
      return { title, body: `${actorName} mentioned you` };
    case "comment_like":
      return { title, body: `${actorName} liked your comment` };
    default:
      return { title, body: `${actorName} sent you a notification` };
  }
}

// Create a JWT for APNs authentication
async function createAPNsJWT(): Promise<string> {
  const header = { alg: "ES256", kid: APNS_KEY_ID };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: APNS_TEAM_ID, iat: now };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const signingInput = `${headerB64}.${payloadB64}`;

  // Import the P8 key
  const pemContents = APNS_KEY_P8.replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyData = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(signingInput)
  );

  // Convert DER signature to raw r||s format expected by JWT
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${signingInput}.${sigB64}`;
}

// Send push to a single device token
async function sendPush(
  token: string,
  message: { title: string; body: string },
  jwt: string
): Promise<{ token: string; success: boolean; status: number }> {
  const url = `${APNS_HOST}/3/device/${token}`;
  const payload = {
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
      badge: 1,
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    return { token, success: response.ok, status: response.status };
  } catch (err) {
    console.error(`[send-push] Failed to send to ${token}:`, err);
    return { token, success: false, status: 0 };
  }
}

serve(async (req) => {
  try {
    const body = await req.json();

    // Webhook payload from Supabase: { type: "INSERT", record: {...}, ... }
    const record = body.record;
    if (!record || !record.user_id || !record.type) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
      });
    }

    const { user_id, type, actor_id } = record;

    // Don't send push for self-notifications
    if (user_id === actor_id) {
      return new Response(JSON.stringify({ skipped: "self-notification" }), {
        status: 200,
      });
    }

    // Create Supabase admin client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Look up recipient's device tokens
    const { data: tokens, error: tokensError } = await supabase
      .from("device_tokens")
      .select("token")
      .eq("user_id", user_id)
      .eq("platform", "ios");

    if (tokensError || !tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ skipped: "no device tokens", error: tokensError }),
        { status: 200 }
      );
    }

    // Look up actor's display name
    let actorName = "Someone";
    if (actor_id) {
      const { data: actor } = await supabase
        .from("profiles")
        .select("display_name, username")
        .eq("id", actor_id)
        .single();
      if (actor) {
        actorName = actor.display_name || actor.username || "Someone";
      }
    }

    // Build message
    const message = buildMessage(type, actorName);
    if (!message) {
      return new Response(JSON.stringify({ skipped: "unknown type" }), {
        status: 200,
      });
    }

    // Create APNs JWT
    const jwt = await createAPNsJWT();

    // Send to all devices
    const results = await Promise.all(
      tokens.map((t: { token: string }) => sendPush(t.token, message, jwt))
    );

    // Clean up expired tokens (410 = token no longer valid)
    const expired = results.filter((r) => r.status === 410);
    if (expired.length > 0) {
      const expiredTokens = expired.map((r) => r.token);
      await supabase
        .from("device_tokens")
        .delete()
        .in("token", expiredTokens);
      console.log(`[send-push] Cleaned up ${expired.length} expired tokens`);
    }

    return new Response(
      JSON.stringify({
        sent: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        cleaned: expired.length,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[send-push] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
