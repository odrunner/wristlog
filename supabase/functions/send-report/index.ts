import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildResendBody,
  extractBearerToken,
  hasRequiredFields,
} from "./lib.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = extractBearerToken(authHeader);
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) {
    return new Response("Invalid token", { status: 401 });
  }

  const { data: internal } = await sb
    .from("internal_accounts")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!internal) {
    return new Response("Forbidden", { status: 403 });
  }

  const payload = await req.json();
  if (!hasRequiredFields(payload)) {
    return new Response("Missing to, subject, or html", { status: 400 });
  }
  const { to, subject, html } = payload;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildResendBody(to, subject, html)),
  });

  const body = await res.text();
  if (!res.ok) {
    return new Response(body, { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
