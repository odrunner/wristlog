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

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = "WRotate <notifications@wrotate.com>";

// Notification type → email category for preference lookup
const TYPE_TO_CATEGORY: Record<string, string> = {
  like: "social",
  comment_like: "social",
  follow: "social",
  follow_accepted: "social",
  comment: "comments",
  comment_also: "comments",
  mention: "mentions",
  club_invite: "clubs",
  club_join_request: "clubs",
  club_join_accepted: "clubs",
  club_promoted: "clubs",
  friend_request: "friends",
  friend_accepted: "friends",
  follow_request: "friends",
};

// Default preferences (matches DB default)
const DEFAULT_PREFS: Record<string, boolean> = {
  social: true,
  comments: true,
  mentions: true,
  clubs: false,
  friends: true,
};

// Notification type → human-readable email subject + body
function buildEmailContent(
  type: string,
  actorName: string
): { subject: string; body: string } | null {
  switch (type) {
    case "like":
      return { subject: `${actorName} liked your post`, body: `${actorName} liked your wear log on WRotate.` };
    case "comment":
      return { subject: `${actorName} commented on your post`, body: `${actorName} left a comment on your wear log.` };
    case "comment_also":
      return { subject: `${actorName} also commented`, body: `${actorName} also commented on a post you interacted with.` };
    case "comment_like":
      return { subject: `${actorName} liked your comment`, body: `${actorName} liked your comment on WRotate.` };
    case "follow":
      return { subject: `${actorName} started following you`, body: `${actorName} is now following you on WRotate.` };
    case "follow_request":
      return { subject: `${actorName} wants to follow you`, body: `${actorName} sent you a follow request on WRotate. Open the app to approve or decline.` };
    case "follow_accepted":
      return { subject: `${actorName} accepted your follow request`, body: `${actorName} accepted your follow request. You can now see their posts.` };
    case "friend_request":
      return { subject: `${actorName} sent a close friend request`, body: `${actorName} wants to be your close friend on WRotate. Open the app to respond.` };
    case "friend_accepted":
      return { subject: `${actorName} accepted your friend request`, body: `You and ${actorName} are now close friends on WRotate!` };
    case "club_invite":
      return { subject: `${actorName} invited you to a club`, body: `${actorName} invited you to join a club on WRotate. Open the app to accept.` };
    case "club_join_request":
      return { subject: `${actorName} wants to join your club`, body: `${actorName} requested to join your club. Open the app to approve or decline.` };
    case "club_join_accepted":
      return { subject: `${actorName} approved your club request`, body: `${actorName} approved your request to join the club. Welcome in!` };
    case "club_promoted":
      return { subject: `You were promoted in a club`, body: `${actorName} made you an owner of the club on WRotate.` };
    case "mention":
      return { subject: `${actorName} mentioned you`, body: `${actorName} mentioned you in a comment on WRotate.` };
    default:
      return null;
  }
}

// Build HTML email template — light theme with logo
function buildHtmlEmail(subject: string, body: string): string {
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
          <div style="font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:8px;">${subject}</div>
          <div style="font-size:14px;color:#555;line-height:1.55;">${body}</div>
        </td></tr>
        <tr><td style="padding:4px 28px 28px;">
          <a href="https://wrotate.com" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">Open WRotate</a>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eee;">
          <div style="font-size:11px;color:#999;line-height:1.5;">
            You're receiving this because you have email notifications enabled in WRotate.
            To change your preferences, open WRotate &rarr; Profile &rarr; Notifications.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

serve(async (req) => {
  try {
    const payload = await req.json();

    // Webhook payload from Supabase: { type: "INSERT", record: {...} }
    const record = payload.record;
    if (!record || !record.user_id || !record.type) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400 });
    }

    const { user_id, type, actor_id } = record;

    // Don't send email for self-notifications
    if (user_id === actor_id) {
      return new Response(JSON.stringify({ skipped: "self-notification" }), { status: 200 });
    }

    // Map type to category
    const category = TYPE_TO_CATEGORY[type];
    if (!category) {
      return new Response(JSON.stringify({ skipped: "unknown type" }), { status: 200 });
    }

    // Create Supabase admin client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

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
        actorName = actor.display_name || actor.username || "Someone";
      }
    }

    // Build email content
    const content = buildEmailContent(type, actorName);
    if (!content) {
      return new Response(JSON.stringify({ skipped: "no template for type" }), { status: 200 });
    }

    const html = buildHtmlEmail(content.subject, content.body);

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
