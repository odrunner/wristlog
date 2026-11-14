// Supabase Edge Function: email-unsubscribe
// One-click unsubscribe from email notifications.
// URL: /functions/v1/email-unsubscribe?uid=USER_ID&cat=CATEGORY&sig=HMAC
// Verifies HMAC signature, updates email_prefs, returns confirmation page.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import {
  applyUnsubscribe,
  errorPage,
  successPage,
  hmacSign,
  renderPage,
  unsubscribeKeys,
  verifyHmacAny,
} from "./lib.ts";
import { serviceKey } from "../_shared/keys.ts";
import { pickLang, requestLang } from "../_shared/lang.ts";
import type { Lang } from "../_shared/lang.ts";

// `byRequest` marks a page whose language came from the request's headers
// rather than a profile, so a cache must not hand it to the next reader.
function htmlPage(page: { title: string; body: string }, lang: Lang, byRequest = false): Response {
  return new Response(renderPage(page.title, page.body, lang), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...(byRequest ? { "Vary": "Accept-Language" } : {}) },
  });
}

serve(async (req) => {
  const url = new URL(req.url);
  const uid = url.searchParams.get("uid");
  const cat = url.searchParams.get("cat");
  const sig = url.searchParams.get("sig");
  // Until we know whose link this is, the page follows the request: ?lang=,
  // else the browser's Accept-Language, else English.
  const reqLang = requestLang(url.searchParams.get("lang"), req.headers.get("accept-language"));

  if (!uid || !cat || !sig) {
    return htmlPage(errorPage(reqLang, "incomplete"), reqLang, true);
  }

  // Verification keys (UNSUBSCRIBE_HMAC_SECRET; see unsubscribeKeys). keys[0]
  // is what we sign with.
  const keys = unsubscribeKeys((k) => Deno.env.get(k));
  const hmacKey = keys[0] ?? "";
  const valid = await verifyHmacAny(uid, cat, sig, keys);
  if (!valid) {
    return htmlPage(errorPage(reqLang, "expired"), reqLang, true);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  // DB access needs the service-role key specifically — not the signing key, which
  // may now be a dedicated secret with no database privileges.
  const supabase = createClient(supabaseUrl, serviceKey());

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("email_prefs, language")
    .eq("id", uid)
    .single();

  if (profileErr || !profile) {
    return htmlPage(errorPage(reqLang, "noAccount"), reqLang, true);
  }
  // From here on: the language the member chose in the app.
  const lang = pickLang(profile.language);

  const prefs = applyUnsubscribe(profile.email_prefs || {}, cat);

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ email_prefs: prefs })
    .eq("id", uid);

  if (updateErr) {
    console.error("[email-unsubscribe] Update error:", updateErr);
    return htmlPage(errorPage(lang, "noUpdate"), lang);
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

  const allHref = cat !== "all"
    ? `/functions/v1/email-unsubscribe?uid=${uid}&cat=all&sig=${await hmacSign(uid, "all", hmacKey)}`
    : null;

  console.log(`[email-unsubscribe] ${uid} unsubscribed from ${cat}`);
  return htmlPage(successPage(lang, cat, allHref), lang);
});
