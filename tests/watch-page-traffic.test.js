import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 2026-10-03: first-party traffic telemetry for the public Watches pages.
// w/ was the one public page not logging page_visits (p/ and profile/ already
// did), so Admin → Traffic had no view of the launch. The w/ tracker writes a
// row per source+model per 30 min with the slug in `path`; the admin card
// reads it through admin_watch_page_traffic().

describe('w/ logs page_visits like the other public pages', () => {
  const src = readFileSync(join(root, 'w/index.html'), 'utf8');

  it('inserts a page_visits row', () => {
    expect(src).toContain(".from('page_visits').insert(");
  });

  it('carries the model slug in path so admin can break down per watch', () => {
    expect(src).toMatch(/path:\s*'\/w\/'/);
    expect(src).toContain("'?m=' + slug");
  });

  it('only keeps external referrers (same-host navigation is not a source)', () => {
    expect(src).toMatch(/referrer\s*&&\s*!ref\.includes\(window\.location\.hostname\)|!ref\.includes\(window\.location\.hostname\)/);
  });

  it('keeps the PostHog model_page_viewed event (the richer geo/UTM source)', () => {
    expect(src).toContain("posthog.capture('model_page_viewed'");
  });
});

describe('Admin → Traffic shows the Watch Pages card', () => {
  const src = readFileSync(join(root, 'index.html'), 'utf8');

  it('fetches admin_watch_page_traffic alongside the other traffic RPCs', () => {
    expect(src).toContain("db.rpc('admin_watch_page_traffic'");
  });

  it('renders the Watch Pages card', () => {
    expect(src).toContain('Watch Pages');
  });
});

describe('admin_watch_page_traffic SQL is admin-locked', () => {
  const sql = readFileSync(join(root, 'sql/2026-10-03-watch-page-traffic.sql'), 'utf8');

  it('checks is_admin before returning anything', () => {
    expect(sql).toMatch(/is_admin = true/);
    expect(sql).toMatch(/RAISE EXCEPTION 'Not authorized'/);
  });

  it('revokes anon/public and grants only authenticated', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.admin_watch_page_traffic\(integer\) FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_watch_page_traffic\(integer\) TO authenticated/);
  });

  it('reloads the PostgREST schema cache', () => {
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
