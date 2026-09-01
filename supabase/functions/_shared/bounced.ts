// Hard-bounce suppression, shared by every sender that builds a recipient list.
//
// Why this exists: a permanently-bounced address is not just undeliverable, it
// is actively expensive. SES suppresses it account-wide, and every later send
// to it produces a FRESH bounce event (bounceSubType "OnAccountSuppressionList")
// that counts against the bounce rate — the same rate that decides whether the
// account is allowed to send at all (SES suspends above 5%). So a dead address
// left in the audience keeps re-charging the reputation meter forever.
//
// This happened on 2026-07-31: two of that day's five bounces were re-sends to
// addresses SES had already suppressed.
//
// Transient bounces (full mailbox, greylisting, temporary DNS) are deliberately
// NOT suppressed — those recover, and blocking them would silently shrink the
// audience for a problem that fixes itself.

type BounceRow = { email_to: string | null; created_at?: string | null; bounce_type?: string | null };
type DeliveryRow = { email_to: string | null; created_at?: string | null };

// Anything that is not explicitly "Transient" is treated as permanent —
// including a null/unknown bounceType. Null shows up for pre-SES rows (the
// retired Resend webhook wrote a different `raw` shape), and for a bounce we
// cannot classify the safe default is to stop sending, not to keep sending. SES's own third value, "Undetermined", lands here for the same reason.
export function isPermanentBounce(bounceType: string | null | undefined): boolean {
  return (bounceType ?? "").trim().toLowerCase() !== "transient";
}

const norm = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();
const ms = (t: string | null | undefined) => {
  const n = Date.parse(t ?? "");
  return Number.isNaN(n) ? 0 : n;
};

// Collapse bounce event rows into a map of address -> newest permanent bounce.
export function latestPermanentBounces(rows: Iterable<BounceRow>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r?.email_to) continue;
    if (!isPermanentBounce(r.bounce_type)) continue;
    const key = norm(r.email_to);
    const at = ms(r.created_at);
    if (at >= (out.get(key) ?? -1)) out.set(key, at);
  }
  return out;
}

// An address that delivered AFTER its last permanent bounce has recovered —
// the mailbox exists again — so it must NOT stay suppressed. This is not a
// theoretical case: test@wrotate.com hard-bounced on 2026-07-31 while its
// Cloudflare routing rule was missing, then delivered normally on 2026-08-07
// once the rule was added. Suppressing on bounce history alone would have
// silently dropped the UAT account out of every audience from then on.
export function suppressedEmails(
  bounces: Iterable<BounceRow>,
  deliveries: Iterable<DeliveryRow>,
): Set<string> {
  const bounced = latestPermanentBounces(bounces);
  const lastDelivery = new Map<string, number>();
  for (const d of deliveries) {
    if (!d?.email_to) continue;
    const key = norm(d.email_to);
    const at = ms(d.created_at);
    if (at >= (lastDelivery.get(key) ?? -1)) lastDelivery.set(key, at);
  }
  const set = new Set<string>();
  for (const [email, bouncedAt] of bounced) {
    if ((lastDelivery.get(email) ?? -1) > bouncedAt) continue; // recovered
    set.add(email);
  }
  return set;
}

// Drop recipients whose address has permanently bounced.
export function excludeBounced<T extends { email: string }>(
  recipients: T[],
  blocked: Set<string>,
): T[] {
  if (blocked.size === 0) return recipients;
  return recipients.filter((r) => !blocked.has(norm(r.email)));
}

// deno-lint-ignore no-explicit-any
type Db = any;

// Fetch every permanently-bounced address. Classification happens in JS rather
// than as a PostgREST filter on purpose: `raw->bounce->>bounceType=not.eq.Transient`
// silently drops rows where the path is NULL (SQL three-valued logic), which is
// exactly the unclassifiable case we most want to block.
//
// Requires the service-role client — `email_events` is admin-only under RLS and
// returns zero rows to any other role WITHOUT erroring, which would look like
// "no bounces" and disable the filter silently.
export async function fetchBouncedEmails(supabase: Db): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("email_events")
    .select("email_to, created_at, bounce_type:raw->bounce->>bounceType")
    .eq("event_type", "bounced");
  if (error) throw new Error(`bounce suppression lookup failed: ${error.message}`);
  const bounces = (data ?? []) as BounceRow[];
  if (bounces.length === 0) return new Set();

  // Only look up deliveries for addresses that actually bounced — a handful of
  // rows, instead of scanning the whole (large, ever-growing) delivered history.
  const addrs = [...new Set(bounces.map((b) => b.email_to).filter(Boolean))] as string[];
  const { data: delivered, error: dErr } = await supabase
    .from("email_events")
    .select("email_to, created_at")
    .eq("event_type", "delivered")
    .in("email_to", addrs);
  if (dErr) throw new Error(`bounce recovery lookup failed: ${dErr.message}`);

  return suppressedEmails(bounces, (delivered ?? []) as DeliveryRow[]);
}
