import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
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
  assertStringIncludes(body, "**Reporter:** Jane");
  assertStringIncludes(body, "**App Version:** 1.2.3");
  assertStringIncludes(body, "**Browser:** Safari");
  assertStringIncludes(body, "**Submitted:** 2026-05-30T10:00:00Z");
  assertStringIncludes(body, "Steps to reproduce...");
  assertStringIncludes(body, "auto-bug");
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
  assertEquals(payload.labels, ["auto-bug"]);
  assertStringIncludes(payload.body, "**Reporter:** Jane");
  assertStringIncludes(payload.body, "boom");
});
