# Usability / Accessibility Audit — 2026-08-13

Fresh audit. Measured against the current `index.html` and a real browser.

**Accessibility fundamentals are in better shape than most projects this size** —
worth recording so future audits don't re-check them:

- 43 modals carry both `role="dialog"` and `aria-modal` — full coverage, not partial
- 13 `aria-live` regions for async status
- 142 `<label>` elements against 190 inputs; exactly **one** input has neither an
  `id` nor an `aria-label` (a bare `<input type=date>`)
- `prefers-reduced-motion` is respected
- 94 `aria-label` attributes and 91 `role=` attributes overall
- `confirm()` / `alert()` have been fully eliminated per the project rule — zero
  remaining

The findings below are the gaps.

---

## U1 — MEDIUM (NEW): 15 images have no `alt`, mostly avatars.

73 `<img>` tags, 58 with `alt`. The unlabelled ones are concentrated in the places a
screen reader user most needs orientation — user and club avatars in member lists,
follower lists and popovers:

```html
<img src="${escHtml(m.avatar_url)}" onerror="this.style.display='none'">
<img src="${escHtml(p.avatar_url)}" style="width:28px;height:28px;…">
<img src="${escHtml(club.image_url)}" onerror="this.style.display='none'">
```

With no `alt`, a screen reader announces the image URL — a long Supabase storage path
— in place of the person's name. In a member list that is one unreadable URL per row.

**Fix:** `alt="${escAttr(m.display_name || m.username || '')}"` on avatars that
identify someone, and `alt=""` on the purely decorative ones so they are skipped
rather than read out.

Note the interaction with security finding S3: `escAttr` is correct here, because
`alt` is a plain HTML attribute rather than a JS string context.

---

## U2 — MEDIUM (NEW): Escape closes only some modals.

13 `Escape` references cover 43 `role="dialog"` modals. Escape-to-dismiss is a
learned reflex, and a modal that ignores it reads as frozen — particularly on desktop,
and particularly for keyboard-only users who may have no other reachable way out if
the close button is not in the tab order.

There are also only 15 `.focus()` calls across those 43 modals, so most do not move
focus into the dialog on open. Without that, a screen reader stays parked behind the
overlay and a keyboard user tabs through the page underneath.

**Fix:** handle both once, centrally, rather than per modal — a single document-level
`keydown` that closes the topmost open dialog, plus focus-in-on-open and
focus-restore-on-close in the shared open/close helpers. Given the modals already
share `role="dialog"`, a generic implementation can find them without touching all 43.

---

## U3 — MEDIUM (NEW): The error toast shows users a stack trace.

Cross-referenced from reliability finding R2. Every unhandled rejection produces:

```
BG fail: Failed to fetch @ at loadFeed (https://wrotate.com/index.html:12…
```

From a usability standpoint the problem is that it names no action. The user learns
something broke, is shown a fragment of code, and is given nothing to do about it.
Compare the generic handler's `'Something went wrong. Try refreshing.'` — which at
least suggests a step, though as R1 shows it is sometimes the wrong one.

**Fix:** plain user-facing text, detail to the console. Where the app can tell the
failure is network-related, say so and offer retry — that is actionable, and it is the
common case on mobile.

---

## U4 — LOW (NEW): Touch-target sizing is not systematic.

Only 3 references to a 44px minimum across the whole stylesheet, against 477 buttons.
Several inline-styled controls are visibly below the 44x44px guidance — for example
the valuation row's `font-size:.78rem;padding:.35rem .7rem` buttons, which compute to
roughly 28px tall.

This is a phone-first app, so it matters more here than the raw number suggests.

**Fix:** a `min-height:44px` floor on the shared `.btn` classes in
`design-system.css`, rather than chasing individual call sites. Check the dense admin
tables afterwards — they may want an explicit compact opt-out.

---

## U5 — LOW: Inline styles undercut the design system.

`design-system.css` exists and is correctly linked from `index.html`, `p/index.html`
and `profile/index.html` without re-declaring tokens. But `index.html` carries 157 KB
of inline CSS and a very large number of inline `style="…"` attributes with hardcoded
values (`font-size:.65rem`, `width:28px`, literal hex colours alongside `var(--gold)`).

Nothing is broken today. The cost is that visual changes require finding every
hardcoded instance, which is how token drift starts — and the tokens test suite can
only protect what actually uses tokens.

**Fix:** opportunistic, not a project. When touching a component, move its inline
styles to a class. Prioritise anything with a hardcoded colour, since those are what
break dark mode.

---

## U6 — NOTE: what a private-profile user currently experiences.

Cross-referenced from security finding S1. 128 users have set their profile to
Followers-only or Private. The app honours that setting in its own UI, so from inside
the product the feature appears to work exactly as promised.

Flagging it here as well as in the security audit because the usability dimension is
distinct: this is not a confusing control or a discoverability gap. It is a control
that tells the user something true about the app and false about their data. If S1 is
not fixed promptly, the honest interim step is to stop offering the setting rather
than let it keep making a promise it does not keep.

## Priority

1. **U1** — small, mechanical, and it fixes the worst screen-reader experience in the app.
2. **U2** — one central handler covers all 43 modals.
3. **U3** — same one-line fix as R2.
4. **U4** — one CSS floor, then spot-check.
5. **U5** — opportunistic.
