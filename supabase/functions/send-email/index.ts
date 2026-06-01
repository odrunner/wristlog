// Supabase Edge Function: send-email
// Triggered by Database Webhook on INSERT into notifications table.
// Sends an email notification via Resend to the target user.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   RESEND_API_KEY             — API key from resend.com
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  base64UrlEncode,
  buildEmailContent,
  buildHtmlEmail,
  buildUnsubUrl,
  DEFAULT_PREFS,
  isValidRecord,
  resolveActorName,
  shouldFetchCommentBody,
  TYPE_TO_CATEGORY,
} from "./lib.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
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

    const { user_id, type, actor_id } = record;

    // Webhook verification: confirm record exists in database
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: verifyRecord, error: verifyError } = await supabase
      .from("notifications")
      .select("id")
      .eq("id", record.id)
      .maybeSingle();
    if (verifyError || !verifyRecord) {
      console.warn(`[send-email] Record ${record.id} not found in notifications table — rejecting`);
      return new Response(JSON.stringify({ error: "Record not found" }), { status: 400 });
    }

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

    // Check if this category is enabled
    const prefs = profile.email_prefs || DEFAULT_PREFS;
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
    if (shouldFetchCommentBody(type, record.ref_id, actor_id)) {
      const { data: commentRow } = await supabase
        .from("comments")
        .select("body")
        .eq("log_id", record.ref_id)
        .eq("user_id", actor_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (commentRow?.body) {
        commentBody = commentRow.body;
      }
    }

    // Build email content
    const content = buildEmailContent(type, actorName, commentBody);
    if (!content) {
      return new Response(JSON.stringify({ skipped: "no template for type" }), { status: 200 });
    }

    // Generate signed unsubscribe URL
    const sig = await hmacSign(user_id, category, supabaseKey);
    const unsubUrl = buildUnsubUrl(supabaseUrl, user_id, category, sig);

    const html = buildHtmlEmail(content.subject, content.body, unsubUrl);

    // Send via Resend API
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [recipientEmail],
        subject: content.subject,
        html,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error("[send-email] Resend error:", resendData);
      return new Response(JSON.stringify({ error: "resend failed", details: resendData }), { status: 500 });
    }

    console.log(`[send-email] Sent to ${recipientEmail} (${type}/${category})`);
    return new Response(JSON.stringify({ sent: true, id: resendData.id }), { status: 200 });

  } catch (err) {
    console.error("[send-email] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
