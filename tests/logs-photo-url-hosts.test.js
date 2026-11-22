import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// logs.photo_url may only point at WRotate's own storage (weekly security
// review 2026-11-22, F1). The rule is a CHECK made of two patterns; they are
// read out of the SQL file and exercised here so a later edit cannot quietly
// loosen them or lock out a shape the app really writes.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-11-22-logs-photo-url-own-hosts.sql'), 'utf8');
const patterns = [...sql.matchAll(/photo_url ~ '([^']+)'/g)].map(m => new RegExp(m[1]));
const ok = v => patterns.some(re => re.test(v));

const A = 'https://api.wrotate.com/storage/v1/object/public/media/logs/7337041a-710f-40a3-a02e-98021bd0a230/0521f1fd_0.jpg?v=1780589152409';
const B = 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/media/logs/u/x.jpg';

describe('logs_photo_url_own_hosts', () => {
  it('has the single-address and the array pattern, and lets NULL through', () => {
    expect(patterns).toHaveLength(2);
    expect(sql).toContain('photo_url is null');
  });
  it('accepts what the app writes: one address, a video, or a JSON array of up to six', () => {
    expect(ok(A)).toBe(true);
    expect(ok(B)).toBe(true);
    expect(ok(A.replace('.jpg', '.mp4'))).toBe(true);
    expect(ok(JSON.stringify([A, B]))).toBe(true);
    expect(ok(JSON.stringify([A, A, A, A, A, A]))).toBe(true);
  });
  it('refuses any other server, however the address is dressed up', () => {
    for (const bad of [
      'https://evil.example/pixel.gif',
      'http://api.wrotate.com/storage/v1/object/public/media/x.jpg',
      'https://api.wrotate.com.evil.example/storage/v1/object/public/media/x.jpg',
      'https://evil.example/https://api.wrotate.com/storage/v1/object/public/media/x.jpg',
      'https://api.wrotate.com@evil.example/storage/v1/object/public/media/x.jpg',
      'https://api.wrotate.com/storage/v1/object/public/other-bucket/x.jpg',
      'data:image/jpeg;base64,AAAA',
      '',
      JSON.stringify([A, 'https://evil.example/pixel.gif']),
      JSON.stringify(['https://evil.example/pixel.gif']),
      JSON.stringify([A, A, A, A, A, A, A]),
      A + '\nhttps://evil.example/x',
      A + '","https://evil.example/x',
    ]) expect(ok(bad), bad).toBe(false);
  });
  it('the official-account publish refuses a pasted outside address before the database does', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain("if (storedUrl && !storagePathFrom(storedUrl)) {");
  });
});
