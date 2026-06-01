// Supabase Edge Function: feedback-to-github
// Triggered by Database Webhook on INSERT into feedback table.
// Creates a GitHub Issue for bug reports so Claude Code can auto-fix them.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   GITHUB_PAT         — fine-grained GitHub PAT with Issues write permission
//   GITHUB_REPO        — e.g. "odrunner/wristlog"
//   SUPABASE_URL       — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildIssuePayload, isBugReport, resolveUsername } from "./lib.ts";

const GITHUB_PAT = Deno.env.get("GITHUB_PAT") ?? "";
const GITHUB_REPO = Deno.env.get("GITHUB_REPO") ?? "odrunner/wristlog";

serve(async (req) => {
  try {
    const body = await req.json();

    // Webhook payload from Supabase: { type: "INSERT", record: {...}, ... }
    const record = body.record;
    if (!record) {
      return new Response(JSON.stringify({ error: "No record in payload" }), {
        status: 400,
      });
    }

    // Webhook verification: confirm record exists in database
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: verifyRecord, error: verifyError } = await supabase
      .from("feedback")
      .select("id")
      .eq("id", record.id)
      .maybeSingle();
    if (verifyError || !verifyRecord) {
      console.warn(`[feedback-to-github] Record ${record.id} not found in feedback table — rejecting`);
      return new Response(JSON.stringify({ error: "Record not found" }), { status: 400 });
    }

    // Only process bug reports — skip feature requests
    if (!isBugReport(record)) {
      return new Response(
        JSON.stringify({ skipped: "not a bug report", type: record.type }),
        { status: 200 }
      );
    }

    // Look up username for context (optional, non-blocking)
    let username = "anonymous";
    if (record.user_id) {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username, display_name")
          .eq("id", record.user_id)
          .single();

        username = resolveUsername(profile);
      } catch {
        // Non-critical — proceed with "anonymous"
      }
    }

    // Build GitHub Issue
    const issuePayload = buildIssuePayload(record, username, new Date().toISOString());

    // Create GitHub Issue via REST API
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_PAT}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify(issuePayload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[feedback-to-github] GitHub API error ${response.status}:`,
        errorText
      );
      return new Response(
        JSON.stringify({
          error: "GitHub API error",
          status: response.status,
          details: errorText,
        }),
        { status: 500 }
      );
    }

    const issue = await response.json();
    console.log(
      `[feedback-to-github] Created issue #${issue.number}: ${issue.html_url}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        issue_number: issue.number,
        issue_url: issue.html_url,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[feedback-to-github] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
