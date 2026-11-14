import { aiNote, fill, LOCALES, num, SHELL_STRINGS } from "./lang.ts";
import type { Lang } from "./lang.ts";
import { SHARE_COMMENT_STRINGS } from "./share-comment-strings.ts";
import { SHARE_STRINGS } from "./share-strings.ts";
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

// `lang` is the commenter's (the page they posted from), for the reason shown
// back to them under the form.
export function validateComment(input: { name?: unknown; body?: unknown } | null | undefined, lang: Lang = "en"):
  { ok: true; name: string; body: string } | { ok: false; reason: string } {
  const S = SHARE_STRINGS[lang].comments;
  const name = cleanText(input?.name);
  const body = cleanText(input?.body);
  if (!name) return { ok: false, reason: S.needName };
  if (name.length > NAME_MAX) return { ok: false, reason: fill(S.nameLong, { n: String(NAME_MAX) }) };
  if (!body) return { ok: false, reason: S.needBody };
  if (body.length > BODY_MAX) return { ok: false, reason: fill(S.bodyLong, { n: String(BODY_MAX) }) };
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

export function relativeTime(iso: string, nowMs: number, lang: Lang = "en"): string {
  const S = SHARE_STRINGS[lang].comments;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 60) return S.now;
  const m = Math.floor(s / 60);
  if (m < 60) return fill(S.min, { n: num(lang, m) });
  const h = Math.floor(m / 60);
  if (h < 24) return fill(S.hour, { n: num(lang, h) });
  const d = Math.floor(h / 24);
  if (d < 30) return fill(S.day, { n: num(lang, d) });
  // English keeps the bare ISO day it always showed; the others get the same
  // UTC day written their own way.
  if (lang === "en") return iso.slice(0, 10);
  return new Date(t).toLocaleDateString(LOCALES[lang], { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

// One of our strings as a single-quoted JS literal inside the page's inline
// <script>. French and Italian text carries apostrophes ("à l'instant").
export function jsStr(s: string): string {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/<\//g, "<\\/").replace(/\r?\n/g, "\\n") + "'";
}

// The thread + form that both share pages append under the watch grid. Styles
// are inlined here so neither page's <style> needs to know about comments.
// The inline script POSTs JSON to the page's own path (same origin, no CORS)
// and appends the returned comment; the poster's name is remembered locally.
// `lang` is the page's language (pageLang). A translated page also sends it
// back with the comment (`&lang=`), so the server's own error messages match.
export function commentsSectionHtml(kind: ShareKind, token: string, comments: PublicComment[], nowMs: number, lang: Lang = "en"): string {
  const S = SHARE_STRINGS[lang].comments;
  const postLang = lang === "en" ? "" : ` + '&lang=${lang}'`;
  const items = (comments || []).map((c) => `
      <div class="sc-item">
        <div class="sc-meta"><span class="sc-name">${esc(c.name)}</span> · <span class="sc-time">${esc(relativeTime(c.created_at, nowMs, lang))}</span></div>
        <div class="sc-body">${esc(c.body)}</div>
      </div>`).join("");
  const n = (comments || []).length;
  return `
    <style>
      .sc-wrap { margin-top: var(--space-6); }
      .sc-title { font-size: var(--fs-body); font-weight: var(--fw-heavy); margin-bottom: var(--space-2-5); }
      .sc-item { background: var(--surface); border: var(--space-px) solid var(--border); border-radius: var(--radius); padding: var(--space-2-5) var(--space-3); margin-bottom: var(--space-2); }
      .sc-meta { font-size: var(--fs-sm); color: var(--muted); margin-bottom: var(--space-1); }
      .sc-name { font-weight: var(--fw-bold); color: var(--text); }
      .sc-body { font-size: var(--fs-md); white-space: pre-wrap; word-break: break-word; }
      .sc-empty { font-size: var(--fs-md); color: var(--muted); margin-bottom: var(--space-3); }
      .sc-form { background: var(--surface); border: var(--space-px) solid var(--border); border-radius: var(--radius); padding: var(--space-3); margin-top: var(--space-3); }
      .sc-form label { display: block; font-size: var(--fs-sm); color: var(--muted); margin: var(--space-1-5) 0 var(--space-1); }
      .sc-form input, .sc-form textarea { width: 100%; font: inherit; font-size: var(--fs-input); color: var(--text); background: var(--bg); border: var(--space-px) solid var(--border); border-radius: var(--radius-btn); padding: var(--space-2) var(--space-2-5); }
      .sc-form textarea { min-height: var(--size-20); resize: vertical; }
      .sc-hp { position: absolute; left: calc(-1 * var(--size-max)); width: var(--size-px); height: var(--size-px); overflow: hidden; }
      .sc-note { font-size: var(--fs-sm); color: var(--muted); margin-top: var(--space-1-5); }
      .sc-btn { display: inline-block; margin-top: var(--space-2-5); background: var(--gold); color: var(--white); border: none; border-radius: var(--radius-btn); padding: var(--space-2) var(--space-5); font: inherit; font-size: var(--fs-md); font-weight: var(--fw-semibold); cursor: pointer; }
      .sc-btn[disabled] { opacity: var(--opacity-dim); cursor: default; }
      .sc-err { font-size: var(--fs-base); color: var(--danger-text); margin-top: var(--space-1-5); min-height: 1em; }
    </style>
    <section class="sc-wrap" id="sc-wrap" data-kind="${esc(kind)}" data-token="${esc(token)}">
      <div class="sc-title">${S.title}${n ? ` (${num(lang, n)})` : ""}</div>
      <div id="sc-list">${items || `<div class="sc-empty" id="sc-empty">${S.empty}</div>`}</div>
      <form class="sc-form" id="sc-form" autocomplete="off">
        <label for="sc-name">${S.name}</label>
        <input id="sc-name" name="name" maxlength="${NAME_MAX}" placeholder="${S.namePh}" required>
        <label for="sc-body">${S.body}</label>
        <textarea id="sc-body" name="body" maxlength="${BODY_MAX}" placeholder="${S.bodyPh}" required></textarea>
        <div class="sc-hp" aria-hidden="true"><label for="sc-hp">Website</label><input id="sc-hp" name="hp" tabindex="-1" autocomplete="off"></div>
        <div class="sc-note">${S.note}</div>
        <div class="sc-err" id="sc-err"></div>
        <button type="submit" class="sc-btn" id="sc-submit">${S.submit}</button>
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
        fetch(location.pathname + '?t=' + encodeURIComponent(payload.t)${postLang}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
          .then(function (res) {
            btn.disabled = false;
            if (!res.j || !res.j.ok) { err.textContent = (res.j && res.j.error) || ${jsStr(S.failed)}; return; }
            var c = res.j.comment; try { localStorage.setItem('wr_sc_name', c.name); } catch (e) {}
            var empty = document.getElementById('sc-empty'); if (empty) empty.remove();
            var div = document.createElement('div'); div.className = 'sc-item';
            div.innerHTML = '<div class="sc-meta"><span class="sc-name">' + esc(c.name) + '</span> · <span class="sc-time">${jsStr(S.now).slice(1, -1)}</span></div><div class="sc-body">' + esc(c.body) + '</div>';
            list.appendChild(div); bodyEl.value = '';
          })
          .catch(function () { btn.disabled = false; err.textContent = ${jsStr(S.failed)}; });
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
  lang: Lang = "en",
): { subject: string; html: string } {
  const S = SHARE_COMMENT_STRINGS[lang];
  const SH = SHELL_STRINGS[lang];
  const k = kind === "collection" ? "collection" : "wishlist";
  const subject = S.subject[k];
  const trimmedLabel = (label || "").trim();
  const linkLine = trimmedLabel
    ? `<p style="margin:0 0 12px;">${fill(S.onLabel, { l: esc(trimmedLabel) })}</p>`
    : `<p style="margin:0 0 12px;">${S.onLink[k]}</p>`;
  const body = `
    <p style="margin:0 0 12px;">${fill(S.left, { n: esc(comment.name) })}</p>
    ${linkLine}
    <blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #b8941f;background:#faf7ee;border-radius:6px;white-space:pre-wrap;">${esc(comment.body)}</blockquote>
    <p style="margin:0;">${S.outro}</p>`;
  const unsubLine = `${aiNote(lang)}<a href="${esc(unsubUrl)}" style="color:#b8941f;text-decoration:underline;">${SH.unsub}</a> · <a href="https://wrotate.com/open" style="color:#999;text-decoration:underline;">${SH.manage}</a>`;
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
          <a href="https://wrotate.com/open?utm_source=email&utm_medium=transactional&utm_campaign=share-comment" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">${SH.open}</a>
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
