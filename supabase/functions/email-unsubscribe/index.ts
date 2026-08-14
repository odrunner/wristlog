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
  unsubscribeKeys,
  verifyHmacAny,
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

  // Accept links signed with either key so setting UNSUBSCRIBE_HMAC_SECRET does not
  // invalidate anything already sitting in an inbox. keys[0] is what we sign with.
  const keys = unsubscribeKeys((k) => Deno.env.get(k));
  const hmacKey = keys[0] ?? "";
  const valid = await verifyHmacAny(uid, cat, sig, keys);
  if (!valid) {
    return htmlPage("Invalid link", "<h1>Invalid unsubscribe link</h1><p>This link has expired or is invalid. Open WRotate to manage your notification preferences.</p><a href='https://wrotate.com/open' class='btn'>Open WRotate</a>");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  // DB access needs the service-role key specifically — not the signing key, which
  // may now be a dedicated secret with no database privileges.
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

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

  // Log the unsubscribe so the admin portal can trend day-over-day (best-effort).
  try {
    await supabase.from("email_events").insert({
      event_type: "unsubscribed",
      email_to: uid,          // user id (we don't need the address here)
      subject: cat,           // category unsubscribed from
    });
  } catch (e) {
    console.error("[email-unsubscribe] event log failed:", e);
  }

  const label = categoryLabel(cat);
  const allLink = cat !== "all"
    ? `<p class="muted"><a href="/functions/v1/email-unsubscribe?uid=${uid}&cat=all&sig=${await hmacSign(uid, "all", hmacKey)}" style="color:#b8941f;">Unsubscribe from all emails</a></p>`
    : "";

  console.log(`[email-unsubscribe] ${uid} unsubscribed from ${cat}`);
  return htmlPage("Unsubscribed", `<h1>You've been unsubscribed</h1><p>You won't receive <strong>${label}</strong> emails from WRotate anymore.</p><p>You can re-enable them anytime in WRotate → Profile → Notifications.</p><a href="https://wrotate.com/open" class="btn">Open WRotate</a>${allLink}`);
});
