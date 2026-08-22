// share-comments — pure logic shared by share-wishlist and share-watches.
// Comments are left by recipients of a share link (usually no account), so the
// name is typed. The thread is PUBLIC to anyone holding the link. Everything that
// touches the DB/network lives in share-comments.ts; this file is testable
// without permissions.

export type ShareKind = "wishlist" | "collection";
export type PublicComment = { id: string; name: string; body: string; created_at: string };

export const NAME_MAX = 40;
export const BODY_MAX = 500;
export const IP_LIMIT = 10;
export const IP_WINDOW_MS = 60 * 60 * 1000;          // 10 per hour per IP
export const TOKEN_LIMIT = 60;
export const TOKEN_WINDOW_MS = 24 * 60 * 60 * 1000;  // 60 per day per link
export const EMAIL_WINDOW_MS = 30 * 60 * 1000;       // at most one email per link per 30 min

export function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// C0 control characters except \n (0x0A), plus DEL. Built from char codes so
// the source carries no literal control bytes.
const CTRL_CHARS = new RegExp(
  "[" + String.fromCharCode(0) + "-" + String.fromCharCode(8) +
  String.fromCharCode(11) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]",
  "g",
);

// Control characters (except \n) become spaces, runs of spaces collapse, runs
// of blank lines are capped at one, surrounding whitespace is trimmed. Never
// truncates — over-length is a 400, so the poster knows rather than losing
// their tail silently.
export function cleanText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(/\r\n?/g, "\n")
    .replace(CTRL_CHARS, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateComment(input: { name?: unknown; body?: unknown } | null | undefined):
  { ok: true; name: string; body: string } | { ok: false; reason: string } {
  const name = cleanText(input?.name);
  const body = cleanText(input?.body);
  if (!name) return { ok: false, reason: "Please add your name" };
  if (name.length > NAME_MAX) return { ok: false, reason: `Name is too long (${NAME_MAX} characters max)` };
  if (!body) return { ok: false, reason: "Please write a comment" };
  if (body.length > BODY_MAX) return { ok: false, reason: `Comment is too long (${BODY_MAX} characters max)` };
  return { ok: true, name, body };
}

// A hidden field humans never see. Bots that fill every input reveal themselves;
// the handler answers 200 and stores nothing, so they believe it worked.
export function isHoneypotTripped(hp: unknown): boolean {
  return typeof hp === "string" && hp.trim().length > 0;
}

export function resolveIp(headerGet: (name: string) => string | null): string {
  return headerGet("x-forwarded-for")?.split(",")[0]?.trim()
    || headerGet("cf-connecting-ip")
    || "unknown";
}

// Stable salted hash, never the raw IP (same scheme as demo-login).
const IP_HASH_SALT = "wrotate-share-comments-v1";
export async function hashIp(ip: string): Promise<string | null> {
  if (!ip || ip === "unknown") return null;
  const data = new TextEncoder().encode(`${IP_HASH_SALT}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// rate_limits rows are keyed (user_id, function_name); the handler uses the
// share OWNER as user_id (the FK needs a real user), so these keys only need to
// be unique per owner.
export function rateKeys(token: string, ipHash: string | null): { ip: string; token: string; email: string } {
  return {
    ip: `share-comment:ip:${ipHash || "unknown"}`,
    token: `share-comment:token:${token}`,
    email: `share-comment-email:${token}`,
  };
}

export function windowStartIso(nowMs: number, windowMs: number): string {
  return new Date(nowMs - windowMs).toISOString();
}

export function isRateLimited(
  row: { request_count: number; window_start: string } | null | undefined,
  windowStartIso: string,
  limit: number,
): boolean {
  return !!row && row.window_start > windowStartIso && row.request_count >= limit;
}

export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return iso.slice(0, 10);
}

// The thread + form that both share pages append under the watch grid. Styles
// are inlined here so neither page's <style> needs to know about comments.
// The inline script POSTs JSON to the page's own path (same origin, no CORS)
// and appends the returned comment; the poster's name is remembered locally.
export function commentsSectionHtml(kind: ShareKind, token: string, comments: PublicComment[], nowMs: number): string {
  const items = (comments || []).map((c) => `
      <div class="sc-item">
        <div class="sc-meta"><span class="sc-name">${esc(c.name)}</span> · <span class="sc-time">${esc(relativeTime(c.created_at, nowMs))}</span></div>
        <div class="sc-body">${esc(c.body)}</div>
      </div>`).join("");
  const n = (comments || []).length;
  return `
    <style>
      .sc-wrap { margin-top: 1.5rem; }
      .sc-title { font-size: .95rem; font-weight: 800; margin-bottom: .6rem; }
      .sc-item { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: .6rem .75rem; margin-bottom: .5rem; }
      .sc-meta { font-size: .72rem; color: var(--muted); margin-bottom: .2rem; }
      .sc-name { font-weight: 700; color: var(--text); }
      .sc-body { font-size: .88rem; white-space: pre-wrap; word-break: break-word; }
      .sc-empty { font-size: .85rem; color: var(--muted); margin-bottom: .75rem; }
      .sc-form { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: .75rem; margin-top: .75rem; }
      .sc-form label { display: block; font-size: .72rem; color: var(--muted); margin: .35rem 0 .2rem; }
      .sc-form input, .sc-form textarea { width: 100%; font: inherit; font-size: .9rem; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: .5rem .6rem; }
      .sc-form textarea { min-height: 84px; resize: vertical; }
      .sc-hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
      .sc-note { font-size: .72rem; color: var(--muted); margin-top: .4rem; }
      .sc-btn { display: inline-block; margin-top: .6rem; background: var(--gold); color: #fff; border: none; border-radius: 8px; padding: .55rem 1.2rem; font: inherit; font-size: .9rem; font-weight: 600; cursor: pointer; }
      .sc-btn[disabled] { opacity: .6; cursor: default; }
      .sc-err { font-size: .8rem; color: #c0392b; margin-top: .4rem; min-height: 1em; }
    </style>
    <section class="sc-wrap" id="sc-wrap" data-kind="${esc(kind)}" data-token="${esc(token)}">
      <div class="sc-title">Comments${n ? ` (${n})` : ""}</div>
      <div id="sc-list">${items || `<div class="sc-empty" id="sc-empty">No comments yet — be the first.</div>`}</div>
      <form class="sc-form" id="sc-form" autocomplete="off">
        <label for="sc-name">Your name</label>
        <input id="sc-name" name="name" maxlength="${NAME_MAX}" placeholder="So they know who this is from" required>
        <label for="sc-body">Comment</label>
        <textarea id="sc-body" name="body" maxlength="${BODY_MAX}" placeholder="Say something about these watches…" required></textarea>
        <div class="sc-hp" aria-hidden="true"><label for="sc-hp">Website</label><input id="sc-hp" name="hp" tabindex="-1" autocomplete="off"></div>
        <div class="sc-note">Visible to everyone who has this link.</div>
        <div class="sc-err" id="sc-err"></div>
        <button type="submit" class="sc-btn" id="sc-submit">Post comment</button>
      </form>
    </section>
    <script>
    (function () {
      var wrap = document.getElementById('sc-wrap'); if (!wrap) return;
      var form = document.getElementById('sc-form'), list = document.getElementById('sc-list');
      var nameEl = document.getElementById('sc-name'), bodyEl = document.getElementById('sc-body');
      var err = document.getElementById('sc-err'), btn = document.getElementById('sc-submit');
      try { var saved = localStorage.getItem('wr_sc_name'); if (saved && !nameEl.value) nameEl.value = saved; } catch (e) {}
      function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
      form.addEventListener('submit', function (ev) {
        ev.preventDefault(); err.textContent = ''; btn.disabled = true;
        var payload = { t: wrap.getAttribute('data-token'), name: nameEl.value, body: bodyEl.value, hp: document.getElementById('sc-hp').value };
        fetch(location.pathname + '?t=' + encodeURIComponent(payload.t), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
          .then(function (res) {
            btn.disabled = false;
            if (!res.j || !res.j.ok) { err.textContent = (res.j && res.j.error) || 'Could not post your comment. Please try again.'; return; }
            var c = res.j.comment; try { localStorage.setItem('wr_sc_name', c.name); } catch (e) {}
            var empty = document.getElementById('sc-empty'); if (empty) empty.remove();
            var div = document.createElement('div'); div.className = 'sc-item';
            div.innerHTML = '<div class="sc-meta"><span class="sc-name">' + esc(c.name) + '</span> · <span class="sc-time">just now</span></div><div class="sc-body">' + esc(c.body) + '</div>';
            list.appendChild(div); bodyEl.value = '';
          })
          .catch(function () { btn.disabled = false; err.textContent = 'Could not post your comment. Please try again.'; });
      });
    })();
    </script>`;
}

// Owner email. Shell copied from run-campaign/send-wear-reminders (branded card,
// CTA to /open, unsubscribe line) — "we" voice, nothing personal.
export function buildCommentEmail(
  kind: ShareKind,
  comment: { name: string; body: string },
  label: string | null,
  unsubUrl: string,
): { subject: string; html: string } {
  const what = kind === "collection" ? "watches" : "wishlist";
  const subject = `New comment on your shared ${what}`;
  const trimmedLabel = (label || "").trim();
  const linkLine = trimmedLabel
    ? `<p style="margin:0 0 12px;">On your link <strong>“${esc(trimmedLabel)}”</strong>:</p>`
    : `<p style="margin:0 0 12px;">On a ${what} link you shared:</p>`;
  const body = `
    <p style="margin:0 0 12px;"><strong>${esc(comment.name)}</strong> left a comment.</p>
    ${linkLine}
    <blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #b8941f;background:#faf7ee;border-radius:6px;white-space:pre-wrap;">${esc(comment.body)}</blockquote>
    <p style="margin:0;">Open WRotate and go to Shared links to read the thread or remove the comment. We email you about a link at most once every 30 minutes — the app always has everything.</p>`;
  const unsubLine = `<a href="${esc(unsubUrl)}" style="color:#b8941f;text-decoration:underline;">Unsubscribe</a> · <a href="https://wrotate.com/open" style="color:#999;text-decoration:underline;">Manage preferences</a>`;
  const html = `<!DOCTYPE html>
<html>
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
          <div style="font-size:14px;color:#555;line-height:1.6;">${body}</div>
        </td></tr>
        <tr><td style="padding:4px 28px 28px;">
          <a href="https://wrotate.com/open?utm_source=email&utm_medium=transactional&utm_campaign=share-comment" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">Open WRotate</a>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eee;">
          <div style="font-size:11px;color:#999;line-height:1.5;">${unsubLine}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html };
}
