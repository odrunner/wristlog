# Promo campaign action: open the feedback form

Date: 2026-08-06
Extends: `2026-08-02-merchandising-slots-design.md`

## Problem

Promo slots can drive a user to a page (`open_wishlist`, `open_measure`, …) or to an
https URL. There is no way to run a slot that *asks the user something* — "what should
we build next?" — and collects the answer. The owner wants to run those campaigns and
see the full funnel: how many people saw the card, how many tapped it, and how many
actually answered.

## Approach

Reuse the feedback modal that already exists (`#feedback-modal`) rather than building a
survey system. `requestBrand()` is the precedent: it opens that same modal in a variant
mode — retitled, type picker hidden, textarea prefilled. A promo-driven open is the same
move with different copy.

Rejected: a structured multiple-choice survey with its own responses table. Much more
surface area than one campaign justifies, and free text is what makes an "ask the users"
campaign worth running.

## Design

### 1. A `feedback:` payload prefix on `cta_action`

`promoActionFor()` handles two shapes today: a key in the `PROMO_ACTIONS` registry, or
`url:<https url>`. This adds a third:

```
feedback:                        → the question is slot.heading
feedback:What one thing would…   → the question is the override
```

Same validated-payload pattern as `url:`, so the `hasOwnProperty` guard against
`Object.prototype`-shaped keys and the "unknown key renders no button" rule are
untouched. `promo_slots.cta_action` is free text, so no migration.

The action functions take no arguments today, so `runPromoAction()` starts calling
`fn(slot)`. Existing entries ignore the argument.

### 2. `openPromoFeedback(slot, override)`

A sibling of `requestBrand()`, pulling the same levers on `#feedback-modal`:

- `#fb-modal-title-text` ← the question
- `#fb-type-picker` hidden, `feedbackType = 'feature'` (the table's CHECK constraint
  allows only `bug`/`feature`, and a suggestion is nearer to `feature` than to `bug`)
- `#fb-desc` cleared, placeholder → "Type your answer…", submit button → "Send"

Two new pieces of module state, both set here and cleared everywhere else the modal
opens or closes:

- `_feedbackPrompt` — the question. `submitFeedback()` stores it as the row `title`
  instead of the first 80 chars of the answer, so every answer to one campaign shares a
  title and they group visually in the admin Feedback tab.
- `_feedbackPromoSlotId` — which slot opened the modal, so a successful submit can be
  attributed.

`openFeedback()` and `requestBrand()` must reset both and restore the default
placeholder, the same way they already reset the title and the hint. Otherwise a promo
open leaks its question into the next generic Send Feedback.

### 3. Submissions in the funnel

`runPromoAction()` already logs a `click` before dispatching, so impressions and clicks
need no work. For the third number, `submitFeedback()` logs a `submit` promo event on a
successful insert when `_feedbackPromoSlotId` is set.

That needs two DB changes:

- `promo_events_event_check` widened from `impression|click|dismiss` to include `submit`.
- `promo_slot_stats()` returns a new `submissions` column. A changed return type means
  `drop function` before `create` — `create or replace` fails.

The admin slot line then reads
`312 impressions · 41 clicks · 28 submissions · 300 users`, which exposes the
tap-to-answer drop-off, not just reach.

`logPromoEvent()` counts only `impression` against `max_impressions`, so a `submit`
event caps nothing.

### 4. Admin composer

- `PROMO_ACTION_LABELS` gains `'feedback:': 'Open feedback form'`; the select's key list
  gains `'feedback:'` alongside `'url:'`.
- One new field, `promo-feedback-prompt` ("blank = use the heading"), wired to
  `updatePromoPreview()`.
- `promoFormSlot()` composes `'feedback:' + prompt`; `loadPromoIntoForm()` decomposes it
  — an exact mirror of the `url:` round-trip.

## Error handling

- Feedback insert fails → existing toast and button re-enable. No `submit` event is
  logged, so the funnel never counts an answer that was not stored.
- `submit` event insert fails → already handled by `logPromoEvent()`'s warn-on-error
  path. The user's feedback is saved either way; only the stat is lost.
- A blank override with a blank heading cannot occur: `promo_slots.heading` is NOT NULL.

## Testing

`promoActionFor` is not exported to `wrotate_test.js`, so this follows the in-browser
E2E pattern of `e2e/promo-card.mock.spec.js`:

- `feedback:` with no override titles the modal with the heading; with an override,
  with the override
- the type picker is hidden and the stored row's `title` is the question, not the answer
- a generic `openFeedback()` after a promo open shows the chips and the default
  placeholder again (the leak case)
- `renderPromoCard` still renders a button for `feedback:` and still renders none for
  `__proto__` and unknown keys
