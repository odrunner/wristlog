import { describe, it, expect } from 'vitest';
import { fillCampaignTokens, unresolvedCampaignTokens } from '../wrotate_test.js';

// Matches escHtml in index.html.
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const raw = (s) => s;

const SAMPLE = {
  watch: 'Rolex Explorer 40',
  watchPhrase: 'your Rolex Explorer 40',
  fact: 'The applied hour markers are crafted from 18k white gold.',
};

describe('fillCampaignTokens', () => {
  it('fills every campaign token, not just {{name}}', () => {
    // The shipped bug: only {{name}} was substituted, so the test email arrived
    // reading "A fun fact about {{watchPhrase}}".
    const out = fillCampaignTokens(
      'Hi {{name}} · {{watch}} · {{watchPhrase}} · {{fact}}', SAMPLE, raw);
    expect(out).toBe(
      'Hi Ozgur · Rolex Explorer 40 · your Rolex Explorer 40 · ' +
      'The applied hour markers are crafted from 18k white gold.');
    expect(unresolvedCampaignTokens(out)).toEqual([]);
  });

  it('substitutes {{watchPhrase}} whole, never as {{watch}} + "Phrase}}"', () => {
    expect(fillCampaignTokens('{{watchPhrase}}', SAMPLE, raw)).toBe('your Rolex Explorer 40');
  });

  it('escapes values for the HTML body', () => {
    const vars = { watch: 'A. Lange & Söhne', watchPhrase: 'your <b>', fact: 'He said "no".' };
    expect(fillCampaignTokens('{{watch}}|{{watchPhrase}}|{{fact}}', vars, esc))
      .toBe('A. Lange &amp; Söhne|your &lt;b&gt;|He said &quot;no&quot;.');
  });

  it('leaves values raw for the plain-text subject header', () => {
    const vars = { ...SAMPLE, watchPhrase: 'your A. Lange & Söhne' };
    expect(fillCampaignTokens('A fun fact about {{watchPhrase}}', vars, raw))
      .toBe('A fun fact about your A. Lange & Söhne');
  });

  it('replaces every occurrence', () => {
    expect(fillCampaignTokens('{{watch}} and {{watch}}', SAMPLE, raw))
      .toBe('Rolex Explorer 40 and Rolex Explorer 40');
  });

  it('leaves token-free copy untouched', () => {
    expect(fillCampaignTokens('Add your first watch', SAMPLE, raw)).toBe('Add your first watch');
  });

  it('handles empty and nullish input', () => {
    expect(fillCampaignTokens('', SAMPLE, raw)).toBe('');
    expect(fillCampaignTokens(null, SAMPLE, raw)).toBe('');
    expect(fillCampaignTokens(undefined, SAMPLE, raw)).toBe('');
  });
});

describe('unresolvedCampaignTokens', () => {
  it('reports the per-recipient tokens a cohort blast cannot fill', () => {
    expect(unresolvedCampaignTokens('A fun fact about {{watchPhrase}}: {{fact}}'))
      .toEqual(['{{watchPhrase}}', '{{fact}}']);
  });

  it('deduplicates repeats', () => {
    expect(unresolvedCampaignTokens('{{watch}} {{watch}}')).toEqual(['{{watch}}']);
  });

  it('ignores {{name}} — send-broadcast copy has always been written without it', () => {
    expect(unresolvedCampaignTokens('Hi {{name}}, welcome back')).toEqual([]);
  });

  it('passes clean copy', () => {
    expect(unresolvedCampaignTokens('Hi there, we shipped a few things')).toEqual([]);
  });
});
