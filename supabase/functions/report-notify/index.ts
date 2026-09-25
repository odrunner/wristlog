// Supabase Edge Function: report-notify
// Triggered by Database Webhook on INSERT into content_reports table.
// Sends an email to the admin when new content is reported.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   SES_AWS_ACCESS_KEY_ID / SES_AWS_SECRET_ACCESS_KEY / SES_REGION / SES_CONFIG_SET — see _shared/ses.ts
//   ADMIN_EMAIL        — Admin email address to receive report notifications
//   SUPABASE_URL       — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/mailer.ts";
import { buildHtmlBody, buildSubject, esc, profileName } from "./lib.ts";
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
    if (!record) {
      return new Response(JSON.stringify({ error: "No record in payload" }), {
        status: 400,
      });
    }

    // Webhook verification: confirm record exists in database
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = serviceKey();
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: row, error: verifyError } = await supabase
      .from("content_reports")
      .select("id, reporter_id, reported_user_id, content_type, content_id, reason, details, created_at")
      .eq("id", record.id)
      .maybeSingle();
    if (verifyError || !row) {
      console.warn(`[report-notify] Record ${record.id} not found in content_reports table — rejecting`);
      return new Response(JSON.stringify({ error: "Record not found" }), { status: 400 });
    }

    // One alert per report: a replayed id of an old report sends nothing.
    if (!isFresh(row.created_at, Date.now())) {
      return new Response(JSON.stringify({ skipped: true, reason: "not a new report" }), { status: 200 });
    }

    if (!ADMIN_EMAIL) {
      console.warn("[report-notify] Missing ADMIN_EMAIL");
      return new Response(JSON.stringify({ skipped: true, reason: "Missing config" }), { status: 200 });
    }

    // Look up reporter and reported user
    const [{ data: reporter }, { data: reported }] = await Promise.all([
      supabase.from("profiles").select("username, display_name").eq("id", row.reporter_id).single(),
      supabase.from("profiles").select("username, display_name").eq("id", row.reported_user_id).single(),
    ]);

    const reporterName = esc(profileName(reporter));
    const reportedRawName = profileName(reported);
    const reportedName = esc(reportedRawName);

    const subject = buildSubject(row, reportedRawName).replace(/[\r\n]+/g, " ");
    const htmlBody = buildHtmlBody(row, reporterName, reportedName);

    const result = await sendEmail({
      from: "WRotate Reports <reports@wrotate.com>",
      to: [ADMIN_EMAIL],
      subject,
      html: htmlBody,
    });
    if (!result.ok) {
      // Don't report success on a send failure — a silently-dropped moderation
      // alert means a report goes unseen.
      console.error("[report-notify] SES error:", result.status, result.error);
      return new Response(
        JSON.stringify({ error: "Email send failed", status: result.status, details: result.error }),
        { status: 502 },
      );
    }
    console.log("[report-notify] Email sent:", result.id);

    return new Response(JSON.stringify({ sent: true }), { status: 200 });
  } catch (err) {
    console.error("[report-notify] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
