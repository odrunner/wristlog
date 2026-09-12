// Guards sql/2026-09-12-avatar-import-trigger.sql: the provider avatar is copied by the
// auth trigger (the client-side import never ran — the trigger creates the profile first).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-09-12-avatar-import-trigger.sql'), 'utf8');
const schema = readFileSync(join(root, 'sql', 'schema.sql'), 'utf8');
describe('handle_new_user copies the provider picture', () => {
  it('reads avatar_url then picture, accepts https only, inserts avatar_url with the profile', () => {
    expect(sql).toMatch(/nullif\(new\.raw_user_meta_data->>'avatar_url', ''\)/);
    expect(sql).toMatch(/nullif\(new\.raw_user_meta_data->>'picture', ''\)/);
    expect(sql).toMatch(/case when pic ~ '\^https:\/\/' then pic else null end/);
    expect(sql).toMatch(/insert into public\.profiles \(id, username, display_name, theme_preference, default_post_visibility, avatar_url\)/);
  });
  it('keeps the original defaults and the security posture', () => {
    expect(sql).toMatch(/split_part\(new\.email, '@', 1\)/);
    expect(sql).toMatch(/'light',\s*'public'/);
    expect(sql).toMatch(/SECURITY DEFINER/);
  });
  it('backfills only post-2026-08-16 sign-ups without an avatar, never internal accounts', () => {
    expect(sql).toMatch(/p\.created_at > '2026-08-16'/);
    expect(sql).toMatch(/p\.avatar_url IS NULL OR p\.avatar_url = ''/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM internal_accounts ia WHERE ia\.user_id = p\.id\)/);
  });
  it('schema.sql mirror carries the same trigger body', () => {
    expect(schema).toMatch(/default_post_visibility, avatar_url\)/);
    expect(schema).toMatch(/case when pic ~ '\^https:\/\/' then pic else null end/);
  });
});
