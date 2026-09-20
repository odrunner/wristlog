import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Audit 2026-09-20 H7. A replacement photo is uploaded (upsert) to the SAME storage
// path as the one it replaces — wishlist/<uid>/<id>.jpg, clubs/<id>.jpg — and the URLs
// differ only in ?v=. "Delete the old file" therefore deleted the file just uploaded,
// leaving the row pointing at nothing. Both cleanups must compare storage PATHS.
describe('replacing a photo never deletes the file that was just uploaded', () => {
  // The real storagePathFrom, lifted out of index.html so the rule is exercised, not just matched.
  const src = html.slice(html.indexOf('function storagePathFrom(url) {'));
  const storagePathFrom = new Function(src.slice(0, src.indexOf('\n}\n') + 2) + '; return storagePathFrom;')();
  const base = 'https://api.wrotate.com/storage/v1/object/public/media/';

  it('storagePathFrom ignores the ?v= cache-buster, so old and new URL share one path', () => {
    expect(storagePathFrom(base + 'wishlist/u1/w1.jpg?v=1')).toBe('wishlist/u1/w1.jpg');
    expect(storagePathFrom(base + 'wishlist/u1/w1.jpg?v=2')).toBe(storagePathFrom(base + 'wishlist/u1/w1.jpg?v=1'));
    expect(storagePathFrom('https://example.com/x.jpg')).toBeNull();
  });
  it('wishlist edit only deletes the old file when its path differs from the new one', () => {
    expect(html).toContain('if (oldPath && oldPath !== storagePathFrom(data.image)) deleteStorageFile(oldPath);');
  });
  it('club edit only deletes the old file when its path differs from the new one', () => {
    expect(html).toContain('if (oldPath && oldPath !== storagePathFrom(updates.image_url)) deleteStorageFile(oldPath);');
  });
});
