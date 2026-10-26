// _shared/tracked-lib — pure logic for choosing the click-tracked SES config set.
//
// Two config sets exist:
//   wrotate-events          — no TrackingOptions; links untouched (default)
//   wrotate-events-tracked  — CustomRedirectDomain=click.wrotate.com + CLICK events;
//                             SES rewrites every href to the tracking host
//
// A tracked link opens the app only on builds that associate click.wrotate.com
// AND unwrap the /CL0/ wrapper AND ping the tracking URL on open — all three
// shipped in iOS 2.6. For anyone else a tracked link degrades (2.4/2.5: raw
// wrapper URL loaded in the WebView; web-only users: fine but the app CTA adds
// a redirect hop). So the tracked set is chosen PER RECIPIENT, and only when a
// device_tokens row proves a 2.6+ install.

export const TRACKED_CONFIG_SET = "wrotate-events-tracked";
export const MIN_TRACKED_APP_VERSION = "2.6";

// Numeric segment-wise version compare ("2.10" > "2.6"; parseFloat would say
// otherwise). Null/garbage never qualifies.
export function versionAtLeast(v: string | null | undefined, min: string): boolean {
  if (!v) return false;
  const a = String(v).trim().split(".").map(Number);
  const b = min.split(".").map(Number);
  if (a.some(Number.isNaN) || a.length === 0) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

// device_tokens rows → the set of user ids eligible for the tracked config set.
// A user can hold several tokens (old iPhone, reinstall); any iOS 2.6+ row counts —
// stale iOS rows can't veto, because the AASA/unwrap live in the newest install.
// An ANDROID row always vetoes (spec anti-goal): tracked links are rewritten to
// click.wrotate.com, whose .well-known carries no assetlinks.json, so on Android the
// email CTA would open the browser instead of the app. Rows without a platform are
// legacy iOS rows (the column predates Android and defaulted to 'ios').
export function trackedUidSet(
  rows: Array<{ user_id: string; app_version: string | null; platform?: string | null }> | null | undefined,
): Set<string> {
  const out = new Set<string>();
  const vetoed = new Set<string>();
  for (const r of rows ?? []) {
    if (r.platform === "android") vetoed.add(r.user_id);
    else if (versionAtLeast(r.app_version, MIN_TRACKED_APP_VERSION)) out.add(r.user_id);
  }
  for (const u of vetoed) out.delete(u);
  return out;
}
