// feedback-to-github — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

export interface FeedbackRecord {
  id?: string;
  type?: string;
  title?: string | null;
  details?: string | null;
  app_version?: string | null;
  browser?: string | null;
  created_at?: string | null;
  user_id?: string | null;
}

export interface ProfileRow {
  username?: string | null;
  display_name?: string | null;
}

/** Only bug reports get turned into GitHub issues; everything else is skipped. */
export function isBugReport(record: { type?: string } | null | undefined): boolean {
  return !!record && record.type === "bug";
}

/**
 * Resolve a display username for an issue from a profile row.
 * Prefers display_name, then username, falling back to "anonymous".
 */
export function resolveUsername(profile: ProfileRow | null | undefined): string {
  if (!profile) return "anonymous";
  return profile.display_name || profile.username || "anonymous";
}

/** GitHub issue title for a feedback record. */
export function buildIssueTitle(record: FeedbackRecord): string {
  return `[Bug Feedback] ${record.title || "Untitled bug"}`;
}

/**
 * GitHub issue body for a feedback record. `nowIso` supplies the fallback
 * timestamp when the record has no created_at (kept injectable so tests are
 * deterministic; index.ts passes new Date().toISOString()).
 */
export function buildIssueBody(
  record: FeedbackRecord,
  username: string,
  nowIso: string,
): string {
  return [
    `## Bug Report from User Feedback`,
    ``,
    `**Reporter:** ${username}`,
    `**App Version:** ${record.app_version || "unknown"}`,
    `**Browser:** ${record.browser || "unknown"}`,
    `**Submitted:** ${record.created_at || nowIso}`,
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
}

/** Full GitHub issue creation payload (title + body + labels). */
export function buildIssuePayload(
  record: FeedbackRecord,
  username: string,
  nowIso: string,
): { title: string; body: string; labels: string[] } {
  return {
    title: buildIssueTitle(record),
    body: buildIssueBody(record, username, nowIso),
    labels: ["auto-bug"],
  };
}
