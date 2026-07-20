import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSesEmail } from "../_shared/ses.ts";
import {
  buildEmailFields,
  extractBearerToken,
  hasRequiredFields,
} from "./lib.ts";

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

  const fields = buildEmailFields(to, subject, html);
  const result = await sendSesEmail({
    from: fields.from,
    to: Array.isArray(fields.to) ? fields.to as string[] : [fields.to as string],
    subject: fields.subject as string,
    html: fields.html as string,
  });
  if (!result.ok) {
    return new Response(result.error, { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
