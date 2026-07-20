// Supabase Edge Function: ses-webhook
// Receives SES email events via an SNS HTTPS subscription and stores them in
// email_events (same rows the old resend-webhook wrote). Deploy with
// --no-verify-jwt; auth = SES_WEBHOOK_TOKEN query param + SNS signature.
//
// Required Supabase secrets:
//   SES_WEBHOOK_TOKEN   — random token; the SNS subscription URL must include ?token=<it>
//   SES_SNS_TOPIC_ARN   — only this topic's messages are accepted
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { X509Certificate } from "https://esm.sh/@peculiar/x509@1.11.0";
import {
  buildCanonicalString,
  buildEmailEventRow,
  isValidCertUrl,
  isValidSnsEnvelope,
  isValidSubscribeUrl,
  timestampWithinTolerance,
  type SnsEnvelope,
} from "./lib.ts";

const WEBHOOK_TOKEN = Deno.env.get("SES_WEBHOOK_TOKEN") ?? "";
const TOPIC_ARN = Deno.env.get("SES_SNS_TOPIC_ARN") ?? "";

// Signing certs rotate rarely; cache per isolate to avoid a fetch per event.
const certCache = new Map<string, CryptoKey>();

async function getSigningKey(certUrl: string, hash: string): Promise<CryptoKey> {
  const cacheKey = `${certUrl}|${hash}`;
  const cached = certCache.get(cacheKey);
  if (cached) return cached;
  const pem = await (await fetch(certUrl)).text();
  const cert = new X509Certificate(pem);
  const key = await cert.publicKey.export(
    { name: "RSASSA-PKCS1-v1_5", hash },
    ["verify"],
    crypto,
  );
  certCache.set(cacheKey, key);
  return key;
}

// Verify the SNS message signature (SignatureVersion 1 = SHA-1, 2 = SHA-256).
async function verifySnsSignature(msg: SnsEnvelope): Promise<boolean> {
  if (!msg.Signature || !msg.SigningCertURL) return false;
  if (msg.SignatureVersion !== "1" && msg.SignatureVersion !== "2") return false;
  if (!isValidCertUrl(msg.SigningCertURL)) return false;
  try {
    const hash = msg.SignatureVersion === "1" ? "SHA-1" : "SHA-256";
    const key = await getSigningKey(msg.SigningCertURL, hash);
    const sig = Uint8Array.from(atob(msg.Signature), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      sig as BufferSource,
      new TextEncoder().encode(buildCanonicalString(msg)) as BufferSource,
    );
  } catch (err) {
    console.error("[ses-webhook] Signature verification error:", err);
    return false;
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Layer 1: shared token in the subscription URL. Enforce only once the
    // secret is configured (same pattern as resend-webhook / run-campaign).
    if (WEBHOOK_TOKEN) {
      const token = new URL(req.url).searchParams.get("token") ?? "";
      if (token !== WEBHOOK_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
    } else {
      console.warn("[ses-webhook] SES_WEBHOOK_TOKEN not set — accepting WITHOUT token check (INSECURE). Set the secret to enable enforcement.");
    }

    const msg = JSON.parse(await req.text()) as SnsEnvelope;
    if (!isValidSnsEnvelope(msg)) {
      return new Response(JSON.stringify({ error: "Invalid SNS envelope" }), { status: 400 });
    }

    // Replay protection: reject payloads older than the tolerance window even
    // if validly signed (mirrors resend-webhook).
    if (!timestampWithinTolerance(msg.Timestamp, Date.now())) {
      return new Response(JSON.stringify({ error: "Stale or missing timestamp" }), { status: 401 });
    }

    // Layer 2: only our topic.
    if (TOPIC_ARN && msg.TopicArn !== TOPIC_ARN) {
      return new Response(JSON.stringify({ error: "Unknown topic" }), { status: 403 });
    }

    // Layer 3: SNS message signature (forged events would poison metrics).
    if (!(await verifySnsSignature(msg))) {
      console.warn("[ses-webhook] Invalid SNS signature — rejecting");
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
    }

    if (msg.Type === "SubscriptionConfirmation") {
      if (!msg.SubscribeURL || !isValidSubscribeUrl(msg.SubscribeURL)) {
        return new Response(JSON.stringify({ error: "Invalid SubscribeURL" }), { status: 400 });
      }
      const res = await fetch(msg.SubscribeURL);
      console.log(`[ses-webhook] Subscription confirmation fetched: ${res.status}`);
      return new Response(JSON.stringify({ confirmed: res.ok }), { status: 200 });
    }

    if (msg.Type !== "Notification") {
      return new Response(JSON.stringify({ ignored: msg.Type }), { status: 200 });
    }

    const sesEvent = JSON.parse(msg.Message ?? "{}");
    const row = buildEmailEventRow(sesEvent, new Date().toISOString(), msg.MessageId ?? null);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { error } = await supabase
      .from("email_events")
      .upsert(row, { onConflict: "sns_message_id", ignoreDuplicates: true });
    if (error) {
      console.error("[ses-webhook] Insert error:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    console.log(`[ses-webhook] Stored ${row.event_type} for ${row.email_to}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("[ses-webhook] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
