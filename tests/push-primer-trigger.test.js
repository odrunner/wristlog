import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// WHERE the push primer fires, not whether it should (that's shouldShowPushPrimer,
// covered in first-wear-onboarding.test.js). The gate was never the problem.
//
// The primer used to fire from markMeasurementTried(), which runs the instant the
// user taps "Start Listening" — so the modal landed 900ms later on top of a
// measurement they had just started, while the phone was held against the watch.
// Result over its first 25 shows: 0 taps on "Turn on notifications", 25 dismissals,
// median 1.9s to dismiss, and 17 of the 25 fired inside a measurement window. New
// external push registrations went to zero two days after it shipped.
//
// It now fires from the success side of the flow instead, where the wear-log
// trigger already sat. These are source assertions because both call sites live
// inside large DOM-bound functions with no extractable pure logic.
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const bodyOf = (name) => {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let depth = 0, seen = false;
  for (let p = html.indexOf('{', start); p < html.length; p++) {
    if (html[p] === '{') { depth++; seen = true; }
    else if (html[p] === '}') { depth--; if (seen && depth === 0) return html.slice(start, p + 1); }
  }
  return null;
};

describe('push primer trigger placement', () => {
  it('does NOT fire when a measurement STARTS', () => {
    // markMeasurementTried runs on the "Start Listening" tap. A modal here
    // interrupts the most delicate flow in the app.
    const fn = bodyOf('markMeasurementTried');
    expect(fn).toBeTruthy();
    expect(fn).not.toContain('maybeShowPushPrimer');
  });

  it('fires when the user finishes with a saved measurement', () => {
    // dismissMsrShareCta is the "Done" exit from the post-save CTA: the reading
    // is stored, the user is leaving, and nothing else is competing for the tap.
    const fn = bodyOf('dismissMsrShareCta');
    expect(fn).toBeTruthy();
    expect(fn).toContain('maybeShowPushPrimer()');
  });

  it('does not stack on top of the post-measurement CTA', () => {
    // showMsrShareCta reveals "Saved — log your wear?" — the core-loop CTA.
    // Priming there would bury it, trading one funnel for another.
    const fn = bodyOf('showMsrShareCta');
    expect(fn).toBeTruthy();
    expect(fn).not.toContain('maybeShowPushPrimer');
  });

  it('keeps the wear-log trigger on the success side', () => {
    // Already correct: fires after the log is saved and the toast shown.
    expect(html).toMatch(/if \(!isUpdate\) maybeShowPushPrimer\(\);/);
  });

  it('every remaining trigger sits on a success path', () => {
    // Guard against a new call site being added to a "user started something"
    // handler. Update this list deliberately, with the funnel in mind.
    const callers = [...html.matchAll(/function (\w+)\([^)]*\)\s*\{/g)]
      .map(m => m[1])
      .filter(name => (bodyOf(name) || '').includes('maybeShowPushPrimer('))
      .filter(name => name !== 'maybeShowPushPrimer');
    // saveLog: fires after a wear log is persisted. dismissMsrShareCta: after a
    // measurement is saved and the user taps Done. Both are post-success.
    expect(callers.sort()).toEqual(['dismissMsrShareCta', 'saveLog']);
  });
});
