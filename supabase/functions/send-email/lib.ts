// send-email — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.
import { aiNote, fill } from "../_shared/lang.ts";
import type { Lang } from "../_shared/lang.ts";
import { EMAIL_STRINGS } from "./strings.ts";

// Notification type → email category for preference lookup
// like / comment_like are intentionally excluded — no email for hearts
// NOTE: badge_earned is intentionally excluded — badges go to the bell + push only, never email.
export const TYPE_TO_CATEGORY: Record<string, string> = {
  follow: "friends",
  follow_accepted: "friends",
  comment: "comments",
  comment_also: "comments",
  mention: "mentions",
  club_invite: "clubs",
  club_join_request: "clubs",
  club_join_accepted: "clubs",
  club_promoted: "clubs",
  friend_request: "friends",
  friend_accepted: "friends",
  follow_request: "friends",
  // "message" is deliberately absent: DMs are push-only. Only a first-contact
  // request is worth an email.
  message_request: "friends",
};

// Default preferences (matches DB default)
export const DEFAULT_PREFS: Record<string, boolean> = {
  comments: true,
  mentions: true,
  clubs: false,
  friends: true,
};

// Merge a user's stored prefs over the defaults. `email_prefs || DEFAULT_PREFS`
// only fell back when prefs was entirely null — a prefs object predating a newer
// key (e.g. "mentions") left that key undefined, so the notification was silently
// skipped instead of using the category default. Per-key merge fixes that.
export function effectivePrefs(
  emailPrefs: Record<string, boolean> | null | undefined,
): Record<string, boolean> {
  return { ...DEFAULT_PREFS, ...(emailPrefs || {}) };
}

// True if a webhook record carries the fields required to process it.
export function isValidRecord(
  record: { user_id?: unknown; type?: unknown } | null | undefined,
): boolean {
  return !!record && !!record.user_id && !!record.type;
}

// HTML-escape user content for safe embedding in email
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Styled blockquote for comment text in emails
export function commentQuote(text: string): string {
  const escaped = esc(text.length > 300 ? text.slice(0, 300) + '…' : text);
  return `<div style="margin:12px 0 8px;padding:10px 14px;background:#f9f7f1;border-left:3px solid #b8941f;border-radius:4px;font-size:14px;color:#333;line-height:1.5;">${escaped}</div>`;
}

// Notification type → human-readable email subject + body
// commentBody is provided for comment/mention types when available.
// mentionSource says which surface a mention came from ("comment" | "post") —
// see pickMentionText; undefined means we couldn't find the text at all.
export function buildEmailContent(
  type: string,
  actorName: string,
  commentBody?: string,
  mentionSource?: string,
  lang: Lang = "en",
): { subject: string; body: string } | null {
  const S = EMAIL_STRINGS[lang];
  const f = (tpl: string) => fill(tpl, { a: actorName });
  const quote = commentBody ? commentQuote(commentBody) : '';
  // "…:" + the blockquote when we have the text, a plain sentence when we don't —
  // otherwise a missing/deleted body left the email ending in a dangling colon.
  const withQuote = (lead: string) => quote ? `${lead}${S.colon}${quote}` : `${lead}.`;
  switch (type) {
    case "comment":
    case "comment_also":
      return { subject: f(S[type][0]), body: withQuote(f(S[type][1])) };
    case "follow":
    case "follow_request":
    case "follow_accepted":
    case "message_request":
    case "friend_request":
    case "friend_accepted":
    case "club_invite":
    case "club_join_request":
    case "club_join_accepted":
    case "club_promoted":
      return { subject: f(S[type][0]), body: f(S[type][1]) };
    case "mention": {
      // Only claim a surface when we know it — a caption mention used to be
      // announced as "in a comment:" with nothing after the colon.
      const lead = mentionSource === "post" ? S.mention[2]
        : (mentionSource === "comment" || commentBody) ? S.mention[3]
        : S.mention[1];
      return { subject: f(S.mention[0]), body: withQuote(f(lead)) };
    }
    default:
      return null;
  }
}

// A mention notification writes ref_id = the log id whether the @name was typed
// in a comment or in the post's own caption (index.html does both), so the row
// alone can't say which. Both candidates are looked up and we take whichever the
// notification actually followed — its created_at is within a second of the row
// that triggered it. Returns {} when neither carries text.
export function pickMentionText(
  notifCreatedAt: string | null | undefined,
  comment: { body?: string | null; created_at?: string | null } | null | undefined,
  log: { notes?: string | null; created_at?: string | null } | null | undefined,
): { text?: string; source?: string } {
  const fromComment = comment?.body ? { text: comment.body, source: "comment", at: comment.created_at } : null;
  const fromPost = log?.notes ? { text: log.notes, source: "post", at: log.created_at } : null;
  if (!fromComment) return fromPost ? { text: fromPost.text, source: fromPost.source } : {};
  if (!fromPost) return { text: fromComment.text, source: fromComment.source };
  const gap = (at: string | null | undefined) => {
    const t = at ? Date.parse(at) : NaN;
    const n = notifCreatedAt ? Date.parse(notifCreatedAt) : NaN;
    return (isNaN(t) || isNaN(n)) ? Infinity : Math.abs(n - t);
  };
  // ties (including two unparseable timestamps) go to the comment
  const winner = gap(fromPost.at) < gap(fromComment.at) ? fromPost : fromComment;
  return { text: winner.text, source: winner.source };
}

// Resolve a display name for the actor, falling back to "Someone".
// HTML-escaped for safe embedding in the email.
export function resolveActorName(
  actor: { display_name?: string | null; username?: string | null } | null | undefined,
): string {
  if (!actor) return "Someone";
  return esc(actor.display_name || actor.username || "Someone");
}

// True if a notification type carries a quotable comment body that should be
// looked up (comment / comment_also / mention) and the needed refs are present.
export function shouldFetchCommentBody(
  type: string,
  refId: unknown,
  actorId: unknown,
): boolean {
  return (type === "comment" || type === "comment_also" || type === "mention") && !!refId && !!actorId;
}

// Build the signed unsubscribe URL for a recipient + category.
export function buildUnsubUrl(supabaseUrl: string, uid: string, cat: string, sig: string): string {
  return `${supabaseUrl}/functions/v1/email-unsubscribe?uid=${uid}&cat=${cat}&sig=${sig}`;
}

// Base64url-encode raw bytes (used for HMAC signatures).
export function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Build HTML email template — light theme with logo
export function buildHtmlEmail(subject: string, body: string, unsubUrl?: string, lang: Lang = "en"): string {
  const S = EMAIL_STRINGS[lang];
  const unsubLine = unsubUrl
    ? `${aiNote(lang)}${S.why}<br><a href="${unsubUrl}" style="color:#b8941f;text-decoration:underline;">${S.unsub}</a> · <a href="https://wrotate.com/open" style="color:#999;text-decoration:underline;">${S.manage}</a>`
    : `${aiNote(lang)}${S.why} ${S.whyNoLink}`;
  return `<!DOCTYPE html>
<html${lang === "en" ? "" : ` lang="${lang}"`}>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr><td style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid #eee;">
          <img src="https://wrotate.com/icon.svg" alt="WRotate" width="40" height="40" style="display:inline-block;border-radius:9px;margin-bottom:8px;">
          <div style="font-size:18px;font-weight:700;color:#b8941f;letter-spacing:.03em;">WRotate</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <div style="font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:8px;">${subject}</div>
          <div style="font-size:14px;color:#555;line-height:1.55;">${body}</div>
        </td></tr>
        <tr><td style="padding:4px 28px 28px;">
          <a href="https://wrotate.com/open" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">${S.open}</a>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eee;">
          <div style="font-size:11px;color:#999;line-height:1.5;">${unsubLine}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
