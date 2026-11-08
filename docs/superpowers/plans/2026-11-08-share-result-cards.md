# Share-result cards + landing social proof — plan (2026-11-08)

Growth proposal #9 (weekly report 2026-11-08): the single most shareable
artifact — a finished timegrapher reading — has no share loop, and the
landing's "You're in good company" section renders a heading with no content
to logged-out visitors.

## Part A — "Share result" card (experiment `result_share`)

**Goal:** a collector shows a friend "+0.8 s/d" and that friend lands on
wrotate.com with attribution.

**Phase 1 (this plan): image card via the native share sheet. No server.**
1. On a converged result (result screen + measurement history detail), add a
   **Share result** button behind `experiment('result_share')`.
2. The button renders a canvas card: watch brand/name, big rate, amplitude,
   beat error, measured date, WRotate wordmark + "wrotate.com". All visual
   values via `dsToken()`/`dsCanvas()` — no literals (ratchet). No emoji.
3. Share as PNG through `navigator.share({files})` with text
   `Measured with WRotate — https://wrotate.com/?utm_source=result_share`;
   clipboard/download fallback where file-share is unsupported.
4. Log `feature_events` `result_share` on completion (that's the experiment
   metric; add `experiment_metrics` row `source feature_events:result_share`).
   Attribution of the inbound side: `page_visits` already captures
   `utm_source=result_share`.
5. Sharing is user-initiated and shares only the user's own reading — no
   privacy surface beyond what the user chooses to send.

**Phase 2 (separate decision, only if Phase 1 shows volume):** a hosted
share page (like recap_shares) with a real OG image, so the link itself
unfurls in chats. Needs a share table + public page + revocation; not now.

**Effort:** M. **Measure:** experiment metric (share usage), plus
`utm_source=result_share` visits → signups in Admin → Traffic.

## Part B — landing "You're in good company" block

**The landing page is frozen by project law — nothing here ships without the
owner's explicit line-item approval.** The section currently renders an empty
heading to outsiders; two options:

- **Fill (recommended):** one static line under the heading —
  "4.8 stars on the App Store · 890+ collectors" — with the numbers BAKED at
  build time (extend `scripts/build-site.mjs`/gen step; the landing
  deliberately makes zero PostgREST reads when logged out, and stays that way).
  Refreshes whenever the site deploys.
- **Cut:** remove the heading entirely. Zero maintenance, loses the
  social-proof slot.

**Effort:** S either way. Needs: owner picks fill vs cut (and approves the
exact copy if fill).

## Order of work
1. Owner approves plan (+ picks B: fill or cut, approves copy).
2. A: metric row + experiment draft, canvas card, share flow, unit tests for
   the card-layout helper, mocked e2e for button visibility per arm, sw bump.
3. B: one-line landing change + `compare.sh landing` must stay 0 except the
   approved diff — ships only with explicit approval.
4. Owner starts `result_share` in Admin → Experiments.
