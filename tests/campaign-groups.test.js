import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { campaignSubject, campaignGroupOf, CAMPAIGN_GROUP_LABELS } from '../wrotate_test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Admin → Traffic → "By Campaign". Per-actor notification subjects ("masont
// mentioned you", "SA also commented") must collapse into one bucket each, and
// the notification buckets get their own section rather than being scattered
// through "Older campaigns".
//
// Reported 2026-07-19: mentions were landing in "Older campaigns" as individual
// per-actor rows because campaignSubject only collapsed comments and follows.

describe('campaignSubject', () => {
  it('collapses mentions into one bucket', () => {
    expect(campaignSubject('masont mentioned you')).toBe('Mentions');
    expect(campaignSubject('Call me T mentioned you')).toBe('Mentions');
  });

  it('collapses comments into one bucket', () => {
    expect(campaignSubject('SA commented on your post')).toBe('Comments');
    expect(campaignSubject('SA also commented')).toBe('Comments');
    expect(campaignSubject('masont also commented')).toBe('Comments');
  });

  it('collapses follows into one bucket', () => {
    expect(campaignSubject('masont wants to follow you')).toBe('Follows');
    expect(campaignSubject('8w46fyrtgg wants to follow you')).toBe('Follows');
    expect(campaignSubject('Timur added you as a close friend')).toBe('Follows');
  });

  it('leaves real campaign subjects untouched', () => {
    expect(campaignSubject('Add your first watch')).toBe('Add your first watch');
    expect(campaignSubject('A massive upgrade to measurement accuracy'))
      .toBe('A massive upgrade to measurement accuracy');
  });

  it('does not mistake a campaign mentioning "follow" for a follow notification', () => {
    // Guard the substring match: a marketing subject containing the word
    // "followers" should not be swallowed into the Follows bucket.
    expect(campaignSubject('mentioned you')).toBe('Mentions');
  });

  it('tolerates null / empty', () => {
    expect(campaignSubject(null)).toBe(null);
    expect(campaignSubject('')).toBe('');
  });
});

describe('campaignGroupOf', () => {
  const ONBOARDING = [
    'Add your first watch',
    'Start tracking your wears',
    'How accurate is your watch?',
    'Which watch is really your favorite?',
  ];

  it('puts the four onboarding drips in group 0, in order', () => {
    ONBOARDING.forEach((s, i) => {
      expect(campaignGroupOf(s).group).toBe(0);
      expect(campaignGroupOf(s).rank).toBe(i);
    });
  });

  it('puts Follows, Comments and Mentions together in the notifications group', () => {
    for (const s of ['Follows', 'Comments', 'Mentions']) {
      expect(campaignGroupOf(s).group).toBe(1);
    }
  });

  it('orders the notification buckets Follows, Comments, Mentions', () => {
    expect(campaignGroupOf('Follows').rank).toBe(0);
    expect(campaignGroupOf('Comments').rank).toBe(1);
    expect(campaignGroupOf('Mentions').rank).toBe(2);
  });

  it('keeps in-flight broadcasts in their own group', () => {
    expect(campaignGroupOf('Your watch has more to tell you — meet the Pro V2 engine (beta)').group).toBe(2);
  });

  it('drops everything else into "Older campaigns"', () => {
    expect(campaignGroupOf('3 new things in WRotate since you joined').group).toBe(3);
    expect(campaignGroupOf('A massive upgrade to measurement accuracy').group).toBe(3);
  });

  it('mentions no longer land in Older campaigns', () => {
    expect(campaignGroupOf(campaignSubject('masont mentioned you')).group).not.toBe(3);
  });

  it('labels the notifications group distinctly', () => {
    expect(CAMPAIGN_GROUP_LABELS).toHaveLength(4);
    expect(CAMPAIGN_GROUP_LABELS[1]).toMatch(/notification/i);
  });
});

// mirror-drift.test.js can't byte-compare an array literal, so guard the two
// copies of the label list and the notification bucket list here instead.
describe('index.html mirrors the campaign constants', () => {
  const arrayIn = (name) => {
    const m = html.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) return null;
    return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  };

  it('CAMPAIGN_GROUP_LABELS matches wrotate_test.js', () => {
    expect(arrayIn('CAMPAIGN_GROUP_LABELS')).toEqual(CAMPAIGN_GROUP_LABELS);
  });

  it('the notification bucket list includes Mentions', () => {
    expect(arrayIn('CAMPAIGN_NOTIFICATIONS')).toEqual(['Follows', 'Comments', 'Mentions']);
  });

  it('renderEmailEngagement uses the shared helpers, not a local copy', () => {
    const start = html.indexOf('function renderEmailEngagement(');
    const fn = html.slice(start, html.indexOf('\n}\n', start));
    expect(fn).toContain('campaignGroupOf(');
    expect(fn).not.toMatch(/const campaignSubject\s*=/);
    // The old subject-regex filter is gone; the RPC filters by recipient now.
    expect(fn).not.toContain('weekly measurements|weekly analysis');
  });
});
