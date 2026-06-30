# Usability / UX Audit — WRotate — 2026-06-29

Scope: new/changed user-facing flows since 2026-06-22, checked against `2026-06-28-ux-consistency-audit.md` and `2026-06-22-usability-audit.md` to avoid re-reporting fixed items. Read-only; no code changed.

## Headline: two prior carried MEDIUM measure bugs are now FIXED

- **U-TG-V2-001 — FIXED.** The stray unconditional `completeMsg.style.color = 'var(--text)'` override is gone. Completion-message color is now set per branch (index.html:25497-25506): green-neutral for converged, yellow (`rgba(234,179,8,.8)`/`.7`) for the two lower-confidence retry warnings. Yellow warnings now actually render yellow.
- **U-TG-V2-002 — FIXED.** `'duration_cap'` is now in the troubleshoot-tips condition (index.html:25342). 2.0 users who hit the duration cap now increment `_msrConsecutiveFailures` and get `showTroubleshootTips()`.
- **U-CONFIRM-001 — FIXED.** Native `confirm()`/`alert()`/`prompt()` count is now **zero** across index.html (the two admin-campaign `confirm()` calls were migrated to `showConfirm`). Verified by grep incl. `window.`-prefixed forms.

## Findings table

| # | Sev | NEW/CARRIED | Flow | Location | Status |
|---|-----|-------------|------|----------|--------|
| UX29-1 | **Med** | NEW | Add-from-Photo | index.html:16555 vs 21454-21457 | **FIXED 2026-06-29** — wishlist empty-state Photo→`btn-primary`, manual→`btn-ghost` (matches Collection) |
| UX29-2 | Low | NEW | Measure weak-signal stop | index.html:23748, 23771, 25342 | OPEN |
| UX29-3 | Low | CARRIED | Feed own-post kebab "Report a comment" label | index.html:10501 | OPEN (intent unconfirmed) |

Everything else reviewed is clean/consistent.

## UX29-1 (MEDIUM, NEW) — Photo-vs-manual CTA hierarchy inverted between Collection and Wishlist empty states

- Collection empty state (index.html:16555): "Add from Photo" = `btn-primary`, "Add Manually" = `btn-ghost` → **Photo is hero**.
- Wishlist empty state (index.html:21454-21457): "Add from Photo" = `btn-ghost`, "Add to Wishlist" = `btn-primary` → **manual is hero**.

The same new feature is the hero action on one screen and de-emphasized on the other. Add-from-Photo is promoted as the lead path in What's New (L2245/2279) and onboarding (L2568).

**Note:** commit `c045f6b` ("style 'Add from Photo' as btn-ghost with camera icon") deliberately set the wishlist variant to ghost, so this may be an intentional product choice. Flagging the inconsistency, not asserting a bug. Fix if unintended: make wishlist's "Add from Photo" `btn-primary` to match collection.

## UX29-2 (LOW, NEW) — Two signal-failure stop reasons don't escalate to troubleshoot tips

The escalation at index.html:25342 increments `_msrConsecutiveFailures` (→ `showTroubleshootTips()` after 2) only for `no_ticks / no_ticks_after_recal / duration_timeout / duration_cap`. Excluded: `weak_signal` (L23771) and `no_ticks_signal_lost` (L23748). Each already shows an actionable inline message, but repeated weak-signal failures never accumulate toward the fuller troubleshoot panel — exactly what a chronically-weak-signal user needs. Optional fix: add `|| stopReason === 'weak_signal' || stopReason === 'no_ticks_signal_lost'` to the L25342 condition.

## UX29-3 (LOW, CARRIED) — Own-post kebab labels Report as "Report a comment"

index.html:10501 — own-post kebab shows "Report a comment" under "Edit post", calling `openReport('log',...)` with the owner's own `user_id`. Same item the 2026-06-28 report flagged as easy to misread; intent still unconfirmed.

## Flows reviewed and found CLEAN

- **Wishlist "Add from Photo"** (index.html:21862-21919): loading overlay `role="status" aria-live="polite"`; all error states handled (429, identify failure, success); photo always attached even on identify failure; overlay hidden unconditionally after try/catch; file validated; prefilled values to `.value` (no injection). Consistent label + camera icon with collection entry point.
- **Badge inline ribbon** (index.html:10481-10488): 16px medallion + "Earned: {name}", `escHtml`'d, opens detail on tap. Tokenized bg/radius (dark-mode safe). Badge-as-hero card and inline ribbon mutually exclusive — no double-render.
- **Edit-post occasion & strap** (index.html:4715-4732, renderEpDetails 11106-11133): mirrors the new-post composer exactly; collapsed by default; strap material `escHtml`'d; strap card auto-hides when <2 straps.
- **Onboarding "Measure accuracy" completion**: completes on *try* via `markMeasurementTried()` (localStorage flag from the measure stop path L25222); checklist re-renders immediately; idempotent.
- **Top-bar** (admin gear, streak chip, unified hover ring): all header icon buttons unified to 34×34 round, shared `box-shadow:0 0 0 1px var(--gold)` hover + `muted→text`. Admin gear (today's fix) correctly de-emphasized (`opacity:.55→1`) and centered (`align-self:center`). No contrast/sizing drift.
- **Measure red/yellow status text**: sits on the fixed dark instrument surface (exempted by the 2026-06-28 report). Readable both themes — not a finding.

## A11y note (carried from 2026-06-22, unchanged)
Advanced-Settings range sliders (U-A11Y-SLIDER-001) and the broader a11y tail (image-viewer dialog semantics, demo-modal Escape) were out of this audit's "new flows" scope; status unchanged from 2026-06-22.
