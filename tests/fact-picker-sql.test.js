// Guards the fun-fact picker SQL (sql/2026-08-05-fact-cross-user-desync.sql),
// which is deployed straight to Supabase and so has no runtime test here.
//
// Two invariants keep a second owner of the same watch off the first owner's
// fact. Both were bugs on 2026-08-05:
//   1. pick_watch_fact must select the lowest fact NOBODY has been served, and
//      ask for generation when there is none and the pool is under the cap.
//      The old code served `last_position + 1`, which is 0 for every new user.
//   2. commit_* must append at the END of the pool. The old code appended at
//      the caller's own cursor, so a second owner's generated fact landed on
//      position 0, hit `on conflict do nothing`, and handed back the very fact
//      the generation was meant to replace.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sql = readFileSync(join(root, 'sql', '2026-08-05-fact-cross-user-desync.sql'), 'utf8');

// Body of one `create or replace function public.<name>` block.
const fn = (name) => {
  const i = sql.indexOf(`create or replace function public.${name}`);
  if (i === -1) return '';
  const rest = sql.slice(i + 1);
  const next = rest.indexOf('create or replace function public.');
  return next === -1 ? rest : rest.slice(0, next);
};

describe('fun-fact picker SQL — cross-user desync', () => {
  it('a rollback of the previous live definitions is kept beside it', () => {
    expect(existsSync(join(root, 'sql', '2026-08-05-fact-cross-user-desync.ROLLBACK.sql'))).toBe(true);
  });

  it('pick_watch_fact prefers a fact served to nobody, checking both logs and day claims', () => {
    const body = fn('pick_watch_fact');
    expect(body).toMatch(/select min\(f\.position\) into v_serve/);
    expect(body).toMatch(/not exists \(select 1 from public\.logs l where l\.fact_id = f\.id\)/);
    expect(body).toMatch(/not exists \(select 1 from public\.watch_fact_days d where d\.fact_id = f\.id\)/);
  });

  it('pick_watch_fact generates rather than repeating while the pool is under the cap', () => {
    expect(fn('pick_watch_fact')).toMatch(/if v_serve is null and v_pool < 10 then[\s\S]*?'needs_generation', true/);
  });

  it('pick_watch_fact no longer serves the bare cursor position', () => {
    // `v_next % v_pool` survives ONLY as the at-cap last resort, never as the
    // primary selection — one occurrence, after the two preference passes.
    const body = fn('pick_watch_fact');
    expect(body.match(/v_next % v_pool/g) || []).toHaveLength(1);
    expect(body.indexOf('v_next % v_pool')).toBeGreaterThan(body.indexOf('into v_serve'));
  });

  it('the same-wear-date gate still short-circuits before any selection', () => {
    const body = fn('pick_watch_fact');
    expect(body.indexOf('watch_fact_days')).toBeLessThan(body.indexOf('into v_serve'));
  });

  for (const name of ['commit_watch_fact_srv', 'commit_watch_fact']) {
    it(`${name} appends at the end of the pool, not at the caller's cursor`, () => {
      const body = fn(name);
      expect(body).toMatch(/select coalesce\(max\(position\), -1\) \+ 1 into v_pos/);
      expect(body).toMatch(/values \(v_key, v_pos, left\(trim\(p_fact\), 500\)\)/);
      // The regression: inserting at the caller's own cursor.
      expect(body).not.toMatch(/values \(v_key, v_next,/);
    });

    it(`${name} keeps the 10-facts-per-model cap`, () => {
      expect(fn(name)).toMatch(/exit when v_pos >= 10/);
    });

    it(`${name} retries when a concurrent generation takes the slot`, () => {
      const body = fn(name);
      expect(body).toMatch(/on conflict \(model_key, position\) do nothing\s*\n\s*returning \* into v_fact/);
      expect(body).toMatch(/exit when v_fact\.id is not null/);
    });
  }

  it('peek_watch_fact degrades instead of generating — the login modal cannot generate', () => {
    const body = fn('peek_watch_fact');
    expect(body).toMatch(/select min\(f\.position\) into v_serve/);
    expect(body).not.toMatch(/commit_watch_fact/);
    expect(body).toMatch(/if v_serve is null then\s*\n\s*return json_build_object\('fact_id', null/);
  });

  it('the probe columns are indexed — these run on every wear log', () => {
    expect(sql).toMatch(/create index if not exists logs_fact_id_idx on public\.logs \(fact_id\)/);
  });
});
