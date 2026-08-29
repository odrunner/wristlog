// Supabase Edge Function: identify-watch
// Called from the client to identify watches in a photo using Claude Vision.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY  — API key from anthropic.com

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildClaudeFallbackPrompt,
  buildCollectionPrompt,
  buildEnhancePrompt,
  buildFactsPrompt,
  buildModelPrompt,
  COLD_PROMPT,
  detectMediaType,
  DETECT_PROMPT,
  extractJson,
  hasCollection as hasCollectionFn,
  normalizeDetectCount,
  normalizeMode,
  ownsFactModel,
  stripDataUriPrefix,
} from "./lib.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Verify authenticated user — or the ops secret (scripts/enrich-models.py),
  // which runs as the admin account for attribution/rate-limit purposes.
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const opsSecret = Deno.env.get("CAMPAIGN_TRIGGER_SECRET") ?? "";
  const opsProvided = req.headers.get("x-campaign-secret") ?? "";
  let user: { id: string } | null = null;
  if (opsSecret && opsProvided === opsSecret) {
    const { data: admin } = await supabase.from("profiles").select("id").eq("is_admin", true).limit(1).maybeSingle();
    if (admin?.id) user = { id: admin.id };
  }
  if (!user) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: jwtUser }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !jwtUser) {
      console.error("[identify-watch] Auth failed:", authError?.message, "tokenLen:", token.length);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    user = jwtUser;
  }

  // ── Rate limiting: 100 requests per rolling 1-hour window (atomic via RPC) ──
  // The prior read-then-update let concurrent requests slip past the cap.
  const RATE_LIMIT = 100;
  const WINDOW_MS = 60 * 60 * 1000;
  const now = new Date();
  const windowFloor = new Date(now.getTime() - WINDOW_MS);

  try {
    const { data: rlCount } = await supabase.rpc("bump_rate_limit", {
      p_user: user.id, p_fn: "identify-watch",
      p_window_floor: windowFloor.toISOString(), p_now: now.toISOString(),
    });
    if (typeof rlCount === "number" && rlCount > RATE_LIMIT) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
        {
          status: 429,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil(WINDOW_MS / 1000)),
          },
        }
      );
    }
  } catch (rlErr) {
    console.error("[identify-watch] Rate limit check error:", rlErr);
    // Fail open: allow the request if rate limit check fails
  }

  const t0 = Date.now();
  let loggedMode = "identify";
  let loggedHasCollection = false;
  const logAttempt = async (watchesDetected: number | null, errMsg: string | null) => {
    try {
      await supabase.from("identify_attempts").insert({
        user_id: user.id,
        mode: loggedMode,
        has_collection: loggedHasCollection,
        watches_detected: watchesDetected,
        duration_ms: Date.now() - t0,
        error: errMsg,
      });
    } catch (logErr) {
      console.error("[identify-watch] log insert failed:", logErr);
    }
  };

  try {
    const { image, collection, mode, watchInfo, commit, modelInfo, modelId } = await req.json();
    loggedMode = normalizeMode(mode);
    loggedHasCollection = hasCollectionFn(collection);

    // ── MODEL MODE (admin only): era-spanning write-up for a watch FAMILY, for
    // the watch-database model page. Same Gemini + Google Search pattern as
    // enhance; the caller (admin Models tab) stores the result via
    // admin_set_model_enrichment.
    if (mode === "model") {
      // Admin JWT, or the cron/ops secret (scripts/enrich-models.py) — same
      // header the pg_cron jobs use for the other functions.
      const triggerSecret = Deno.env.get("CAMPAIGN_TRIGGER_SECRET") ?? "";
      const providedSecret = req.headers.get("x-campaign-secret") ?? "";
      const bySecret = !!triggerSecret && providedSecret === triggerSecret;
      const { data: prof } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
      if (!prof?.is_admin && !bySecret) {
        await logAttempt(null, "model_forbidden");
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      // Server-side grounding + store when a modelId is given (ops script path):
      // the client path passes modelInfo from admin_model_grounding instead.
      let info = modelInfo;
      const storeId: string | null = typeof modelId === "string" && modelId ? modelId : null;
      if (storeId) {
        const { data: mrow } = await supabase.from("watch_models")
          .select("id, brand, name, canonical_key, wiki_extract").eq("id", storeId).maybeSingle();
        if (!mrow) {
          return new Response(JSON.stringify({ error: "unknown model" }), {
            status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
        const [{ data: aliases }, { data: ws }] = await Promise.all([
          supabase.from("watch_model_aliases").select("alias_key").eq("model_id", storeId),
          supabase.from("watches").select("ref, caliber, year_range, case_diameter, water_resistance").eq("model_id", storeId),
        ]);
        const top = (k: string) => {
          const c: Record<string, number> = {};
          for (const w of (ws ?? []) as any[]) { const v = (w[k] ?? "").toString().trim(); if (v) c[v] = (c[v] ?? 0) + 1; }
          return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
        };
        info = {
          brand: mrow.brand, name: mrow.name,
          aliases: (aliases ?? []).map((a: any) => a.alias_key).filter((k: string) => k !== mrow.canonical_key),
          refs: [...new Set(((ws ?? []) as any[]).map(w => (w.ref ?? "").toString().trim()).filter(Boolean))],
          grounding: { calibers: top("caliber"), years: top("year_range"), diameters: top("case_diameter"), water_resistance: top("water_resistance") },
          wiki_extract: mrow.wiki_extract,
        };
      }
      if (!info?.brand || !info?.name) {
        await logAttempt(null, "model_no_info");
        return new Response(JSON.stringify({ error: "Brand and name required" }), {
          status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      if (!GEMINI_API_KEY) {
        await logAttempt(null, "model_no_gemini_key");
        return new Response(JSON.stringify({ error: "Enrichment not available" }), {
          status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      const modelPrompt = buildModelPrompt(info);
      let lastErr = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), 60000);
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
            { method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
              body: JSON.stringify({
                contents: [{ parts: [{ text: modelPrompt }] }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
              }) });
          clearTimeout(timer);
          if (r.ok) {
            const j = await r.json();
            const cand = j.candidates?.[0];
            const finish = cand?.finishReason || "unknown";
            const text = (cand?.content?.parts ?? []).filter((p: any) => p.text).map((p: any) => p.text).join("");
            if (finish === "RECITATION" || finish === "SAFETY") { lastErr = `blocked_${finish}`; continue; }
            const parsed = extractJson(text);
            if (parsed) {
              parsed._engine = "gemini";
              if (storeId) {
                const upd: Record<string, unknown> = { enriched_at: new Date().toISOString() };
                if (typeof parsed.description === "string" && parsed.description.trim()) upd.description = parsed.description.trim();
                if (typeof parsed.history === "string" && parsed.history.trim()) upd.history = parsed.history.trim();
                if (Array.isArray(parsed.refs_by_era)) upd.refs_by_era = parsed.refs_by_era;
                if (Array.isArray(parsed.calibers_by_era)) upd.calibers_by_era = parsed.calibers_by_era;
                if (parsed.specs && typeof parsed.specs === "object") {
                  const { data: cur } = await supabase.from("watch_models").select("specs").eq("id", storeId).maybeSingle();
                  upd.specs = { ...(cur?.specs ?? {}), ...parsed.specs };
                }
                const { error: uErr } = await supabase.from("watch_models").update(upd).eq("id", storeId);
                if (uErr) console.error("[identify-watch] model store failed:", uErr.message);
                parsed._stored = !uErr;
              }
              await logAttempt(1, null);
              return new Response(JSON.stringify(parsed), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
            }
            lastErr = `parse_fail(${finish})`;
          } else {
            lastErr = `gemini_${r.status}`;
            if (r.status === 429) await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
          }
        } catch (e: any) { lastErr = `exception:${e.message}`; }
      }
      await logAttempt(null, `model_failed:${lastErr.slice(0, 200)}`);
      return new Response(JSON.stringify({ error: "model_temporary", message: "Enrichment is temporarily unavailable. Please try again in a moment." }), {
        status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── ENHANCE MODE: enrich watch data with specs, history, dimensions ──
    if (mode === "enhance" && watchInfo) {
      const { brand, model, reference } = watchInfo;
      if (!brand || !model) {
        await logAttempt(null, "enhance_no_info");
        return new Response(JSON.stringify({ error: "Brand and model required" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const enhancePrompt = buildEnhancePrompt({ brand, model, reference });

      if (!GEMINI_API_KEY) {
        await logAttempt(null, "enhance_no_gemini_key");
        return new Response(JSON.stringify({ error: "Enhancement not available" }), {
          status: 503,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const parts: any[] = [{ text: enhancePrompt }];
      if (image) {
        const b64 = image.replace(/^data:image\/[a-z]+;base64,/, "");
        const mt = image.startsWith("data:image/png") ? "image/png" : "image/jpeg";
        parts.unshift({ inline_data: { mime_type: mt, data: b64 } });
      }

      const MAX_RETRIES = 3;
      let lastGeminiError = "";
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const geminiAbort = new AbortController();
          const geminiTimer = setTimeout(() => geminiAbort.abort(), 45000);

          const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: geminiAbort.signal,
              body: JSON.stringify({
                contents: [{ parts }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
              }),
            }
          );

          clearTimeout(geminiTimer);
          if (geminiResponse.ok) {
            const geminiResult = await geminiResponse.json();
            const candidate = geminiResult.candidates?.[0];
            const finishReason = candidate?.finishReason || "unknown";
            const resParts = candidate?.content?.parts ?? [];
            const textParts = resParts.filter((p: any) => p.text).map((p: any) => p.text).join("");

            if (finishReason === "RECITATION" || finishReason === "SAFETY") {
              lastGeminiError = `blocked_${finishReason}`;
              console.error(`[identify-watch] Enhance blocked by ${finishReason} (attempt ${attempt + 1})`);
              continue;
            }

            const parsed = extractJson(textParts);
            if (parsed) {
              parsed._engine = "gemini";
              await logAttempt(1, null);
              return new Response(JSON.stringify(parsed), {
                headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
              });
            }
            lastGeminiError = `parse_fail(${finishReason}):${textParts.slice(0, 200)}`;
            console.error(`[identify-watch] Enhance parse failed (attempt ${attempt + 1}, finish=${finishReason}). Raw:`, textParts.slice(0, 500));
          } else {
            const errText = await geminiResponse.text();
            lastGeminiError = `gemini_${geminiResponse.status}:${errText.slice(0, 200)}`;
            console.error(`[identify-watch] Enhance Gemini error (attempt ${attempt + 1}):`, geminiResponse.status, errText.slice(0, 300));
            if (geminiResponse.status === 429) {
              await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
            }
          }
        } catch (enhErr: any) {
          lastGeminiError = `exception:${enhErr.message}`;
          console.error(`[identify-watch] Enhance error (attempt ${attempt + 1}):`, enhErr.message);
        }
      }

      await logAttempt(null, `enhance_failed:${lastGeminiError.slice(0, 200)}`);
      return new Response(JSON.stringify({ error: "enhance_temporary", message: "Enhancement is temporarily unavailable. Please try again in a moment." }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── FACTS MODE: one distinct trivia fact about the watch model ──
    // Ops path (scripts/gen-facts.py): `{mode:'facts', modelId}` with the cron
    // secret — grounds on the model row, dedups against its pool, and stores
    // the new fact under the model's facts_key (no wear/log involved).
    let factsStoreKey: string | null = null;
    let factsInfo = watchInfo;
    if (mode === "facts" && typeof modelId === "string" && modelId && opsSecret && opsProvided === opsSecret) {
      const { data: mrow } = await supabase.from("watch_models").select("brand, name, facts_key, ref_prefixes").eq("id", modelId).maybeSingle();
      if (mrow?.facts_key) {
        const { data: pool } = await supabase.from("watch_facts").select("fact").eq("model_key", mrow.facts_key);
        factsStoreKey = mrow.facts_key;
        factsInfo = { brand: mrow.brand, model: mrow.name, reference: "", existingFacts: (pool ?? []).map((f: any) => f.fact) };
      }
    }
    if (mode === "facts" && factsInfo) {
      const { brand, model, reference } = factsInfo;
      if (!brand || !model) {
        await logAttempt(null, "facts_no_info");
        return new Response(JSON.stringify({ error: "Brand and model required" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      if (!GEMINI_API_KEY) {
        await logAttempt(null, "facts_no_gemini_key");
        return new Response(JSON.stringify({ error: "Facts not available" }), {
          status: 503,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      // Only generate for a watch the caller actually owns. brand/model arrive
      // straight from the client, and each call is a grounded Gemini 2.5 Pro search
      // that writes into the SHARED fact pool — unvalidated, one user could mint up
      // to their whole hourly rate-limit worth of pools for watches nobody owns.
      // Fail CLOSED on a query error: a DB blip must not reopen the hole.
      const { data: ownedWatches, error: ownErr } = await supabase
        .from("watches").select("brand, name").eq("user_id", user.id);
      if (ownErr || !factsStoreKey && !ownsFactModel(ownedWatches || [], brand, model)) {
        await logAttempt(null, ownErr ? "facts_owner_check_failed" : "facts_not_owned");
        return new Response(JSON.stringify({ error: "Watch not in your collection" }), {
          status: 403,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const existingFacts: string[] = Array.isArray(factsInfo.existingFacts) ? factsInfo.existingFacts : [];
      const factsPrompt = buildFactsPrompt({ brand, model, reference }, existingFacts);
      const parts: any[] = [{ text: factsPrompt }];

      const MAX_RETRIES = 3;
      let lastErr = "";
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), 45000);
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: abort.signal,
              body: JSON.stringify({
                contents: [{ parts }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
              }),
            }
          );
          clearTimeout(timer);
          if (resp.ok) {
            const result = await resp.json();
            const candidate = result.candidates?.[0];
            const finishReason = candidate?.finishReason || "unknown";
            const textParts = (candidate?.content?.parts ?? [])
              .filter((p: any) => p.text).map((p: any) => p.text).join("");
            if (finishReason === "RECITATION" || finishReason === "SAFETY") {
              lastErr = `blocked_${finishReason}`; continue;
            }
            const parsed = extractJson(textParts);
            if (parsed && typeof parsed.fact === "string" && parsed.fact.trim()) {
              await logAttempt(1, null);
              const factText = parsed.fact.trim();
              let factId: string | null = null;
              // Persist server-side (pool + cursor + logs.fact_id) so the fact
              // survives the client disconnecting during this slow generation —
              // the fragile window that previously lost cold-model facts.
              if (factsStoreKey) {
                const { data: mx } = await supabase.from("watch_facts").select("position").eq("model_key", factsStoreKey).order("position", { ascending: false }).limit(1).maybeSingle();
                const { data: ins, error: iErr } = await supabase.from("watch_facts")
                  .insert({ model_key: factsStoreKey, position: ((mx?.position ?? -1) + 1), fact: factText }).select("id").maybeSingle();
                if (iErr) console.error("[identify-watch] facts model store failed:", iErr.message);
                else factId = ins?.id ?? null;
              }
              if (commit && commit.logId && commit.wearDate && user?.id) {
                try {
                  const { data: committed, error: cErr } = await supabase.rpc("commit_watch_fact_srv", {
                    p_user: user.id, p_brand: brand, p_name: model,
                    p_wear_date: commit.wearDate, p_fact: factText, p_log_id: commit.logId,
                  });
                  if (!cErr && committed) factId = (committed as any).fact_id ?? null;
                  else console.error("[identify-watch] facts commit_srv error:", cErr?.message);
                } catch (e: any) {
                  console.error("[identify-watch] facts commit_srv exception:", e.message);
                }
              }
              return new Response(JSON.stringify({ fact: factText, fact_id: factId, _engine: "gemini" }), {
                headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
              });
            }
            lastErr = `parse_fail(${finishReason})`;
          } else {
            const errText = await resp.text();
            lastErr = `gemini_${resp.status}:${errText.slice(0, 120)}`;
            if (resp.status === 429) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          }
        } catch (e: any) {
          lastErr = `exception:${e.message}`;
        }
      }
      await logAttempt(null, `facts_failed:${lastErr.slice(0, 200)}`);
      return new Response(JSON.stringify({ error: "facts_temporary" }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (!image) {
      await logAttempt(null, "no_image");
      return new Response(JSON.stringify({ error: "No image provided" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const base64Data = stripDataUriPrefix(image);
    const mediaType = detectMediaType(image);
    const imageContent = {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: base64Data },
    };
    const apiHeaders = {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    };

    // ── DETECT MODE: count watches and determine layout ──
    if (mode === "detect") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          messages: [{
            role: "user",
            content: [
              imageContent,
              {
                type: "text",
                text: DETECT_PROMPT,
              },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[identify-watch] Detect error:", response.status, errText);
        await logAttempt(null, `detect_http_${response.status}`);
        return new Response(
          JSON.stringify({ error: "Watch detection failed", detail: response.status }),
          { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      const result = await response.json();
      const text = result.content?.[0]?.text ?? "";
      const parsed = extractJson(text);
      if (!parsed) {
        await logAttempt(null, "detect_parse_failed");
        return new Response(
          JSON.stringify({ error: "Could not parse detection response" }),
          { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      parsed.count = normalizeDetectCount(parsed);
      await logAttempt(parsed.count, null);
      return new Response(JSON.stringify(parsed), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── IDENTIFY MODE (default): full identification ──
    // Collection matching: Claude Sonnet (fast, cheap, good enough for known watches)
    // Cold identification: Gemini 2.5 Pro with grounded search (best accuracy for ref numbers + specs)
    // Fallback: Claude Opus if Gemini key not set or Gemini fails
    const hasCollection = hasCollectionFn(collection);

    if (hasCollection) {
      // ── COLLECTION MATCHING (Claude Sonnet) ──
      const collectionPrompt = buildCollectionPrompt(collection);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          messages: [{
            role: "user",
            content: [imageContent, { type: "text", text: collectionPrompt }],
          }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[identify-watch] Claude collection match error:", response.status, errText);
        await logAttempt(null, `identify_http_${response.status}`);
        return new Response(
          JSON.stringify({ error: "AI identification failed", detail: response.status }),
          { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      const result = await response.json();
      const text = result.content?.[0]?.text ?? "";
      const parsed = extractJson(text);
      if (!parsed) {
        await logAttempt(null, "identify_parse_failed");
        return new Response(
          JSON.stringify({ error: "Could not parse AI response", raw: text }),
          { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      await logAttempt(Array.isArray(parsed.watches) ? parsed.watches.length : 0, null);
      return new Response(JSON.stringify(parsed), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── COLD IDENTIFICATION (Gemini 2.5 Pro with grounded search → Claude Opus fallback) ──
    const coldPrompt = COLD_PROMPT;

    // Try Gemini 2.5 Pro with grounded search first
    if (GEMINI_API_KEY) {
      try {
        const geminiAbort = new AbortController();
        const geminiTimer = setTimeout(() => geminiAbort.abort(), 60000);
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: geminiAbort.signal,
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inline_data: { mime_type: mediaType, data: base64Data } },
                  { text: coldPrompt },
                ],
              }],
              tools: [{ google_search: {} }],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 8192,
              },
            }),
          }
        );

        clearTimeout(geminiTimer);
        if (geminiResponse.ok) {
          const geminiResult = await geminiResponse.json();
          const parts = geminiResult.candidates?.[0]?.content?.parts ?? [];
          const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text).join("");
          const parsed = extractJson(textParts);
          if (parsed && Array.isArray(parsed.watches)) {
            parsed._engine = "gemini";
            // Mirrors watch-value's `engine=` line so the daily cost report can count
            // gemini vs claude cold identifications. Without a success log there is no
            // denominator, and three Claude fallbacks in a week look the same whether
            // they came out of 5 lookups or 500.
            console.log(`[identify-watch] user=${user.id} cold identify → ${parsed.watches.length} watch(es) engine=gemini`);
            await logAttempt(parsed.watches.length, null);
            return new Response(JSON.stringify(parsed), {
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
          }
          console.error(`[identify-watch] user=${user.id} Gemini parse failed, falling back to Claude. Raw:`, textParts.slice(0, 500));
        } else {
          const errText = await geminiResponse.text();
          console.error(`[identify-watch] user=${user.id} Gemini error:`, geminiResponse.status, errText.slice(0, 300));
        }
      } catch (geminiErr) {
        console.error(`[identify-watch] user=${user.id} Gemini exception, falling back to Claude:`, (geminiErr as Error).message);
      }
    }

    // Fallback: Claude Opus for cold identification
    const claudeFallbackPrompt = buildClaudeFallbackPrompt();

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 8192,
        messages: [{
          role: "user",
          content: [imageContent, { type: "text", text: claudeFallbackPrompt }],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[identify-watch] Claude fallback error:", response.status, errText);
      await logAttempt(null, `identify_http_${response.status}`);
      return new Response(
        JSON.stringify({ error: "AI identification failed", detail: response.status }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const text = result.content?.[0]?.text ?? "";
    const parsed = extractJson(text);
    if (!parsed) {
      await logAttempt(null, "identify_parse_failed");
      return new Response(
        JSON.stringify({ error: "Could not parse AI response", raw: text }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    parsed._engine = "claude";
    console.log(`[identify-watch] user=${user.id} cold identify → ${Array.isArray(parsed.watches) ? parsed.watches.length : 0} watch(es) engine=claude`);
    await logAttempt(Array.isArray(parsed.watches) ? parsed.watches.length : 0, null);
    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[identify-watch] Error:", err);
    await logAttempt(null, `exception:${(err as Error).message?.slice(0, 100) || "unknown"}`);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
