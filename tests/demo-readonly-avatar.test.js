// The demo account (Alex Rivera) could open the file picker and "change" its profile
// photo: uploadProfilePic had no demoGuard, storage had no demo policy so the files
// landed, and the profiles UPDATE was silently blocked (0 rows, no error) so the client
// still showed the new photo and toasted success. Guards both layers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sql = readFileSync(join(root, 'sql', '2026-09-21-demo-readonly-storage.sql'), 'utf8');

function fnBody(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start === -1) return '';
  return html.slice(start, html.indexOf('\n}', start));
}

describe('demo account cannot change its profile photo', () => {
  it('uploadProfilePic and removeProfilePic bail on demoGuard before touching anything', () => {
    for (const name of ['uploadProfilePic', 'removeProfilePic']) {
      const lines = fnBody(name).split('\n');
      expect(lines[1].trim()).toBe('if (demoGuard()) return;');
    }
  });

  it('storage.objects has RESTRICTIVE insert/update/delete policies for the demo uid', () => {
    for (const cmd of ['INSERT', 'UPDATE', 'DELETE']) {
      const re = new RegExp(`CREATE POLICY demo_readonly_storage_${cmd.toLowerCase()} ON storage\\.objects AS RESTRICTIVE FOR ${cmd}[\\s\\S]*?<> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid`);
      expect(sql).toMatch(re);
    }
  });
});
