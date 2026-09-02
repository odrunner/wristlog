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

// The standalone public profile page renders the same collection grid and
// slipped through the 08-22 fix because this test only read index.html
// (2026-09-01 perf audit, CLIENT-N3). Pin the share page too.
describe('profile/index.html watch grid', () => {
  const share = readFileSync(join(root, 'profile', 'index.html'), 'utf8');
  it('uses the thumb (with full-size fallback) for grid watch images', () => {
    expect(share).toMatch(/<img class="watch-card-img" \$\{thumbSrcAttrs\(w\.image, escHtml\)\}[^>]*loading="lazy"/);
  });
  it('never requests the full-size watch image directly', () => {
    expect(share).not.toMatch(/watch-card-img" src="\$\{escHtml\(w\.image\)\}"/);
  });
});

// The model-page hero is a 1500 px original rendered into a 180 px box — the
// page's LCP element (CLIENT-N2). It must go through the Storage render
// transform sized for the box at 2x DPR, keeping the original as data-full
// fallback if the transform errors.
describe('model-page.js hero image', () => {
  const shared = readFileSync(join(root, 'model-page.js'), 'utf8');
  it('routes the hero through heroSrcAttrs (render transform + data-full fallback)', () => {
    expect(shared).toMatch(/<img \$\{heroSrcAttrs\(heroImg\)\}/);
    expect(shared).toContain("'/storage/v1/render/image/public/media/'");
    expect(shared).toContain('width=960&height=360&resize=cover');
    expect(shared).toContain('data-full');
  });
  it('never embeds the raw hero URL as src', () => {
    expect(shared).not.toMatch(/src="\$\{escAttr\(heroImg\)\}"/);
  });
});
