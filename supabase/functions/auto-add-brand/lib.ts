// auto-add-brand — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

export function extractJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// Parse the requested brand name out of a feedback title. Returns the raw
// (un-sanitized) captured name, or null if the title isn't a brand request.
export function parseBrandRequest(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = title.match(/Please add "(.+)" to the WRotate brand list/i);
  return m ? m[1] : null;
}

// Trim and normalize smart quotes in a captured brand name to ASCII quotes.
export function sanitizeBrandName(raw: string): string {
  return raw.trim()
    .replace(/[‘’‚‛]/g, "'")   // smart single quotes → ASCII
    .replace(/[“”„‟]/g, '"');  // smart double quotes → ASCII
}

// True if a brand name contains only safe characters.
export function isValidBrandName(name: string): boolean {
  return /^[a-zA-Z0-9 \-\.&']+$/.test(name);
}

// Pick the canonical name to store, preferring Claude's canonical spelling.
export function pickFinalBrandName(
  canonicalName: string | null | undefined,
  requestedName: string,
): string {
  return canonicalName || requestedName;
}
