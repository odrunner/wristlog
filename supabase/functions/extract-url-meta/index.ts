// Supabase Edge Function: extract-url-meta
// Fetches a URL and extracts OpenGraph metadata (image, title, description)
// for creating official account draft posts.
// Admin-only: verifies the caller is an admin user.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { absolutizeImageUrl, extractMeta, validateUrl } from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Auth check
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing authorization" }, 401);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Admin-only check
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  try {
    const { url } = await req.json();

    // Validate URL scheme and block private IPs
    const validation = validateUrl(url);
    if (!validation.ok) {
      return jsonResponse({ error: validation.error }, 400);
    }

    // Fetch the page
    const pageRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WRotateBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!pageRes.ok) {
      return jsonResponse(
        { error: `Failed to fetch URL (${pageRes.status})` },
        502
      );
    }

    const html = await pageRes.text();
    const meta = extractMeta(html);

    // Make relative image URLs absolute
    meta.image_url = absolutizeImageUrl(meta.image_url, url);

    return jsonResponse(meta);
  } catch (err) {
    console.error("[extract-url-meta] Error:", err);
    return jsonResponse({ error: (err as Error).message || "Internal error" }, 500);
  }
});
