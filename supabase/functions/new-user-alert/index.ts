// Supabase Edge Function: new-user-alert
// Triggered by Database Webhook on INSERT into profiles table.
// Sends an email to the admin when a new user signs up.
//
// Required Supabase secrets:
//   RESEND_API_KEY             — API key from resend.com
//   ADMIN_EMAIL                — Admin email to receive alerts
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEmailHtml, buildSubject, esc, providerFromEmail } from "./lib.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";

serve(async (req) => {
  try {
    const body = await req.json();
    const record = body.record;

    if (!record || !record.id) {
      return new Response(JSON.stringify({ error: "No record in payload" }), { status: 400 });
    }

    // Webhook verification: confirm record exists in database
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: verifyRecord, error: verifyError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", record.id)
      .maybeSingle();
    if (verifyError || !verifyRecord) {
      console.warn(`[new-user-alert] Record ${record.id} not found in profiles table — rejecting`);
      return new Response(JSON.stringify({ error: "Record not found" }), { status: 400 });
    }

    if (!RESEND_API_KEY || !ADMIN_EMAIL) {
      console.warn("[new-user-alert] Missing RESEND_API_KEY or ADMIN_EMAIL");
      return new Response(JSON.stringify({ skipped: true, reason: "Missing config" }), { status: 200 });
    }

    // Get the user's email from auth.users
    let userEmail = "Unknown";
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(record.id);
      if (authUser?.user?.email) {
        userEmail = authUser.user.email;
      }
    } catch (e) {
      console.warn("[new-user-alert] Could not fetch auth email:", e);
    }

    // Determine sign-in provider from email
    const provider = providerFromEmail(userEmail);

    const displayName = esc(record.display_name || "Not set");
    const username = esc(record.username || "Not set");
    const createdAt = record.created_at || new Date().toISOString();

    // Count total users for context
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });

    const subject = buildSubject(displayName, username);
    const htmlBody = buildEmailHtml({ displayName, username, userEmail, provider, createdAt, count });

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "WRotate <notifications@wrotate.com>",
        to: [ADMIN_EMAIL],
        subject,
        html: htmlBody,
      }),
    });

    const emailData = await emailRes.json();

    if (!emailRes.ok) {
      console.error("[new-user-alert] Resend error:", emailData);
      return new Response(JSON.stringify({ error: "resend failed", details: emailData }), { status: 500 });
    }

    console.log(`[new-user-alert] Sent alert for @${username} (${userEmail})`);
    return new Response(JSON.stringify({ sent: true, id: emailData.id }), { status: 200 });

  } catch (err) {
    console.error("[new-user-alert] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
