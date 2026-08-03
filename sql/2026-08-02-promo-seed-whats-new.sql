-- Seeds the retired new-features modal's copy as the first slot.
-- DRAFT, not active: activating it puts content in real users' feeds and is
-- the user's call, not the implementer's.
--
-- Copy source: index.html #whats-new-modal, the "Pro V2 Measurement Engine —
-- now the default" entry under the July 2026 section (the current, up-to-date
-- restatement of the same Pro V2 announcement the retired popover made).
insert into public.promo_slots (eyebrow, heading, body, cta_label, cta_action, audience, status, priority)
values (
  'New',
  'Pro V2 Measurement Engine ⚡ — now the default',
  'Our rebuilt timegrapher engine is out of beta and now runs by default on the Measure page — nothing to switch on. It settles fast, holds steady between runs, and measures <strong>amplitude (°)</strong> — the balance wheel’s swing, a key health indicator watchmakers look at. Needs app version 2.1 or later. Prefer the previous behaviour? Pick <strong>Standard</strong> from the engine selector anytime. Amplitude shows only when the signal is clean enough to trust — if it’s blank, reposition and try again.',
  'See what''s new',
  'open_collection',
  'all',
  'draft',
  0
);
