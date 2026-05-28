// Supabase Edge Function: email-unsubscribe
// One-click unsubscribe from email notifications.
// URL: /functions/v1/email-unsubscribe?uid=USER_ID&cat=CATEGORY&sig=HMAC
// Verifies HMAC signature, updates email_prefs, returns confirmation page.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CATEGORY_LABELS: Record<string, string> = {
  comments: "Comments & replies",
  mentions: "Mentions",
  friends: "Follows & friend requests",
  clubs: "Clubs",
  updates: "Updates & new features",
  all: "All emails",
};

async function hmacSign(uid: string, cat: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(`${uid}:${cat}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifyHmac(uid: string, cat: string, sig: string, key: string): Promise<boolean> {
  const expected = await hmacSign(uid, cat, key);
  return sig === expected;
}

function htmlPage(title: string, body: string): Response {
  return new Response(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — WRotate</title>
<style>
  body { margin:0; padding:40px 20px; background:#f4f4f4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .card { max-width:420px; margin:0 auto; background:#fff; border-radius:12px; padding:32px; box-shadow:0 1px 4px rgba(0,0,0,.08); text-align:center; }
  .logo { width:40px; height:40px; border-radius:9px; margin-bottom:8px; }
  .brand { font-size:18px; font-weight:700; color:#b8941f; letter-spacing:.03em; margin-bottom:20px; }
  h1 { font-size:18px; color:#1a1a1a; margin:0 0 12px; }
  p { font-size:14px; color:#555; line-height:1.55; margin:0 0 16px; }
  a.btn { display:inline-block; background:#b8941f; color:#fff; font-size:13px; font-weight:600; padding:10px 24px; border-radius:8px; text-decoration:none; }
  .muted { font-size:12px; color:#999; margin-top:20px; }
</style></head><body>
<div class="card">
  <img src="https://wrotate.com/icon.svg" alt="WRotate" class="logo">
  <div class="brand">WRotate</div>
  ${body}
</div></body></html>`, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

serve(async (req) => {
  const url = new URL(req.url);
  const uid = url.searchParams.get("uid");
  const cat = url.searchParams.get("cat");
  const sig = url.searchParams.get("sig");

  if (!uid || !cat || !sig) {
    return htmlPage("Invalid link", "<h1>Invalid unsubscribe link</h1><p>This link appears to be incomplete. Open WRotate to manage your notification preferences.</p><a href='https://wrotate.com/open' class='btn'>Open WRotate</a>");
  }

  const hmacKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const valid = await verifyHmac(uid, cat, sig, hmacKey);
  if (!valid) {
    return htmlPage("Invalid link", "<h1>Invalid unsubscribe link</h1><p>This link has expired or is invalid. Open WRotate to manage your notification preferences.</p><a href='https://wrotate.com/open' class='btn'>Open WRotate</a>");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabase = createClient(supabaseUrl, hmacKey);

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("email_prefs")
    .eq("id", uid)
    .single();

  if (profileErr || !profile) {
    return htmlPage("Error", "<h1>Something went wrong</h1><p>We couldn't find your account. Open WRotate to manage your preferences.</p><a href='https://wrotate.com/open' class='btn'>Open WRotate</a>");
  }

  const prefs = profile.email_prefs || {};

  if (cat === "all") {
    prefs.comments = false;
    prefs.mentions = false;
    prefs.friends = false;
    prefs.clubs = false;
    prefs.updates = false;
  } else {
    prefs[cat] = false;
  }

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ email_prefs: prefs })
    .eq("id", uid);

  if (updateErr) {
    console.error("[email-unsubscribe] Update error:", updateErr);
    return htmlPage("Error", "<h1>Something went wrong</h1><p>We couldn't update your preferences. Try again or open WRotate to manage them manually.</p><a href='https://wrotate.com/open' class='btn'>Open WRotate</a>");
  }

  const label = CATEGORY_LABELS[cat] || cat;
  const allLink = cat !== "all"
    ? `<p class="muted"><a href="/functions/v1/email-unsubscribe?uid=${uid}&cat=all&sig=${await hmacSign(uid, "all", hmacKey)}" style="color:#b8941f;">Unsubscribe from all emails</a></p>`
    : "";

  console.log(`[email-unsubscribe] ${uid} unsubscribed from ${cat}`);
  return htmlPage("Unsubscribed", `<h1>You've been unsubscribed</h1><p>You won't receive <strong>${label}</strong> emails from WRotate anymore.</p><p>You can re-enable them anytime in WRotate → Profile → Notifications.</p><a href="https://wrotate.com/open" class="btn">Open WRotate</a>${allLink}`);
});
