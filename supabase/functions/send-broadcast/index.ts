// Supabase Edge Function: send-broadcast
// Invoked by admin to send a marketing/broadcast email to all users.
// Accepts JSON body: { subject, html, test_email? }
// If test_email is provided, sends only to that address (for preview).
// Otherwise, sends to all users who have not disabled marketing emails.
//
// Required Supabase secrets:
//   RESEND_API_KEY             — API key from resend.com
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADMIN_USER_ID = "d70b1a85-4f31-4431-b3b7-db76543daaf5";
const FROM_EMAIL = "WRotate <hello@wrotate.com>";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    // Verify admin — check Authorization header for service role or user JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Create client with the caller's JWT to verify they are admin
    const token = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the caller is admin
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    console.log("[send-broadcast] Auth check:", {
      hasToken: !!token,
      tokenLen: token?.length,
      userId: user?.id,
      error: userError?.message,
      adminMatch: user?.id === ADMIN_USER_ID
    });
    if (userError || !user || user.id !== ADMIN_USER_ID) {
      return jsonResponse({ error: "Unauthorized", details: userError?.message }, 403);
    }

    const body = await req.json();
    const { subject, html, test_email } = body;

    if (!subject || !html) {
      return jsonResponse({ error: "subject and html are required" }, 400);
    }

    // Use service role client for admin operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Test mode: send to a single email
    if (test_email) {
      const result = await sendEmail(test_email, subject, html);
      return jsonResponse({ sent: 1, test: true, result });
    }

    // Production mode: send to all users
    // Fetch all users who haven't opted out of marketing emails
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, email_prefs")
      .eq("is_suspended", false);

    if (profilesError) {
      return jsonResponse({ error: "Failed to fetch profiles", details: profilesError }, 500);
    }

    // Filter out users who have disabled "Updates & new features" emails
    const eligibleProfiles = (profiles || []).filter(p => {
      const prefs = p.email_prefs || {};
      return prefs.updates !== false; // default is opted-in
    });

    // Fetch emails from auth.users for eligible profiles
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    // Process in batches of 10 to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < eligibleProfiles.length; i += batchSize) {
      const batch = eligibleProfiles.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (profile) => {
          const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(profile.id);
          if (authError || !authUser?.user?.email) {
            throw new Error(`No email for ${profile.id}`);
          }
          return sendEmail(authUser.user.email, subject, html);
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") sent++;
        else {
          failed++;
          errors.push(r.reason?.message || "Unknown error");
        }
      }

      // Small delay between batches to respect rate limits
      if (i + batchSize < eligibleProfiles.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`[send-broadcast] Sent ${sent}, failed ${failed}, total eligible ${eligibleProfiles.length}`);
    return jsonResponse({ sent, failed, total: eligibleProfiles.length, errors: errors.slice(0, 5) });

  } catch (err) {
    console.error("[send-broadcast] Error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
  return data;
}
