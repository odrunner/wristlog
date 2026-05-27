// Supabase Edge Function: run-campaign
// Invoked daily (via cron or manual trigger) to send drip campaign emails.
// For each active campaign, finds users who signed up `delay_days` ago
// and haven't been sent yet. Sends via Resend batch API.
//
// Required Supabase secrets:
//   RESEND_API_KEY             — API key from resend.com
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

function buildHtmlEmail(subject: string, body: string, unsubUrl: string): string {
  const unsubLine = `You're receiving this because you recently joined WRotate.<br><a href="${unsubUrl}" style="color:#b8941f;text-decoration:underline;">Unsubscribe</a>`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr><td style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid #eee;">
          <img src="https://wrotate.com/icon.svg" alt="WRotate" width="40" height="40" style="display:inline-block;border-radius:9px;margin-bottom:8px;">
          <div style="font-size:18px;font-weight:700;color:#b8941f;letter-spacing:.03em;">WRotate</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <div style="font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:12px;">${subject}</div>
          <div style="font-size:14px;color:#555;line-height:1.6;">${body}</div>
        </td></tr>
        <tr><td style="padding:4px 28px 28px;">
          <a href="https://wrotate.com/?utm_source=email&utm_medium=campaign&utm_campaign=welcome" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">Open WRotate</a>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eee;">
          <div style="font-size:11px;color:#999;line-height:1.5;">${unsubLine}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (_req: Request) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch active campaigns
    const { data: campaigns, error: campErr } = await supabase
      .from("email_campaigns")
      .select("*")
      .eq("is_active", true);

    if (campErr) {
      console.error("[run-campaign] Failed to fetch campaigns:", campErr);
      return new Response(JSON.stringify({ error: campErr.message }), { status: 500 });
    }

    if (!campaigns?.length) {
      return new Response(JSON.stringify({ message: "No active campaigns" }), { status: 200 });
    }

    // Get internal accounts to exclude
    const { data: internalRows } = await supabase
      .from("internal_accounts")
      .select("user_id");
    const internalIds = new Set((internalRows || []).map(r => r.user_id));

    const results: Record<string, { sent: number; skipped: number; failed: number }> = {};

    for (const campaign of campaigns) {
      const { id: campaignId, subject, body_html, delay_days, name } = campaign;
      console.log(`[run-campaign] Processing "${name}" (delay=${delay_days}d)`);

      // Find users who signed up delay_days ago (48h-72h window for daily cron)
      const now = new Date();
      const windowEnd = new Date(now.getTime() - delay_days * 24 * 60 * 60 * 1000);
      const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

      const { data: eligible, error: eligErr } = await supabase
        .from("profiles")
        .select("id, display_name, email_prefs")
        .eq("is_suspended", false)
        .gte("created_at", windowStart.toISOString())
        .lt("created_at", windowEnd.toISOString());

      if (eligErr) {
        console.error(`[run-campaign] Failed to fetch eligible users:`, eligErr);
        results[name] = { sent: 0, skipped: 0, failed: 0 };
        continue;
      }

      // Filter: not internal, not unsubscribed from updates, not already sent
      let users = (eligible || []).filter(p => {
        if (internalIds.has(p.id)) return false;
        const prefs = p.email_prefs || {};
        return prefs.updates !== false;
      });

      if (!users.length) {
        console.log(`[run-campaign] "${name}": no eligible users in window`);
        results[name] = { sent: 0, skipped: 0, failed: 0 };
        continue;
      }

      // Check which users already received this campaign
      const { data: alreadySent } = await supabase
        .from("email_campaign_sends")
        .select("user_id")
        .eq("campaign_id", campaignId)
        .in("user_id", users.map(u => u.id));

      const sentSet = new Set((alreadySent || []).map(r => r.user_id));
      const skipped = users.filter(u => sentSet.has(u.id)).length;
      users = users.filter(u => !sentSet.has(u.id));

      if (!users.length) {
        console.log(`[run-campaign] "${name}": all eligible already sent`);
        results[name] = { sent: 0, skipped, failed: 0 };
        continue;
      }

      // Resolve emails from auth.users
      const recipients: { uid: string; email: string; displayName: string }[] = [];
      for (const u of users) {
        const { data: authUser } = await supabase.auth.admin.getUserById(u.id);
        if (authUser?.user?.email) {
          recipients.push({ uid: u.id, email: authUser.user.email, displayName: u.display_name || "" });
        }
      }

      // Send emails via Resend batch API
      let sent = 0;
      let failed = 0;
      const batchSize = 100;

      for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);
        const batchPayload = await Promise.all(batch.map(async (r) => {
          const sig = await hmacSign(r.uid, "updates", SUPABASE_SERVICE_ROLE_KEY);
          const unsubUrl = `${SUPABASE_URL}/functions/v1/email-unsubscribe?uid=${r.uid}&cat=updates&sig=${sig}`;
          // Replace {{name}} placeholder with display name or "there"
          const personalizedBody = body_html.replace(/\{\{name\}\}/g, r.displayName || "there");
          const html = buildHtmlEmail(subject, personalizedBody, unsubUrl);
          return {
            from: FROM_EMAIL,
            to: [r.email],
            subject,
            html,
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
          if (res.ok) {
            sent += batch.length;
          } else {
            const errData = await res.json();
            console.error(`[run-campaign] Resend batch error:`, errData);
            failed += batch.length;
          }
        } catch (err) {
          console.error(`[run-campaign] Resend exception:`, err);
          failed += batch.length;
        }

        if (i + batchSize < recipients.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Record sends
      if (sent > 0) {
        const sendRecords = recipients.slice(0, sent).map(r => ({
          campaign_id: campaignId,
          user_id: r.uid,
        }));
        await supabase.from("email_campaign_sends").insert(sendRecords);
      }

      console.log(`[run-campaign] "${name}": sent=${sent} skipped=${skipped} failed=${failed}`);
      results[name] = { sent, skipped, failed };
    }

    return new Response(JSON.stringify({ results }), { status: 200 });
  } catch (err) {
    console.error("[run-campaign] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
