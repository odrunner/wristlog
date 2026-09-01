// Supabase Edge Function: send-email
// Triggered by Database Webhook on INSERT into notifications table.
// Sends an email notification via SES to the target user.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   SES_AWS_ACCESS_KEY_ID / SES_AWS_SECRET_ACCESS_KEY / SES_REGION / SES_CONFIG_SET — see _shared/ses.ts
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Transport: ../_shared/mailer.ts (AWS SES).
import { sendEmail } from "../_shared/mailer.ts";
import { trackedConfigSet } from "../_shared/tracked.ts";
import {
  base64UrlEncode,
  buildEmailContent,
  buildHtmlEmail,
  buildUnsubUrl,
  effectivePrefs,
  isValidRecord,
  pickMentionText,
  resolveActorName,
  shouldFetchCommentBody,
  TYPE_TO_CATEGORY,
} from "./lib.ts";
const FROM_EMAIL = "WRotate <notifications@wrotate.com>";

async function hmacSign(uid: string, cat: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(`${uid}:${cat}`));
  return base64UrlEncode(new Uint8Array(sig));
}

serve(async (req) => {
  try {
    const payload = await req.json();

    // Webhook payload from Supabase: { type: "INSERT", record: {...} }
    const record = payload.record;
    if (!isValidRecord(record)) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400 });
    }

    // Webhook verification: re-read the row and use ITS fields, not the request
    // body. A forged POST with a known notification id could otherwise email an
    // arbitrary user about an arbitrary actor/type.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    // Unsubscribe links use a dedicated secret when set, else the service-role
    // key. The verifier accepts both, so rotating the service-role key does not
    // invalidate links already delivered. See audit S4.
    const unsubKey = Deno.env.get("UNSUBSCRIBE_HMAC_SECRET") || supabaseKey;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: dbRecord, error: verifyError } = await supabase
      .from("notifications")
      .select("id, user_id, type, actor_id, ref_id, created_at")
      .eq("id", record.id)
      .maybeSingle();
    if (verifyError || !dbRecord) {
      console.warn(`[send-email] Record ${record.id} not found in notifications table — rejecting`);
      return new Response(JSON.stringify({ error: "Record not found" }), { status: 400 });
    }
    const { user_id, type, actor_id } = dbRecord;

    // Don't send email for self-notifications
    if (user_id === actor_id) {
      return new Response(JSON.stringify({ skipped: "self-notification" }), { status: 200 });
    }

    // Map type to category
    const category = TYPE_TO_CATEGORY[type];
    if (!category) {
      return new Response(JSON.stringify({ skipped: "unknown type" }), { status: 200 });
    }

    // Look up recipient's email preferences
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email_prefs, display_name, username")
      .eq("id", user_id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ skipped: "no profile", error: profileError }), { status: 200 });
    }

    // Check if this category is enabled (per-key merge so a prefs object missing
    // a newer key falls back to that category's default instead of opting out)
    const prefs = effectivePrefs(profile.email_prefs);
    if (!prefs[category]) {
      return new Response(JSON.stringify({ skipped: "category disabled", category }), { status: 200 });
    }

    // Get recipient's email from auth.users (requires service role)
    const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(user_id);
    if (authError || !authUser?.user?.email) {
      return new Response(JSON.stringify({ skipped: "no email", error: authError }), { status: 200 });
    }

    const recipientEmail = authUser.user.email;

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

    // For comment/mention types, look up the actual comment text
    let commentBody: string | undefined;
    let mentionSource: string | undefined;
    if (shouldFetchCommentBody(type, dbRecord.ref_id, actor_id)) {
      const { data: commentRow } = await supabase
        .from("comments")
        .select("body, created_at")
        .eq("log_id", dbRecord.ref_id)
        .eq("user_id", actor_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // A mention can also come from the post's own caption — same ref_id, no
      // comment row — so look the log up too and let pickMentionText decide.
      let logRow = null;
      if (type === "mention") {
        const { data } = await supabase
          .from("logs")
          .select("notes, created_at")
          .eq("id", dbRecord.ref_id)
          .eq("user_id", actor_id)
          .maybeSingle();
        logRow = data;
      }

      const picked = pickMentionText(dbRecord.created_at, commentRow, logRow);
      commentBody = picked.text;
      mentionSource = picked.source;
    }

    // Build email content
    const content = buildEmailContent(type, actorName, commentBody, mentionSource);
    if (!content) {
      return new Response(JSON.stringify({ skipped: "no template for type" }), { status: 200 });
    }

    // Generate signed unsubscribe URL
    const sig = await hmacSign(user_id, category, unsubKey);
    const unsubUrl = buildUnsubUrl(supabaseUrl, user_id, category, sig);

    const html = buildHtmlEmail(content.subject, content.body, unsubUrl);

    // Send via SES
    const result = await sendEmail({
      from: FROM_EMAIL,
      to: [recipientEmail],
      subject: content.subject,
      html,
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      // Click tracking only for an iOS 2.6+ install; see _shared/tracked.ts.
      ...(await trackedConfigSet(supabase, user_id)),
    });

    if (!result.ok) {
      console.error("[send-email] send error:", result.error);
      return new Response(JSON.stringify({ error: "email send failed", details: result.error }), { status: 500 });
    }

    console.log(`[send-email] Sent to ${recipientEmail} (${type}/${category})`);
    return new Response(JSON.stringify({ sent: true, id: result.id }), { status: 200 });

  } catch (err) {
    console.error("[send-email] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
