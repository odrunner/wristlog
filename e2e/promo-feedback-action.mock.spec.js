import { test, expect } from '@playwright/test';

// Spec: docs/superpowers/specs/2026-08-06-promo-feedback-campaign-design.md
//
// A slot whose cta_action is 'feedback:…' opens the existing feedback modal in
// prompted mode: titled with the question, bug/feature chips hidden, and the
// stored row titled with the QUESTION rather than the answer's first line.

const SLOT = {
  id: 'fb1', kind: 'authored', eyebrow: 'Your turn',
  heading: 'What should we build next?',
  body: 'Tell us in one sentence.', image_url: '', images: [],
  cta_label: 'Tell us', cta_action: 'feedback:',
};

// Clicks a rendered promo card's CTA with logPromoEvent stubbed, and reports
// the resulting modal state. Returns the events the click produced too, so the
// impression → click → submit funnel is observable.
//
// _promoSlots is a script-level `let`, so it is NOT a window property — a
// `window._promoSlots = …` stub is silently ignored and runPromoAction() finds
// no slot. The bare assignment below reaches the real binding.
async function clickCta(page, slot) {
  await page.goto('/');
  return page.evaluate((s) => {
    window.__events = [];
    logPromoEvent = (slotId, event) => window.__events.push({ slotId, event });
    _promoSlots = [s];
    document.body.insertAdjacentHTML('afterbegin', window.renderPromoCard(s));
    document.querySelector('[data-promo-cta]').click();
    return {
      hidden:      document.getElementById('feedback-modal').classList.contains('hidden'),
      title:       document.getElementById('fb-modal-title-text').textContent,
      pickerShown: document.getElementById('fb-type-picker').style.display !== 'none',
      placeholder: document.getElementById('fb-desc').placeholder,
      submitLabel: document.getElementById('fb-submit-btn').textContent,
      events:      window.__events,
    };
  }, slot);
}

// `db` is a `const` in index.html, so it cannot be stubbed from page.evaluate —
// the insert has to be intercepted at the network layer. Returns the array the
// captured rows land in; it fills in as the page posts.
async function routeFeedback(page, { fail = false } = {}) {
  const rows = [];
  await page.route('**/rest/v1/feedback*', (route) => {
    if (route.request().method() !== 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (fail) {
      return route.fulfill({
        status: 400, contentType: 'application/json',
        body: JSON.stringify({ message: 'nope' }),
      });
    }
    const body = JSON.parse(route.request().postData() || '{}');
    rows.push(...(Array.isArray(body) ? body : [body]));
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  return rows;
}

test.describe('promo cta_action: feedback:', () => {
  test('an empty payload asks the card heading', async ({ page }) => {
    const r = await clickCta(page, SLOT);
    expect(r.hidden).toBe(false);
    expect(r.title).toBe('What should we build next?');
  });

  test('a payload overrides the heading', async ({ page }) => {
    const r = await clickCta(page, {
      ...SLOT, cta_action: 'feedback:What one thing would make WRotate better for you?',
    });
    expect(r.title).toBe('What one thing would make WRotate better for you?');
  });

  test('hides the bug/feature chips and asks for an answer, not a bug report', async ({ page }) => {
    const r = await clickCta(page, SLOT);
    expect(r.pickerShown).toBe(false);
    expect(r.placeholder).toBe('Type your answer…');
    expect(r.submitLabel).toBe('Send');
  });

  test('still logs the click, so the funnel keeps its middle number', async ({ page }) => {
    const r = await clickCta(page, SLOT);
    expect(r.events).toEqual([{ slotId: 'fb1', event: 'click' }]);
  });

  test('renders a CTA button for feedback: but none for an unknown prefix', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate((s) => ({
      feedback: window.renderPromoCard(s),
      bogus:    window.renderPromoCard({ ...s, cta_action: 'feedbackx:hi' }),
      isFn:     typeof window.promoActionFor('feedback:') === 'function',
    }), SLOT);
    expect(out.feedback).toContain('data-promo-cta');
    expect(out.feedback).toContain('Tell us');
    expect(out.bogus).not.toContain('data-promo-cta');
    expect(out.isFn).toBe(true);
  });

  test('titles the stored row with the question and logs a submit event', async ({ page }) => {
    const rows = await routeFeedback(page);
    await page.goto('/');
    const events = await page.evaluate(async (s) => {
      window.__events = [];
      logPromoEvent = (slotId, event) => window.__events.push({ slotId, event });
      demoGuard = () => false;
      toast = () => {};
      window.openPromoFeedback(s, '');
      document.getElementById('fb-desc').value = 'honestly just make the timegrapher more consistent';
      await window.submitFeedback();
      return window.__events;
    }, SLOT);

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('What should we build next?');
    expect(rows[0].details).toBe('honestly just make the timegrapher more consistent');
    expect(rows[0].type).toBe('feature');
    expect(events).toEqual([{ slotId: 'fb1', event: 'submit' }]);
  });

  test('a failed insert logs no submit event, so the count never overstates answers', async ({ page }) => {
    await routeFeedback(page, { fail: true });
    await page.goto('/');
    const r = await page.evaluate(async (s) => {
      window.__events = [];
      logPromoEvent = (slotId, event) => window.__events.push({ slotId, event });
      demoGuard = () => false;
      toast = () => {};
      window.openPromoFeedback(s, '');
      document.getElementById('fb-desc').value = 'an answer';
      await window.submitFeedback();
      return {
        events: window.__events,
        // The button was relabelled "Send" by the promo open; a failed insert
        // must restore THAT, not the generic label.
        submitLabel: document.getElementById('fb-submit-btn').textContent,
        stillOpen: !document.getElementById('feedback-modal').classList.contains('hidden'),
      };
    }, SLOT);

    expect(r.events).toEqual([]);
    expect(r.submitLabel).toBe('Send');
    expect(r.stillOpen).toBe(true);
  });

  test('a plain Send Feedback after a promo open is not still the campaign', async ({ page }) => {
    const rows = await routeFeedback(page);
    await page.goto('/');
    const r = await page.evaluate(async (s) => {
      logPromoEvent = () => {};
      demoGuard = () => false;
      toast = () => {};

      window.openPromoFeedback(s, '');          // campaign mode…
      window.closeFeedback();                   // …cancelled…
      window.openFeedback();                    // …then the generic entry point.
      const mid = {
        title:       document.getElementById('fb-modal-title-text').textContent,
        pickerShown: document.getElementById('fb-type-picker').style.display !== 'none',
        placeholder: document.getElementById('fb-desc').placeholder,
        submitLabel: document.getElementById('fb-submit-btn').textContent,
      };
      document.getElementById('fb-desc').value = 'the app crashes when I tap save on a long log entry';
      await window.submitFeedback();
      return mid;
    }, SLOT);

    expect(r.title).toBe('Send Feedback');
    expect(r.pickerShown).toBe(true);
    expect(r.placeholder).toBe('Describe the issue or idea…');
    expect(r.submitLabel).toBe('Submit Feedback');
    // Titled from the answer again — not left holding the campaign question.
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('the app crashes when I tap save on a long log entry');
    expect(rows[0].type).toBe('bug');
  });
});
