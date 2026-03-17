// Supabase Edge Function: extract-url-meta
// Fetches a URL and extracts OpenGraph metadata (image, title, description)
// for creating official account draft posts.
// Admin-only: verifies the caller is an admin user.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Extract OG/meta tags from HTML string */
function extractMeta(html: string) {
  const get = (property: string): string => {
    // Try og: tags first, then twitter: tags, then standard meta
    for (const prefix of [`og:${property}`, `twitter:${property}`, property]) {
      const match = html.match(
        new RegExp(
          `<meta[^>]*(?:property|name)=["']${prefix}["'][^>]*content=["']([^"']*)["']` +
          `|<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${prefix}["']`,
          "i"
        )
      );
      if (match) return match[1] || match[2] || "";
    }
    return "";
  };

  // Fallback title from <title> tag
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);

  // Fallback image: first large img src
  let fallbackImage = "";
  if (!get("image")) {
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    if (imgMatch) fallbackImage = imgMatch[1];
  }

  return {
    image_url: get("image") || fallbackImage,
    title: get("title") || (titleTag ? titleTag[1].trim() : ""),
    description: get("description"),
    site_name: get("site_name"),
  };
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
    if (!url || typeof url !== "string") {
      return jsonResponse({ error: "No url provided" }, 400);
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
    if (meta.image_url && !meta.image_url.startsWith("http")) {
      const base = new URL(url);
      meta.image_url = new URL(meta.image_url, base.origin).href;
    }

    return jsonResponse(meta);
  } catch (err) {
    console.error("[extract-url-meta] Error:", err);
    return jsonResponse({ error: (err as Error).message || "Internal error" }, 500);
  }
});
