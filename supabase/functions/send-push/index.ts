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
import {
  apnsDeviceUrl,
  apnsHost,
  base64UrlEncode,
  base64UrlEncodeBytes,
  buildAlertPayload,
  buildMessage,
  buildRoute,
  isDeadToken,
  isValidRecord,
  parseApnsReason,
  resolveActorName,
  stripPemArmor,
} from "./lib.ts";

// APNs configuration
const APNS_KEY_P8 = Deno.env.get("APNS_KEY_P8") ?? "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const BUNDLE_ID = "com.wrotate.Wrotate";

// Use production APNs by default; set APNS_SANDBOX=true for development
const USE_SANDBOX = Deno.env.get("APNS_SANDBOX") === "true";
const APNS_HOST = apnsHost(USE_SANDBOX);

// Create a JWT for APNs authentication
async function createAPNsJWT(): Promise<string> {
  const header = { alg: "ES256", kid: APNS_KEY_ID };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: APNS_TEAM_ID, iat: now };

  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));

  const signingInput = `${headerB64}.${payloadB64}`;

  // Import the P8 key
  const pemContents = stripPemArmor(APNS_KEY_P8);
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
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(signature));

  return `${signingInput}.${sigB64}`;
}

// Send push to a single device token
async function sendPush(
  token: string,
  payload: Record<string, unknown>,
  jwt: string
): Promise<{ token: string; success: boolean; status: number; reason: string | null }> {
  const url = apnsDeviceUrl(APNS_HOST, token);

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

    // APNs explains a rejection in a JSON body ({"reason":"BadDeviceToken"}).
    // Read it so permanently-dead tokens can be pruned, not just 410s.
    const reason = response.ok
      ? null
      : parseApnsReason(await response.text().catch(() => null));
    return { token, success: response.ok, status: response.status, reason };
  } catch (err) {
    console.error(`[send-push] Failed to send to ${token}:`, err);
    return { token, success: false, status: 0, reason: null };
  }
}

serve(async (req) => {
  try {
    const body = await req.json();

    // Webhook payload from Supabase: { type: "INSERT", record: {...}, ... }
    const record = body.record;
    if (!isValidRecord(record)) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
      });
    }

    // Webhook verification: re-read the row and use ITS fields, not the request
    // body. A forged POST with a known notification id could otherwise push to an
    // arbitrary user about an arbitrary actor/type.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: dbRecord, error: verifyError } = await supabase
      .from("notifications")
      .select("id, user_id, type, actor_id, ref_id")
      .eq("id", record.id)
      .maybeSingle();
    if (verifyError || !dbRecord) {
      console.warn(`[send-push] Record ${record.id} not found in notifications table — rejecting`);
      return new Response(JSON.stringify({ error: "Record not found" }), { status: 400 });
    }
    const { user_id, type, actor_id, ref_id } = dbRecord;

    // Don't send push for self-notifications
    if (user_id === actor_id) {
      return new Response(JSON.stringify({ skipped: "self-notification" }), {
        status: 200,
      });
    }

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
        actorName = resolveActorName(actor);
      }
    }

    // Build message
    const message = buildMessage(type, actorName, ref_id);
    if (!message) {
      return new Response(JSON.stringify({ skipped: "unknown type" }), {
        status: 200,
      });
    }

    // The recipient's REAL unread count drives the app-icon badge. Counted after
    // the insert, so it includes the notification being pushed. A failed count
    // leaves `badge` out of the payload rather than guessing.
    const { count: unreadCount } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user_id)
      .eq("is_read", false);

    const payload = buildAlertPayload(message, {
      badge: unreadCount,
      route: buildRoute(type, ref_id, actor_id),
      userId: user_id,
      notifId: dbRecord.id,
      type,
    });

    // Create APNs JWT
    const jwt = await createAPNsJWT();

    // Send to all devices
    const results = await Promise.all(
      tokens.map((t: { token: string }) => sendPush(t.token, payload, jwt))
    );

    // Prune tokens APNs will never accept again — 410 Unregistered plus the
    // 400s (BadDeviceToken / DeviceTokenNotForTopic) that used to accumulate
    // untouched. Scoped to this recipient: the same physical device may be
    // legitimately registered to nobody else, but deleting by token alone would
    // reach across accounts on a shared-token row we haven't purged yet.
    const dead = results.filter((r) => isDeadToken(r.status, r.reason));
    if (dead.length > 0) {
      await supabase
        .from("device_tokens")
        .delete()
        .eq("user_id", user_id)
        .in("token", dead.map((r) => r.token));
      console.log(
        `[send-push] Pruned ${dead.length} dead tokens (${dead.map((r) => r.reason ?? r.status).join(", ")})`
      );
    }

    return new Response(
      JSON.stringify({
        sent: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        cleaned: dead.length,
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
