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

async function hmacSign(uid: string, cat: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(`${uid}:${cat}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript\s*:/gi, "blocked:")
    .replace(/vbscript\s*:/gi, "blocked:");
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
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
    const { subject, html, test_email, segment = "all", campaign_id, cohort, dry_run } = body;

    if (!subject || !html) {
      return jsonResponse({ error: "subject and html are required" }, 400);
    }

    const COHORTS: Record<string, { gte?: string; lt?: string }> = {
      pre_april: { lt: "2026-04-01T00:00:00Z" },
      april: { gte: "2026-04-01T00:00:00Z", lt: "2026-05-01T00:00:00Z" },
      may: { gte: "2026-05-01T00:00:00Z", lt: "2026-06-01T00:00:00Z" },
    };
    if (cohort && !COHORTS[cohort]) {
      return jsonResponse({ error: `Unknown cohort: ${cohort}` }, 400);
    }
    if (cohort && !campaign_id) {
      return jsonResponse({ error: "campaign_id is required when cohort is set" }, 400);
    }

    // Limit HTML body size to 500KB to prevent abuse
    if (html.length > 512000) {
      return jsonResponse({ error: "Email body too large (max 500KB)" }, 400);
    }

    const safeHtml = sanitizeHtml(html);

    // Use service role client for admin operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Test mode: send to a single email
    if (test_email) {
      const result = await sendEmail(test_email, subject, safeHtml);
      return jsonResponse({ sent: 1, test: true, result });
    }

    // Production mode: send to all users
    // Fetch all users who haven't opted out of marketing emails
    let profilesQuery = supabase
      .from("profiles")
      .select("id, email_prefs, created_at")
      .eq("is_suspended", false);

    // Cohort: filter by signup window
    if (cohort) {
      const window = COHORTS[cohort];
      if (window.gte) profilesQuery = profilesQuery.gte("created_at", window.gte);
      if (window.lt) profilesQuery = profilesQuery.lt("created_at", window.lt);
    }

    const { data: profiles, error: profilesError } = await profilesQuery;

    if (profilesError) {
      return jsonResponse({ error: "Failed to fetch profiles", details: profilesError }, 500);
    }

    // Filter out users who have disabled "Updates & new features" emails
    let eligibleProfiles = (profiles || []).filter(p => {
      const prefs = p.email_prefs || {};
      return prefs.updates !== false; // default is opted-in
    });

    // Cohort blast: exclude internal accounts
    if (cohort) {
      const { data: internalRows } = await supabase.from("internal_accounts").select("user_id");
      const internalSet = new Set((internalRows || []).map(r => r.user_id));
      eligibleProfiles = eligibleProfiles.filter(p => !internalSet.has(p.id));
    }

    // Cohort blast: exclude users already sent this campaign
    if (cohort && campaign_id) {
      const { data: sentRows } = await supabase
        .from("email_campaign_sends")
        .select("user_id")
        .eq("campaign_id", campaign_id);
      const sentSet = new Set((sentRows || []).map(r => r.user_id));
      eligibleProfiles = eligibleProfiles.filter(p => !sentSet.has(p.id));
    }

    // Segment filter: "never_measured" excludes users with any timegrapher_results row
    if (segment === "never_measured") {
      const { data: measuredRows, error: measuredErr } = await supabase
        .from("timegrapher_results")
        .select("user_id");
      if (measuredErr) {
        return jsonResponse({ error: "Failed to fetch measurement users", details: measuredErr }, 500);
      }
      const measuredSet = new Set((measuredRows || []).map(r => r.user_id).filter(Boolean));
      eligibleProfiles = eligibleProfiles.filter(p => !measuredSet.has(p.id));
    }

    // Resolve emails + user IDs from auth.users in parallel batches of 50
    // For cohort blasts, also require dormant (last_sign_in_at < NOW - 21d)
    const DORMANT_CUTOFF_MS = Date.now() - 21 * 24 * 60 * 60 * 1000;
    const recipients: { uid: string; email: string }[] = [];
    const resolveSize = 50;
    for (let i = 0; i < eligibleProfiles.length; i += resolveSize) {
      const batch = eligibleProfiles.slice(i, i + resolveSize);
      const results = await Promise.allSettled(
        batch.map(async (profile) => {
          const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
          const user = authUser?.user;
          if (!user?.email) return null;
          if (cohort) {
            const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
            if (lastSignIn >= DORMANT_CUTOFF_MS) return null; // active user, skip
          }
          return { uid: profile.id, email: user.email };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) recipients.push(r.value);
      }
    }

    // Dry run: just return the count without sending
    if (dry_run) {
      return jsonResponse({ eligible: recipients.length, cohort, campaign_id });
    }

    // Batch segments: split all recipients into 3 roughly equal groups
    let filteredRecipients = recipients;
    if (segment === "batch_1" || segment === "batch_2" || segment === "batch_3") {
      const batchSize = Math.ceil(filteredRecipients.length / 3);
      const batchNum = parseInt(segment.split("_")[1]) - 1;
      filteredRecipients = filteredRecipients.slice(batchNum * batchSize, (batchNum + 1) * batchSize);
    }

    // Send via Resend batch API (up to 100 per request)
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < filteredRecipients.length; i += batchSize) {
      const batch = filteredRecipients.slice(i, i + batchSize);
      const batchPayload = await Promise.all(batch.map(async (r) => {
        const sig = await hmacSign(r.uid, "updates", supabaseServiceKey);
        const unsubUrl = `${supabaseUrl}/functions/v1/email-unsubscribe?uid=${r.uid}&cat=updates&sig=${sig}`;
        const unsubFooter = `<div style="text-align:center;padding:16px 28px;font-size:11px;color:#999;line-height:1.5;border-top:1px solid #eee;"><a href="${unsubUrl}" style="color:#b8941f;text-decoration:underline;">Unsubscribe</a> · <a href="https://wrotate.com/open" style="color:#999;text-decoration:underline;">Manage preferences</a></div>`;
        return {
          from: FROM_EMAIL,
          to: [r.email],
          subject,
          html: safeHtml + unsubFooter,
          headers: {
            "List-Unsubscribe": `<${unsubUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      }));

      try {
        const res = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(batchPayload),
        });
        const data = await res.json();
        if (!res.ok) {
          failed += batch.length;
          errors.push(`Batch error: ${JSON.stringify(data)}`);
        } else {
          sent += batch.length;
          // Cohort blast: record sends so re-clicking won't double-send
          if (cohort && campaign_id) {
            const now = new Date().toISOString();
            const rows = batch.map(r => ({ campaign_id, user_id: r.uid, sent_at: now }));
            const { error: trackErr } = await supabase
              .from("email_campaign_sends")
              .insert(rows);
            if (trackErr) {
              errors.push(`Tracking insert error: ${trackErr.message}`);
            }
          }
        }
      } catch (err) {
        failed += batch.length;
        errors.push(`Batch exception: ${String(err)}`);
      }

      // Small delay between batches
      if (i + batchSize < filteredRecipients.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`[send-broadcast] Sent ${sent}, failed ${failed}, total eligible ${filteredRecipients.length} (segment=${segment})`);
    return jsonResponse({ sent, failed, total: filteredRecipients.length, segment, errors: errors.slice(0, 5) });

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
