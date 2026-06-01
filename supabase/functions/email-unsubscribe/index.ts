// Supabase Edge Function: email-unsubscribe
// One-click unsubscribe from email notifications.
// URL: /functions/v1/email-unsubscribe?uid=USER_ID&cat=CATEGORY&sig=HMAC
// Verifies HMAC signature, updates email_prefs, returns confirmation page.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyUnsubscribe,
  categoryLabel,
  hmacSign,
  renderPage,
  verifyHmac,
} from "./lib.ts";

function htmlPage(title: string, body: string): Response {
  return new Response(renderPage(title, body), {
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

  const prefs = applyUnsubscribe(profile.email_prefs || {}, cat);

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ email_prefs: prefs })
    .eq("id", uid);

  if (updateErr) {
    console.error("[email-unsubscribe] Update error:", updateErr);
    return htmlPage("Error", "<h1>Something went wrong</h1><p>We couldn't update your preferences. Try again or open WRotate to manage them manually.</p><a href='https://wrotate.com/open' class='btn'>Open WRotate</a>");
  }

  const label = categoryLabel(cat);
  const allLink = cat !== "all"
    ? `<p class="muted"><a href="/functions/v1/email-unsubscribe?uid=${uid}&cat=all&sig=${await hmacSign(uid, "all", hmacKey)}" style="color:#b8941f;">Unsubscribe from all emails</a></p>`
    : "";

  console.log(`[email-unsubscribe] ${uid} unsubscribed from ${cat}`);
  return htmlPage("Unsubscribed", `<h1>You've been unsubscribed</h1><p>You won't receive <strong>${label}</strong> emails from WRotate anymore.</p><p>You can re-enable them anytime in WRotate → Profile → Notifications.</p><a href="https://wrotate.com/open" class="btn">Open WRotate</a>${allLink}`);
});
