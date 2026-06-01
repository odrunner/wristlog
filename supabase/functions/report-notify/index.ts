// Supabase Edge Function: report-notify
// Triggered by Database Webhook on INSERT into content_reports table.
// Sends an email to the admin when new content is reported.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   RESEND_API_KEY     — Resend API key for sending emails
//   ADMIN_EMAIL        — Admin email address to receive report notifications
//   SUPABASE_URL       — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildHtmlBody, buildSubject, esc, profileName } from "./lib.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";

serve(async (req) => {
  try {
    const body = await req.json();

    const record = body.record;
    if (!record) {
      return new Response(JSON.stringify({ error: "No record in payload" }), {
        status: 400,
      });
    }

    // Webhook verification: confirm record exists in database
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: verifyRecord, error: verifyError } = await supabase
      .from("content_reports")
      .select("id")
      .eq("id", record.id)
      .maybeSingle();
    if (verifyError || !verifyRecord) {
      console.warn(`[report-notify] Record ${record.id} not found in content_reports table — rejecting`);
      return new Response(JSON.stringify({ error: "Record not found" }), { status: 400 });
    }

    if (!RESEND_API_KEY || !ADMIN_EMAIL) {
      console.warn("[report-notify] Missing RESEND_API_KEY or ADMIN_EMAIL");
      return new Response(JSON.stringify({ skipped: true, reason: "Missing config" }), { status: 200 });
    }

    // Look up reporter and reported user
    const [{ data: reporter }, { data: reported }] = await Promise.all([
      supabase.from("profiles").select("username, display_name").eq("id", record.reporter_id).single(),
      supabase.from("profiles").select("username, display_name").eq("id", record.reported_user_id).single(),
    ]);

    const reporterName = esc(profileName(reporter));
    const reportedRawName = profileName(reported);
    const reportedName = esc(reportedRawName);

    const subject = buildSubject(record, reportedRawName);
    const htmlBody = buildHtmlBody(record, reporterName, reportedName);

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "WRotate Reports <reports@wrotate.com>",
        to: [ADMIN_EMAIL],
        subject,
        html: htmlBody,
      }),
    });

    const emailData = await emailRes.json();
    console.log("[report-notify] Email sent:", emailData);

    return new Response(JSON.stringify({ sent: true }), { status: 200 });
  } catch (err) {
    console.error("[report-notify] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
