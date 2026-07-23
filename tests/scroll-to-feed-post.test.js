import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Extract a top-level function body: from its signature to the next function decl.
const fnBody = (marker) => {
  const i = html.indexOf(marker);
  if (i === -1) return '';
  const rest = html.slice(i + marker.length);
  const next = rest.search(/\n(async )?function [a-zA-Z]/);
  return next === -1 ? rest : rest.slice(0, next);
};

describe('scrollToFeedPost — notification tap to a post', () => {
  const body = fnBody('async function scrollToFeedPost(');

  it('is present', () => {
    expect(body).not.toBe('');
  });

  // Regression (stale comment): the feed has no realtime subscription, so its comment
  // cache is frozen at load time. This used to `if (highlight()) return;` as soon as the
  // card was already on screen, so a comment added by someone else after the feed loaded
  // was never fetched and never displayed.
  it('does not early-return before refreshing when the card is already rendered', () => {
    expect(body).not.toMatch(/if\s*\(highlight\(\)\)\s*return;/);
  });

  it('force-refreshes the post comments on every navigation', () => {
    expect(body).toContain('fetchComments(postId)');
  });

  it('re-renders after refreshing so the new comment shows', () => {
    expect(body).toContain('renderFeed()');
  });

  // Regression (lands half-way): a single scrollIntoView fired before the card's layout
  // settled (images loading, comment section expanding), so it landed at a stale offset
  // and never corrected. It must re-scroll after layout settles.
  it('re-scrolls after layout settles instead of scrolling once', () => {
    const reScrolls = (body.match(/setTimeout\(highlight,/g) || []).length;
    expect(reScrolls).toBeGreaterThanOrEqual(2);
  });

  it('still retries until the card exists (post older than the loaded page)', () => {
    expect(body).toMatch(/setTimeout\(attempt,/);
  });
});
