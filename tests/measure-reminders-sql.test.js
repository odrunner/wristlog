// Guards sql/2026-08-16-measure-reminders.sql (deployed straight to Supabase): who gets a
// re-measure / drift push, and how often.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-08-16-measure-reminders.sql'), 'utf8');
describe('measure_reminder_targets', () => {
  it('push-only, local noon, opted-in, not internal, not suspended', () => {
    expect(sql).toMatch(/device_tokens/);
    expect(sql).toMatch(/= 12/);
    expect(sql).toMatch(/email_prefs->>'reminders'/);
    expect(sql).toMatch(/internal_accounts/);
    expect(sql).toMatch(/is_suspended/);
  });
  it('picks a watch measured 21–60 days ago with no session since, at most one reminder per 30 days', () => {
    expect(sql).toMatch(/interval '21 days'/);
    expect(sql).toMatch(/interval '60 days'/);
    expect(sql).toMatch(/sent_on > \(now\(\) AT TIME ZONE v\.timezone\)::date - 30/);
    expect(sql).toMatch(/measure_reminder_sends/);
  });
  it('prior reading is at least 14 days before the last one', () => {
    expect(sql).toMatch(/interval '14 days'/);
  });
  it('is SECURITY DEFINER and reloads the schema', () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/NOTIFY pgrst/);
  });
});
