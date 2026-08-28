// tests/experiments-sql.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, '..', 'sql', '2026-08-28-experiments.sql');
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';

describe('experiments SQL schema', () => {
  it('declares the five tables', () => {
    for (const t of ['experiments', 'experiment_assignments', 'experiment_metrics', 'experiment_decisions', 'user_activity_days']) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`));
    }
  });
  it('seeds the metric registry with the built-ins', () => {
    for (const k of ['log_created', 'watch_added', 'accuracy_reading_saved', 'active_days', 'd7_retained']) {
      expect(sql).toContain(`('${k}'`);
    }
  });
  it('enables RLS on every table', () => {
    for (const t of ['experiments', 'experiment_assignments', 'experiment_metrics', 'experiment_decisions', 'user_activity_days']) {
      expect(sql).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    }
  });
  it('defines get_experiments with hash-based sticky assignment', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION get_experiments\(\)/);
    expect(sql).toContain("hashtext(uid::text || '|' || e.key)");
    expect(sql).toContain('INSERT INTO user_activity_days');
  });
});
