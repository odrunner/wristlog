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

    // Only process bug reports — skip feature requests
    if (record.type !== "bug") {
      return new Response(
        JSON.stringify({ skipped: "not a bug report", type: record.type }),
        { status: 200 }
      );
    }

    // Look up username for context (optional, non-blocking)
    let username = "anonymous";
    if (record.user_id) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data: profile } = await supabase
          .from("profiles")
          .select("username, display_name")
          .eq("id", record.user_id)
          .single();

        if (profile) {
          username =
            profile.display_name || profile.username || "anonymous";
        }
      } catch {
        // Non-critical — proceed with "anonymous"
      }
    }

    // Build GitHub Issue
    const issueTitle = `[Bug Feedback] ${record.title || "Untitled bug"}`;
    const issueBody = [
      `## Bug Report from User Feedback`,
      ``,
      `**Reporter:** ${username}`,
      `**App Version:** ${record.app_version || "unknown"}`,
      `**Browser:** ${record.browser || "unknown"}`,
      `**Submitted:** ${record.created_at || new Date().toISOString()}`,
      ``,
      `---`,
      ``,
      `### Description`,
      ``,
      record.details || "_No details provided_",
      ``,
      `---`,
      ``,
      `_Auto-created from in-app feedback. The \`auto-bug\` label will trigger Claude Code to analyze and attempt a fix._`,
    ].join("\n");

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
        body: JSON.stringify({
          title: issueTitle,
          body: issueBody,
          labels: ["auto-bug"],
        }),
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
