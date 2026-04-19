// Supabase Edge Function: auto-add-brand
// Triggered by Database Webhook on INSERT into feedback table.
// When a user requests a brand, verifies it via Claude + web search,
// then commits it to the codebase via GitHub API and notifies the user.
//
// Required Supabase secrets:
//   ANTHROPIC_API_KEY         — for Claude verification
//   GITHUB_PAT                — fine-grained PAT with Contents write
//   GITHUB_REPO               — e.g. "odrunner/wristlog"
//   SUPABASE_URL              — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GITHUB_PAT = Deno.env.get("GITHUB_PAT") ?? "";
const GITHUB_REPO = Deno.env.get("GITHUB_REPO") ?? "odrunner/wristlog";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── Helpers ──────────────────────────────────────────────────────────────────

function gh(path: string, opts: RequestInit = {}) {
  return fetch(`https://api.github.com/repos/${GITHUB_REPO}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
}

function b64ToStr(b64: string): string {
  const raw = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function strToB64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(""));
}

function extractJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json();
    const record = body.record;
    if (!record) {
      return new Response(JSON.stringify({ error: "No record in payload" }), { status: 400 });
    }

    // Only process brand addition requests
    const brandMatch = record.title?.match(/Please add "(.+)" to the WRotate brand list/i);
    if (!brandMatch) {
      return new Response(JSON.stringify({ skipped: "not a brand request" }), { status: 200 });
    }

    const requestedName = brandMatch[1].trim();
    const userId = record.user_id;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Webhook verification: confirm record exists in database ─────────────
    const { data: verifyRecord, error: verifyError } = await supabase
      .from("feedback")
      .select("id")
      .eq("id", record.id)
      .maybeSingle();
    if (verifyError || !verifyRecord) {
      console.warn(`[auto-add-brand] Record ${record.id} not found in feedback table — rejecting`);
      return new Response(JSON.stringify({ error: "Record not found" }), { status: 400 });
    }

    // ── Brand name validation: reject unsafe characters ─────────────────────
    if (!/^[a-zA-Z0-9 \-\.&']+$/.test(requestedName)) {
      console.warn(`[auto-add-brand] Invalid brand name characters: "${requestedName}"`);
      return new Response(JSON.stringify({ error: "Invalid brand name characters" }), { status: 400 });
    }

    console.log(`[auto-add-brand] Processing request for "${requestedName}" from user ${userId}`);

    // ── Step 1: Verify via Claude + web search ───────────────────────────────

    const verifyResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        messages: [{
          role: "user",
          content: `Is "${requestedName}" a real wristwatch or clock brand? Search the web to verify. Be lenient — microbrands, indie watchmakers, vintage brands, and small manufacturers all count. Respond with JSON only: {"is_brand": true, "canonical_name": "CorrectSpelling"} or {"is_brand": false, "reason": "one sentence"}`,
        }],
      }),
    });

    if (!verifyResp.ok) {
      const errText = await verifyResp.text();
      console.error("[auto-add-brand] Claude API error:", verifyResp.status, errText);
      return new Response(JSON.stringify({ error: "verification_api_failed" }), { status: 502 });
    }

    const verifyResult = await verifyResp.json();
    const textBlock = verifyResult.content?.find((b: { type: string }) => b.type === "text");
    const parsed = extractJson(textBlock?.text ?? "");

    if (!parsed) {
      console.error("[auto-add-brand] Could not parse verification:", textBlock?.text);
      return new Response(JSON.stringify({ error: "parse_failed" }), { status: 500 });
    }

    if (!parsed.is_brand) {
      console.log(`[auto-add-brand] "${requestedName}" not verified: ${parsed.reason}`);
      return new Response(JSON.stringify({ verified: false, reason: parsed.reason }), { status: 200 });
    }

    const finalName = parsed.canonical_name || requestedName;
    console.log(`[auto-add-brand] Verified "${requestedName}" → canonical: "${finalName}"`);

    // ── Step 2: Read current files from GitHub ───────────────────────────────

    // Get HEAD ref → commit → tree
    const refResp = await gh("/git/ref/heads/main");
    const refData = await refResp.json();
    const headSha = refData.object.sha;

    const commitResp = await gh(`/git/commits/${headSha}`);
    const commitData = await commitResp.json();
    const treeSha = commitData.tree.sha;

    // Get file SHAs from tree
    const treeResp = await gh(`/git/trees/${treeSha}`);
    const treeData = await treeResp.json();
    const indexEntry = treeData.tree.find((f: { path: string }) => f.path === "index.html");
    const swEntry = treeData.tree.find((f: { path: string }) => f.path === "sw.js");

    if (!indexEntry || !swEntry) {
      console.error("[auto-add-brand] Could not find index.html or sw.js in tree");
      return new Response(JSON.stringify({ error: "files_not_found" }), { status: 500 });
    }

    // Read blobs (handles files >1MB)
    const [indexBlobResp, swBlobResp] = await Promise.all([
      gh(`/git/blobs/${indexEntry.sha}`),
      gh(`/git/blobs/${swEntry.sha}`),
    ]);
    const indexBlob = await indexBlobResp.json();
    const swBlob = await swBlobResp.json();

    const indexContent = b64ToStr(indexBlob.content);
    const swContent = b64ToStr(swBlob.content);

    // ── Step 3: Check if brand already exists ────────────────────────────────

    if (indexContent.includes(`'${finalName}'`)) {
      console.log(`[auto-add-brand] "${finalName}" already in brand list`);
      if (userId) {
        await supabase.from("notifications").insert({
          user_id: userId, type: "system", ref_id: finalName, is_read: false,
        });
      }
      return new Response(JSON.stringify({ already_exists: true, brand: finalName }), { status: 200 });
    }

    // ── Step 4: Insert brand alphabetically into DEFAULT_BRANDS ──────────────

    const arrayMatch = indexContent.match(/const DEFAULT_BRANDS = \[([\s\S]*?)\];/);
    if (!arrayMatch) {
      console.error("[auto-add-brand] Could not find DEFAULT_BRANDS array");
      return new Response(JSON.stringify({ error: "array_not_found" }), { status: 500 });
    }

    const arrayContent = arrayMatch[1];
    const existingBrands = [...arrayContent.matchAll(/'([^']+)'/g)].map((m) => m[1]);

    // Find the brand that should come right before the new one
    const sorted = [...existingBrands, finalName].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    const newIdx = sorted.indexOf(finalName);
    const prevBrand = newIdx > 0 ? sorted[newIdx - 1] : null;

    let newArrayContent: string;
    if (prevBrand) {
      // Insert after the previous brand — handle both mid-line and end-of-line positions
      const prevEscaped = prevBrand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`'${prevEscaped}'(,?)`);
      newArrayContent = arrayContent.replace(regex, `'${prevBrand}'$1 '${finalName}',`);
    } else {
      // New brand is first alphabetically — insert at start of array
      newArrayContent = arrayContent.replace(/^\s*'/, `  '${finalName}',\n  '`);
    }

    const newIndexContent = indexContent.replace(arrayContent, newArrayContent);

    // ── Step 5: Bump SW cache version ────────────────────────────────────────

    const versionMatch = swContent.match(/wristlog-v(\d+)/);
    const newVersion = versionMatch ? parseInt(versionMatch[1]) + 1 : 999;
    const newSwContent = swContent.replace(/wristlog-v\d+/, `wristlog-v${newVersion}`);

    // ── Step 6: Commit both files via Git Data API ───────────────────────────

    // Create new blobs
    const [newIndexBlobResp, newSwBlobResp] = await Promise.all([
      gh("/git/blobs", {
        method: "POST",
        body: JSON.stringify({ content: strToB64(newIndexContent), encoding: "base64" }),
      }),
      gh("/git/blobs", {
        method: "POST",
        body: JSON.stringify({ content: strToB64(newSwContent), encoding: "base64" }),
      }),
    ]);

    if (!newIndexBlobResp.ok || !newSwBlobResp.ok) {
      const e1 = !newIndexBlobResp.ok ? await newIndexBlobResp.text() : "ok";
      const e2 = !newSwBlobResp.ok ? await newSwBlobResp.text() : "ok";
      console.error("[auto-add-brand] Blob creation failed:", e1, e2);
      return new Response(JSON.stringify({ error: "blob_failed", index: e1, sw: e2 }), { status: 500 });
    }

    const newIndexBlobSha = (await newIndexBlobResp.json()).sha;
    const newSwBlobSha = (await newSwBlobResp.json()).sha;

    // Create new tree with updated files
    const newTreeResp = await gh("/git/trees", {
      method: "POST",
      body: JSON.stringify({
        base_tree: treeSha,
        tree: [
          { path: "index.html", mode: "100644", type: "blob", sha: newIndexBlobSha },
          { path: "sw.js", mode: "100644", type: "blob", sha: newSwBlobSha },
        ],
      }),
    });
    if (!newTreeResp.ok) {
      const e = await newTreeResp.text();
      console.error("[auto-add-brand] Tree creation failed:", e);
      return new Response(JSON.stringify({ error: "tree_failed", details: e }), { status: 500 });
    }
    const newTreeSha = (await newTreeResp.json()).sha;

    // Create commit
    const newCommitResp = await gh("/git/commits", {
      method: "POST",
      body: JSON.stringify({
        message: `Brand list: add ${finalName}`,
        tree: newTreeSha,
        parents: [headSha],
      }),
    });
    if (!newCommitResp.ok) {
      const e = await newCommitResp.text();
      console.error("[auto-add-brand] Commit creation failed:", e);
      return new Response(JSON.stringify({ error: "commit_create_failed", details: e }), { status: 500 });
    }
    const newCommitSha = (await newCommitResp.json()).sha;

    // Update main ref
    const updateResp = await gh("/git/refs/heads/main", {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommitSha }),
    });

    if (!updateResp.ok) {
      const errText = await updateResp.text();
      console.error("[auto-add-brand] Failed to update ref:", updateResp.status, errText);
      return new Response(JSON.stringify({ error: "ref_update_failed", details: errText }), { status: 500 });
    }

    console.log(`[auto-add-brand] Committed "${finalName}" as ${newCommitSha.slice(0, 7)}, SW v${newVersion}`);

    // ── Step 7: Notify the user ──────────────────────────────────────────────

    if (userId) {
      await supabase.from("notifications").insert({
        user_id: userId, type: "system", ref_id: finalName, is_read: false,
      });
      console.log(`[auto-add-brand] Notified user ${userId}`);
    }

    return new Response(
      JSON.stringify({ added: finalName, commit: newCommitSha, sw_version: newVersion }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[auto-add-brand] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
