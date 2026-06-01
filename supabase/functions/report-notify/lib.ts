// report-notify — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

// HTML-escape a string for safe interpolation into the notification email.
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type ReportProfile = { username?: string | null; display_name?: string | null } | null | undefined;

// Display label for a profile: display_name, then username, then "Unknown" (raw, unescaped).
export function profileName(profile: ReportProfile): string {
  return profile?.display_name || profile?.username || "Unknown";
}

type Record = {
  reason?: string | null;
  content_type?: string | null;
  details?: string | null;
  created_at?: string | null;
};

// Email subject line for a new content report (uses the raw reported name, matching index.ts).
export function buildSubject(record: Record, reportedRawName: string): string {
  return `[WRotate Report] ${record.reason} — ${record.content_type} by ${reportedRawName}`;
}

// Build the HTML body of the report-notification email. Names are pre-escaped by
// the caller; record fields are escaped here (matching index.ts behavior).
export function buildHtmlBody(record: Record, reporterName: string, reportedName: string): string {
  return `
      <h2>New Content Report</h2>
      <table style="border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Reporter</td><td>${reporterName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Reported user</td><td>${reportedName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Content type</td><td>${esc(record.content_type || "")}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Reason</td><td>${esc(record.reason || "")}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Details</td><td>${esc(record.details || "None")}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Time</td><td>${esc(record.created_at || "")}</td></tr>
      </table>
      <p style="margin-top:16px;"><strong>Action required within 24 hours.</strong></p>
      <p>Log in to WRotate Admin to review.</p>
    `;
}

export type { Record, ReportProfile };
