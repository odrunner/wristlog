// Guards sql/2026-11-07-dm-log-visibility.sql — NEW-2: a shared log attached to a DM
// must be VISIBLE to the sender, not merely exist (SECURITY DEFINER saw everything).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-11-07-dm-log-visibility.sql'), 'utf8');
const src = readFileSync(join(root, 'sql', '2026-11-05-dms.sql'), 'utf8');

const fnBlock = (text, name) => {
  const m = text.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`));
  return m && m[0];
};
const OLD = 'IF v_log IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.logs WHERE id = v_log) THEN';
const NEW = 'IF v_log IS NOT NULL AND NOT public.dm_log_visible(v_me, v_log) THEN';

describe('dm_log_visible helper', () => {
  const helper = fnBlock(sql, 'dm_log_visible');
  it('exists, SECURITY DEFINER, search_path pinned, internal-only (no client EXECUTE)', () => {
    expect(helper).toMatch(/SECURITY DEFINER SET search_path = public/);
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.dm_log_visible(uuid, text) FROM PUBLIC, anon, authenticated');
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.dm_log_visible/);
  });
  it('mirrors every branch of the logs RLS visibility rule', () => {
    expect(helper).toContain('l.user_id = p_viewer');                     // own logs
    expect(helper).toContain('l.moderation_status IS NULL');              // moderated never shared
    expect(helper).toContain("l.visibility = 'public'");
    expect(helper).toMatch(/visibility = 'followers'[\s\S]*?FROM follows/);
    expect(helper).toMatch(/visibility = 'friends'[\s\S]*?FROM friend_requests[\s\S]*?status = 'accepted'/);
    expect(helper).toMatch(/visibility IS NULL AND EXISTS[\s\S]*?FROM follows/);
    expect(helper).toMatch(/club_id IS NOT NULL AND l\.visibility IS DISTINCT FROM 'private'[\s\S]*?FROM club_members/);
  });
});

describe('dm_start / dm_send stay in step with sql/2026-11-05-dms.sql', () => {
  for (const name of ['dm_start', 'dm_send']) {
    it(`${name}: verbatim copy with ONLY the existence check changed to visibility`, () => {
      const prior = fnBlock(src, name);
      const now = fnBlock(sql, name);
      expect(prior).toContain(OLD);
      expect(now).toBe(prior.replace(OLD, NEW));
    });
    it(`${name}: the visibility check still runs AFTER block/privacy/state checks (no oracle for refused senders)`, () => {
      const body = fnBlock(sql, name);
      const idx = body.indexOf(NEW);
      expect(idx).toBeGreaterThan(body.indexOf('dm_is_blocked'));
    });
  }
});

describe('grants reset (CREATE OR REPLACE keeps grants, but re-assert like the source file)', () => {
  for (const fn of ['dm_start(uuid, text, text)', 'dm_send(uuid, text, text)']) {
    it(`re-revokes and re-grants ${fn}`, () => {
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated`);
    });
  }
  it('reloads the schema', () => {
    expect(sql).toMatch(/NOTIFY pgrst/);
  });
});
