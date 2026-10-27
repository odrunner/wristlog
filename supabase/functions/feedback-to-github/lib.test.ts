import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  buildAdminEmail,
  buildIssueBody,
  buildIssuePayload,
  buildIssueTitle,
  isBugReport,
  resolveUsername,
} from "./lib.ts";

// ---- isBugReport ----

Deno.test("isBugReport — true only for type 'bug'", () => {
  assertEquals(isBugReport({ type: "bug" }), true);
  assertEquals(isBugReport({ type: "feature" }), false);
  assertEquals(isBugReport({ type: "" }), false);
  assertEquals(isBugReport({}), false);
  assertEquals(isBugReport(null), false);
  assertEquals(isBugReport(undefined), false);
});

// ---- resolveUsername ----

Deno.test("resolveUsername — prefers display_name", () => {
  assertEquals(resolveUsername({ display_name: "Jane Doe", username: "jane" }), "Jane Doe");
});

Deno.test("resolveUsername — falls back to username when no display_name", () => {
  assertEquals(resolveUsername({ display_name: null, username: "jane" }), "jane");
  assertEquals(resolveUsername({ username: "jane" }), "jane");
});

Deno.test("resolveUsername — anonymous when nothing set or null profile", () => {
  assertEquals(resolveUsername({}), "anonymous");
  assertEquals(resolveUsername({ display_name: "", username: "" }), "anonymous");
  assertEquals(resolveUsername(null), "anonymous");
  assertEquals(resolveUsername(undefined), "anonymous");
});

// ---- buildIssueTitle ----

Deno.test("buildIssueTitle — uses record title", () => {
  assertEquals(buildIssueTitle({ title: "App crashes on save" }), "[Bug Feedback] App crashes on save");
});

Deno.test("buildIssueTitle — default for missing/empty title", () => {
  assertEquals(buildIssueTitle({}), "[Bug Feedback] Untitled bug");
  assertEquals(buildIssueTitle({ title: "" }), "[Bug Feedback] Untitled bug");
  assertEquals(buildIssueTitle({ title: null }), "[Bug Feedback] Untitled bug");
});

// ---- buildIssueBody ----

Deno.test("buildIssueBody — full record renders all fields", () => {
  const body = buildIssueBody(
    {
      app_version: "1.2.3",
      browser: "Safari",
      created_at: "2026-05-30T10:00:00Z",
      details: "Steps to reproduce...",
    },
    "Jane",
    "2026-06-01T00:00:00Z",
  );
  assertEquals(body.includes("Jane"), false, "no reporter name in a public issue");
  assertStringIncludes(body, "**App Version:** 1.2.3");
  assertStringIncludes(body, "**Browser:** Safari");
  assertStringIncludes(body, "**Submitted:** 2026-05-30T10:00:00Z");
  assertStringIncludes(body, "Steps to reproduce...");
  assertEquals(body.includes("auto-bug"), false);
});

Deno.test("buildIssueBody — fallbacks for missing fields", () => {
  const body = buildIssueBody({}, "anonymous", "2026-06-01T00:00:00Z");
  assertStringIncludes(body, "**App Version:** unknown");
  assertStringIncludes(body, "**Browser:** unknown");
  assertStringIncludes(body, "**Submitted:** 2026-06-01T00:00:00Z"); // uses nowIso fallback
  assertStringIncludes(body, "_No details provided_");
});

Deno.test("buildIssueBody — created_at preferred over nowIso", () => {
  const body = buildIssueBody({ created_at: "2026-04-01T00:00:00Z" }, "x", "2026-06-01T00:00:00Z");
  assertStringIncludes(body, "**Submitted:** 2026-04-01T00:00:00Z");
});

// ---- buildIssuePayload ----

Deno.test("buildIssuePayload — assembles title, body, labels", () => {
  const payload = buildIssuePayload(
    { title: "Crash", details: "boom" },
    "Jane",
    "2026-06-01T00:00:00Z",
  );
  assertEquals(payload.title, "[Bug Feedback] Crash");
  // never a label that starts automation (auto-fix pipeline removed, SEC-23-1)
  assertEquals(payload.labels, ["bug"]);
  assertEquals(payload.body.includes("Jane"), false);
  assertStringIncludes(payload.body, "boom");
});

// ---- buildAdminEmail ----

Deno.test("buildAdminEmail — subject carries type and title", () => {
  const { subject } = buildAdminEmail(
    { type: "feature", title: 'Please add "Zelos" to the WRotate brand list.' },
    "Jane",
    "2026-06-01T00:00:00Z",
  );
  assertEquals(subject, 'New feedback (feature): Please add "Zelos" to the WRotate brand list.');
});

Deno.test("buildAdminEmail — subject fallbacks for missing type/title", () => {
  const { subject } = buildAdminEmail({}, "anonymous", "2026-06-01T00:00:00Z");
  assertEquals(subject, "New feedback (feedback): Untitled");
});

Deno.test("buildAdminEmail — html renders all fields incl. reporter (private mail)", () => {
  const { html } = buildAdminEmail(
    {
      type: "bug",
      title: "App crashes on save",
      details: "Steps to reproduce...",
      app_version: "1.2.3",
      browser: "Safari/17.0",
      created_at: "2026-05-30T10:00:00Z",
    },
    "Jane Doe",
    "2026-06-01T00:00:00Z",
  );
  assertStringIncludes(html, "Jane Doe"); // unlike the public GitHub issue, this mail is admin-only
  assertStringIncludes(html, "App crashes on save");
  assertStringIncludes(html, "Steps to reproduce...");
  assertStringIncludes(html, "1.2.3");
  assertStringIncludes(html, "Safari/17.0");
  assertStringIncludes(html, "2026-05-30T10:00:00Z");
  assertStringIncludes(html, "GitHub issue"); // bug rows say an issue was opened too
  assertStringIncludes(html, "https://wrotate.com/open"); // CTA must be /open, never the bare root
  assertEquals(html.includes('href="https://wrotate.com"'), false);
});

Deno.test("buildAdminEmail — non-bug html has no GitHub note; nowIso fallback", () => {
  const { html } = buildAdminEmail({ type: "feature" }, "anonymous", "2026-06-01T00:00:00Z");
  assertEquals(html.includes("GitHub issue"), false);
  assertStringIncludes(html, "2026-06-01T00:00:00Z");
  assertStringIncludes(html, "No details provided");
});

Deno.test("buildAdminEmail — escapes untrusted HTML in every user field", () => {
  const { subject, html } = buildAdminEmail(
    {
      type: "feature",
      title: '<img src=x onerror=alert(1)>',
      details: '<script>alert("xss")</script> & "quotes"',
      browser: "<b>evil</b>",
    },
    '<i>name</i>',
    "2026-06-01T00:00:00Z",
  );
  assertEquals(html.includes("<script>"), false);
  assertEquals(html.includes("<img src=x"), false);
  assertEquals(html.includes("<i>name</i>"), false);
  assertEquals(html.includes("<b>evil</b>"), false);
  assertStringIncludes(html, "&lt;script&gt;");
  // subject is a header, not HTML — newlines stripped, length capped
  assertEquals(subject.includes("\n"), false);
});

Deno.test("buildAdminEmail — long details are capped", () => {
  const { html } = buildAdminEmail(
    { details: "x".repeat(9000) },
    "anonymous",
    "2026-06-01T00:00:00Z",
  );
  assertStringIncludes(html, "…(truncated)");
  assertEquals(html.length < 9000, true);
});
