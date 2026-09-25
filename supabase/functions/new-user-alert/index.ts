// Supabase Edge Function: new-user-alert
// Triggered by Database Webhook on INSERT into profiles table.
// Sends an email to the admin when a new user signs up.
//
// Required Supabase secrets:
//   SES_AWS_ACCESS_KEY_ID / SES_AWS_SECRET_ACCESS_KEY / SES_REGION / SES_CONFIG_SET — see _shared/ses.ts
//   ADMIN_EMAIL                — Admin email to receive alerts
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/mailer.ts";
import { buildEmailHtml, buildSubject, esc, providerFromEmail } from "./lib.ts";
import { serviceKey } from "../_shared/keys.ts";
import { isFresh, triggerSecretOk } from "../_shared/trigger-auth.ts";

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";

serve(async (req) => {
  try {
    // Only our own DB trigger may call this (it sends the Vault secret), and
    // only the stored row is trusted — never the request body (audit SEC-23-19).
    if (!triggerSecretOk(req.headers.get("x-campaign-secret"), Deno.env.get("CAMPAIGN_TRIGGER_SECRET"))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    const body = await req.json();
    const record = body.record;

    if (!record || !record.id) {
      return new Response(JSON.stringify({ error: "No record in payload" }), { status: 400 });
    }

    // Webhook verification: confirm record exists in database
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = serviceKey();
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: row, error: verifyError } = await supabase
      .from("profiles")
      .select("id, display_name, username, created_at")
      .eq("id", record.id)
      .maybeSingle();
    if (verifyError || !row) {
      console.warn(`[new-user-alert] Record ${record.id} not found in profiles table — rejecting`);
      return new Response(JSON.stringify({ error: "Record not found" }), { status: 400 });
    }

    // One alert per signup: a replayed id of an old profile sends nothing.
    if (!isFresh(row.created_at, Date.now())) {
      return new Response(JSON.stringify({ skipped: true, reason: "not a new profile" }), { status: 200 });
    }

    if (!ADMIN_EMAIL) {
      console.warn("[new-user-alert] Missing ADMIN_EMAIL");
      return new Response(JSON.stringify({ skipped: true, reason: "Missing config" }), { status: 200 });
    }

    // Get the user's email from auth.users
    let userEmail = "Unknown";
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(row.id);
      if (authUser?.user?.email) {
        userEmail = authUser.user.email;
      }
    } catch (e) {
      console.warn("[new-user-alert] Could not fetch auth email:", e);
    }

    // Determine sign-in provider from email
    const provider = providerFromEmail(userEmail);

    const displayName = esc(row.display_name || "Not set");
    const username = esc(row.username || "Not set");
    const createdAt = esc(String(row.created_at));

    // Count total users for context
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });

    const subject = buildSubject(displayName, username);
    const htmlBody = buildEmailHtml({ displayName, username, userEmail, provider, createdAt, count });

    const result = await sendEmail({
      from: "WRotate <notifications@wrotate.com>",
      to: [ADMIN_EMAIL],
      subject,
      html: htmlBody,
    });

    if (!result.ok) {
      console.error("[new-user-alert] SES error:", result.error);
      return new Response(JSON.stringify({ error: "email send failed", details: result.error }), { status: 500 });
    }

    console.log(`[new-user-alert] Sent alert for @${username} (${userEmail})`);
    return new Response(JSON.stringify({ sent: true, id: result.id }), { status: 200 });

  } catch (err) {
    console.error("[new-user-alert] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
