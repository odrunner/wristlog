// share-comments — the IO half (DB, email). Pure logic is in share-comments-lib.ts.
// Both share pages call handleCommentPost for POST and loadComments for GET.
import { sendEmail } from "./mailer.ts";
import { hmacSign, unsubUrl } from "../send-wear-reminders/lib.ts";
import {
  buildCommentEmail, EMAIL_WINDOW_MS, hashIp, IP_LIMIT, IP_WINDOW_MS, isHoneypotTripped, isRateLimited,
  type PublicComment, rateKeys, resolveIp, type ShareKind, TOKEN_LIMIT, TOKEN_WINDOW_MS, validateComment, windowStartIso,
} from "./share-comments-lib.ts";

const FROM_EMAIL = "WRotate <hello@wrotate.com>";

// deno-lint-ignore no-explicit-any
export async function loadComments(db: any, kind: ShareKind, token: string): Promise<PublicComment[]> {
  try {
    const { data } = await db.from("share_comments")
      .select("id, name, body, created_at")
      .eq("kind", kind).eq("token", token).is("deleted_at", null)
      .order("created_at", { ascending: true }).limit(200);
    return (data || []) as PublicComment[];
  } catch (_e) {
    return [];
  }
}

// One rate_limits row per (owner, key). Returns true when the caller must be
// refused; otherwise bumps the counter. Failing open on a DB error is deliberate:
// a rate-limit outage must not take the comment box down.
// deno-lint-ignore no-explicit-any
async function checkAndBump(db: any, ownerId: string, key: string, limit: number, windowMs: number, nowMs: number): Promise<boolean> {
  try {
    const ws = windowStartIso(nowMs, windowMs);
    const { data: rl } = await db.from("rate_limits").select("request_count, window_start")
      .eq("user_id", ownerId).eq("function_name", key).maybeSingle();
    if (isRateLimited(rl, ws, limit)) return true;
    if (rl && rl.window_start > ws) {
      await db.from("rate_limits").update({ request_count: rl.request_count + 1 }).eq("user_id", ownerId).eq("function_name", key);
    } else {
      await db.from("rate_limits").upsert(
        { user_id: ownerId, function_name: key, window_start: new Date(nowMs).toISOString(), request_count: 1 },
        { onConflict: "user_id,function_name" },
      );
    }
    return false;
  } catch (_e) {
    return false;
  }
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export type ShareOwner = { user_id: string; label: string | null };

// deno-lint-ignore no-explicit-any
export async function handleCommentPost(req: Request, db: any, kind: ShareKind, opts: {
  supabaseUrl: string;
  corsHeaders: Record<string, string>;
  resolveShare: (token: string) => Promise<ShareOwner | null>;
}): Promise<Response> {
  const cors = opts.corsHeaders;
  let payload: { t?: string; name?: unknown; body?: unknown; hp?: unknown } = {};
  try { payload = await req.json(); } catch (_e) { return json({ ok: false, error: "Bad request" }, 400, cors); }
  const token = String(payload?.t || new URL(req.url).searchParams.get("t") || "");
  if (!token) return json({ ok: false, error: "This link is no longer available" }, 404, cors);
  const share = await opts.resolveShare(token);
  if (!share) return json({ ok: false, error: "This link is no longer available" }, 404, cors);
  // Bots that fill the hidden field get a convincing "ok" and nothing is stored.
  if (isHoneypotTripped(payload.hp)) {
    return json({ ok: true, comment: { id: "0", name: "", body: "", created_at: new Date().toISOString() } }, 200, cors);
  }
  const v = validateComment(payload);
  if (!v.ok) return json({ ok: false, error: v.reason }, 400, cors);

  const now = Date.now();
  const ipHash = await hashIp(resolveIp((n) => req.headers.get(n)));
  const keys = rateKeys(token, ipHash);
  if (await checkAndBump(db, share.user_id, keys.ip, IP_LIMIT, IP_WINDOW_MS, now)
   || await checkAndBump(db, share.user_id, keys.token, TOKEN_LIMIT, TOKEN_WINDOW_MS, now)) {
    return json({ ok: false, error: "Too many comments right now — please try again later" }, 429, cors);
  }

  const { data: inserted, error: insErr } = await db.from("share_comments")
    .insert({ kind, token, owner_id: share.user_id, name: v.name, body: v.body, ip_hash: ipHash })
    .select("id, name, body, created_at").single();
  if (insErr || !inserted) {
    console.warn("[share-comments] insert failed:", insErr?.message);
    return json({ ok: false, error: "Could not save your comment" }, 500, cors);
  }

  // Bell + push: the notifications INSERT webhook (send-push) does the rest.
  try {
    const { error } = await db.from("notifications")
      .insert({ user_id: share.user_id, type: "share_comment", actor_id: null, ref_id: inserted.id, is_read: false });
    if (error) console.warn("[share-comments] notification insert failed:", error.message);
  } catch (e) { console.warn("[share-comments] notification insert threw:", (e as Error)?.message); }

  // Email — owner pref + per-link throttle. A failure here never reaches the poster.
  try {
    const { data: prof } = await db.from("profiles").select("email_prefs").eq("id", share.user_id).maybeSingle();
    const prefs = (prof?.email_prefs || {}) as Record<string, unknown>;
    if (prefs.share_comments !== false && !(await checkAndBump(db, share.user_id, keys.email, 1, EMAIL_WINDOW_MS, now))) {
      const { data: au } = await db.auth.admin.getUserById(share.user_id);
      const to = au?.user?.email as string | undefined;
      if (to) {
        const unsubKey = Deno.env.get("UNSUBSCRIBE_HMAC_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        const sig = await hmacSign(share.user_id, "share_comments", unsubKey);
        const { subject, html } = buildCommentEmail(
          kind, { name: v.name, body: v.body }, share.label,
          unsubUrl(opts.supabaseUrl, share.user_id, sig, "share_comments"),
        );
        const r = await sendEmail({ from: FROM_EMAIL, to: [to], subject, html });
        if (!r.ok) console.warn("[share-comments] email failed:", r.error);
      }
    }
  } catch (e) { console.warn("[share-comments] email step failed:", (e as Error)?.message); }

  return json({ ok: true, comment: inserted }, 200, cors);
}
