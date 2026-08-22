// A profile's post grid renders other people's watch images in ~100 px cells.
// An 87-watch profile requested ~80 FULL-SIZE watch images in one second on
// 2026-08-22 and Supabase Storage answered 39 of them with 429. The cells must
// use the 240 px thumb (with the data-full fallback) like the showcase cards.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function fnBody(name) {
  const i = html.indexOf(`function ${name}(`);
  expect(i).toBeGreaterThan(-1);
  const j = html.indexOf('\nfunction ', i + 1);
  return html.slice(i, j);
}

describe('profilePostCellHTML', () => {
  const body = fnBody('profilePostCellHTML');
  it('uses the thumb (with full-size fallback) for the watch image', () => {
    expect(body).toMatch(/<img \$\{thumbSrcAttrs\(w\.image\)\}[^>]*loading="lazy"/);
  });
  it('never requests the full-size watch image directly', () => {
    expect(body).not.toMatch(/src="\$\{escHtml\(w\.image\)\}"/);
  });
});
