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

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";

serve(async (req) => {
  try {
    const body = await req.json();
    const record = body.record;

    if (!record || !record.id) {
      return new Response(JSON.stringify({ error: "No record in payload" }), { status: 400 });
    }

    if (!RESEND_API_KEY || !ADMIN_EMAIL) {
      console.warn("[new-user-alert] Missing RESEND_API_KEY or ADMIN_EMAIL");
      return new Response(JSON.stringify({ skipped: true, reason: "Missing config" }), { status: 200 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

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
    let provider = "Unknown";
    if (userEmail.includes("privaterelay.appleid.com")) {
      provider = "Apple";
    } else if (userEmail.includes("gmail.com") || userEmail.includes("googlemail.com")) {
      provider = "Google (likely)";
    } else {
      provider = "Google or Email";
    }

    const displayName = record.display_name || "Not set";
    const username = record.username || "Not set";
    const createdAt = record.created_at || new Date().toISOString();

    // Count total users for context
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });

    const subject = `New WRotate user: ${displayName} (@${username})`;
    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr><td style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid #eee;">
          <img src="https://wrotate.com/icon.svg" alt="WRotate" width="40" height="40" style="display:inline-block;border-radius:9px;margin-bottom:8px;">
          <div style="font-size:18px;font-weight:700;color:#b8941f;letter-spacing:.03em;">New User Signup</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
            <tr><td style="padding:8px 0;font-weight:600;color:#888;width:110px;">Name</td><td style="padding:8px 0;">${displayName}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#888;">Username</td><td style="padding:8px 0;">@${username}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#888;">Email</td><td style="padding:8px 0;">${userEmail}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#888;">Provider</td><td style="padding:8px 0;">${provider}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#888;">Signed up</td><td style="padding:8px 0;">${createdAt}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#888;">Total users</td><td style="padding:8px 0;font-weight:600;color:#b8941f;">${count ?? "?"}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:4px 28px 28px;">
          <a href="https://wrotate.com" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">Open WRotate</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
