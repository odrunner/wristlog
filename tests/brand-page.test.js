import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { SITE_FILES } from '../scripts/build-site.mjs';

// The brand page renderer (model-page.js renderBrand), run the way
// scripts/gen-sitemap.mjs runs it for the static /b/<slug>/ pages.
function loadRenderer() {
  const noop = () => {};
  const doc = { addEventListener: noop, getElementById: () => null, createElement: () => ({}), head: { appendChild: noop } };
  const win = {};
  new Function('window', 'document', 'requestAnimationFrame', readFileSync('model-page.js', 'utf8'))(win, doc, noop);
  return win.WRModelPage;
}
const MP = loadRenderer();
const render = (ctx) => { const el = { innerHTML: '', addEventListener: () => {}, querySelector: () => null }; MP.renderBrand(el, ctx, {}); return el.innerHTML; };
const CTX = {
  b: { id: 'b1', brand: 'Tudor <b>', slug: 'tudor', founded: '1926', description: 'A maker.', history: 'One.\n\nTwo.' },
  d: {
    hero: { image: 'https://example.com/h.jpg', credit: 'Photo: x' }, owners: 40,
    accuracy: { n_members: 3, n_sessions: 9, med: -1, members: [-6, -1, 2] },
    models: [
      { id: 'm1', name: 'Black Bay', slug: 'tudor-black-bay', hero_image: 'https://example.com/a.jpg', has_page: true, owners: 9, med: 1.5 },
      { id: 'm2', name: 'Ranger', slug: 'tudor-ranger', hero_image: null, has_page: false, owners: 1, med: null },
    ],
    shots: [], shots_total: 0,
  },
};

describe('brand page renderer', () => {
  it('public: models are real links, to the snapshot when there is one', () => {
    const html = render({ ...CTX, publicMode: true });
    expect(html).toContain('<a class="bp-card" href="/w/tudor-black-bay/">');
    expect(html).toContain('<a class="mp-rel-card" href="/w/?m=tudor-ranger">');
    expect(html).not.toContain('data-bp="back"');
    expect(html).toContain('data-bp="app"');
    expect(html).toContain('Since 1926');
    expect(html).toContain('2 models on WRotate · 40 members own one');
    expect(html).toContain('9 members · +1.5 s/d');
    expect(html).not.toContain('id="bp-shots"');
  });
  it('app: models are buttons, Back is there, no public call to action', () => {
    const html = render({ ...CTX, publicMode: false });
    expect(html).toContain('data-bp="model" data-id="m1"');
    expect(html).toContain('data-bp="back"');
    expect(html).not.toContain('data-bp="app"');
  });
  it('escapes the brand name and hides the accuracy card without data', () => {
    const html = render({ ...CTX, d: { ...CTX.d, accuracy: null }, publicMode: true });
    expect(html).toContain('Tudor &lt;b&gt;');
    expect(html).not.toContain('Tudor <b>');
    expect(html).not.toContain('id="bp-acc"');
  });
  it('a public model page links to its brand page only when told the slug', () => {
    const el = { innerHTML: '', addEventListener: () => {}, querySelector: () => null };
    const base = { m: { id: 'm1', brand: 'Tudor', name: 'Pelagos', slug: 'tudor-pelagos' }, o: { total_owners: 2, visible: [] },
      st: { related: [{ id: 'm2', name: 'Black Bay', slug: 'tudor-black-bay', owners: 3 }] }, facts: [], publicMode: true };
    MP.render(el, { ...base, brandSlug: 'tudor' }, {});
    expect(el.innerHTML).toContain('<a class="mp-link" href="/b/tudor/">All Tudor watches</a>');
    MP.render(el, base, {});
    expect(el.innerHTML).not.toContain('/b/');
  });
});

describe('generated brand pages', () => {
  it('b/ is published', () => { expect(SITE_FILES).toContain('b/'); });
  const dirs = existsSync('b') ? readdirSync('b', { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];
  it('there are brand pages, each in the sitemap', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(25);
    const sm = readFileSync('sitemap.xml', 'utf8');
    for (const d of dirs) expect(sm).toContain(`<loc>https://wrotate.com/b/${d}/</loc>`);
  });
  it('carry no member content: no wrist shots baked in, own canonical', () => {
    for (const d of dirs) {
      const html = readFileSync(`b/${d}/index.html`, 'utf8');
      expect(html).toContain(`<link rel="canonical" href="https://wrotate.com/b/${d}/">`);
      expect(html).not.toContain('id="bp-shots"');
      const data = JSON.parse(html.match(/<script id="bp-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
      expect(data.d.shots).toEqual([]);
      expect(data.b.translations).toBeUndefined();
    }
  });
});
