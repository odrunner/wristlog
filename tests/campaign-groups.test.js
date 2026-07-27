import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  campaignSubject, campaignGroupOf, CAMPAIGN_GROUP_LABELS,
  CAMPAIGN_FUNFACT_DRIP, CAMPAIGN_WINBACK_FUNFACT,
} from '../wrotate_test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Admin → Traffic → "By Campaign". Subjects that vary per recipient must
// collapse into one campaign bucket, and the notification buckets get their own
// section rather than being scattered through "Older campaigns".
//
// Reported 2026-07-19: mentions were landing in "Older campaigns" as individual
// per-actor rows because campaignSubject only collapsed comments and follows.
// Reported 2026-07-27: same class of bug for "X accepted your friend request"
// and for the personalized fun-fact subjects.

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

  it('collapses the whole follow graph into Connections', () => {
    expect(campaignSubject('masont wants to follow you')).toBe('Connections');
    expect(campaignSubject('8w46fyrtgg wants to follow you')).toBe('Connections');
    expect(campaignSubject('Dan started following you')).toBe('Connections');
    expect(campaignSubject('SA accepted your follow request')).toBe('Connections');
  });

  it('collapses friend/close-friend requests into Connections too', () => {
    // Regression: "accepted your friend request" contains neither 'follow' nor
    // 'close friend', so it escaped into "Older campaigns" as a 1-delivered row.
    expect(campaignSubject('Dan accepted your friend request')).toBe('Connections');
    expect(campaignSubject('Timur accepted your friend request')).toBe('Connections');
    expect(campaignSubject('OD sent a close friend request')).toBe('Connections');
    expect(campaignSubject('Timur added you as a close friend')).toBe('Connections');
  });

  it('collapses the personalized fun-fact drip subjects', () => {
    expect(campaignSubject('A fun fact about your Seiko Sekonda')).toBe(CAMPAIGN_FUNFACT_DRIP);
    expect(campaignSubject('A fun fact about the Omega Speedmaster')).toBe(CAMPAIGN_FUNFACT_DRIP);
  });

  it('keeps the win-back broadcast separate from the fun-fact drip', () => {
    // Both subjects contain "fun fact about" — an unanchored match would merge
    // two genuinely different campaigns into one row.
    const winback = 'Your watches miss you — here’s a fun fact about the Omega Speedmaster';
    expect(campaignSubject(winback)).toBe(CAMPAIGN_WINBACK_FUNFACT);
    expect(campaignSubject(winback)).not.toBe(CAMPAIGN_FUNFACT_DRIP);
  });

  it('leaves real campaign subjects untouched', () => {
    expect(campaignSubject('Add your first watch')).toBe('Add your first watch');
    expect(campaignSubject('A massive upgrade to measurement accuracy'))
      .toBe('A massive upgrade to measurement accuracy');
    expect(campaignSubject('Start tracking your wears')).toBe('Start tracking your wears');
  });

  it('tolerates null / empty', () => {
    expect(campaignSubject(null)).toBe(null);
    expect(campaignSubject('')).toBe('');
  });
});

describe('campaignGroupOf', () => {
  const ONBOARDING = [
    'Add your first watch',
    CAMPAIGN_FUNFACT_DRIP,
    'How accurate is your watch?',
    'Which watch is really your favorite?',
  ];

  it('puts the four onboarding drips in group 0, in order', () => {
    ONBOARDING.forEach((s, i) => {
      expect(campaignGroupOf(s).group).toBe(0);
      expect(campaignGroupOf(s).rank).toBe(i);
    });
  });

  it('makes the fun-fact drip onboarding slot 2, not an Older campaign', () => {
    // email_campaigns "Onboarding 2 — Start your streak" (active) replaced the
    // retired "Start tracking your wears".
    expect(campaignGroupOf(campaignSubject('A fun fact about your Seiko Sekonda')))
      .toEqual({ group: 0, rank: 1 });
  });

  it('retires "Start tracking your wears" to Older campaigns', () => {
    expect(campaignGroupOf('Start tracking your wears').group).toBe(3);
  });

  it('puts Connections, Comments and Mentions together in the notifications group', () => {
    for (const s of ['Connections', 'Comments', 'Mentions']) {
      expect(campaignGroupOf(s).group).toBe(1);
    }
  });

  it('orders the notification buckets Connections, Comments, Mentions', () => {
    expect(campaignGroupOf('Connections').rank).toBe(0);
    expect(campaignGroupOf('Comments').rank).toBe(1);
    expect(campaignGroupOf('Mentions').rank).toBe(2);
  });

  it('puts a broadcast in group 2 only while it has pending queue rows', () => {
    const subj = 'Your watch has more to tell you — meet the Pro V2 engine (beta)';
    expect(campaignGroupOf(subj, new Set([subj])).group).toBe(2);
    // Drained: no pending rows, so it falls through to "Older campaigns"
    // instead of claiming the in-progress section forever.
    expect(campaignGroupOf(subj, new Set()).group).toBe(3);
    expect(campaignGroupOf(subj).group).toBe(3);
  });

  it('matches an in-flight broadcast by its collapsed key', () => {
    // active_broadcasts carries per-recipient subjects; both sides go through
    // campaignSubject so the personalized rows meet the queue rows.
    const active = new Set(['Your watches miss you — here’s a fun fact about the Tudor Black Bay']
      .map(campaignSubject));
    expect(campaignGroupOf(campaignSubject(
      'Your watches miss you — here’s a fun fact about the Omega Speedmaster'), active).group).toBe(2);
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

  it('the collapsed campaign keys match wrotate_test.js', () => {
    // Plain string consts, so mirror-drift.test.js can only assert they exist in
    // both files (ADAPTED). Compare the values here: a drifted key would split
    // one campaign into two rows, or merge two into one.
    const stringIn = (name) => {
      const m = html.match(new RegExp(`const ${name}\\s*=\\s*'([^']*)'`));
      return m ? m[1] : null;
    };
    expect(stringIn('CAMPAIGN_FUNFACT_DRIP')).toBe(CAMPAIGN_FUNFACT_DRIP);
    expect(stringIn('CAMPAIGN_WINBACK_FUNFACT')).toBe(CAMPAIGN_WINBACK_FUNFACT);
  });

  it('the notification bucket list is Connections/Comments/Mentions', () => {
    expect(arrayIn('CAMPAIGN_NOTIFICATIONS')).toEqual(['Connections', 'Comments', 'Mentions']);
  });

  it('onboarding slot 2 is the fun-fact drip constant, not a retired subject', () => {
    expect(arrayIn('CAMPAIGN_ONBOARDING')[1]).toBe('CAMPAIGN_FUNFACT_DRIP');
  });

  it('no hardcoded in-flight broadcast list survives', () => {
    // The whole point of active_broadcasts: a finished broadcast should drop out
    // on its own, with nobody editing an array.
    expect(html).not.toContain('CAMPAIGN_ACTIVE_BROADCASTS');
  });

  it('renderEmailEngagement uses the shared helpers, not a local copy', () => {
    const start = html.indexOf('function renderEmailEngagement(');
    const fn = html.slice(start, html.indexOf('\n}\n', start));
    expect(fn).toContain('campaignGroupOf(');
    expect(fn).not.toMatch(/const campaignSubject\s*=/);
    // The old subject-regex filter is gone; the RPC filters by recipient now.
    expect(fn).not.toContain('weekly measurements|weekly analysis');
    // In-progress comes from the queue, via the RPC.
    expect(fn).toContain('active_broadcasts');
  });
});
