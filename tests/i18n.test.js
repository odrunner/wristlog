import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { scriptStrings, runtimeSource, stamp, builtSource, hashOf, liveDict, languages, translatable } from '../scripts/i18n.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const json = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));

// tx() exactly as the page defines it, run against a fake window.
const makeT = (dict) => new Function('window', runtimeSource(html) + '; return tx;')(dict ? { WR_I18N: { dict } } : {});

describe('i18n: English users are untouched', () => {
  it('tx() returns its argument when no dictionary is loaded', () => {
    const t = makeT(null);
    expect(t('Add watch')).toBe('Add watch');
    expect(t('{n} watches', { n: 3 })).toBe('3 watches');
  });
  it('the loader requests nothing unless a supported language was chosen', () => {
    const loader = /var FILES = \{[^}]*\};[\s\S]*?document\.write\([^\n]*\n/.exec(html)[0];
    const run = (stored) => {
      const writes = [];
      new Function('safeLS', 'location', 'document', loader)(
        { get: () => stored, set: () => {} }, { search: '' }, { documentElement: {}, write: (s) => writes.push(s) });
      return writes;
    };
    expect(run(null)).toEqual([]);
    expect(run('en')).toEqual([]);
    expect(run('xx')).toEqual([]);
    expect(run('es')).toHaveLength(1);
  });
  it('no language file is in the service-worker precache', () => {
    expect(readFileSync(join(root, 'sw.js'), 'utf8')).not.toMatch(/i18n\//);
  });
});

describe('i18n: translation lookup', () => {
  const t = makeT({ 'Add watch': 'Añadir reloj', '{n} watches': '{n} relojes', toString: 'x' });
  it('translates a known string and fills placeholders', () => {
    expect(t('Add watch')).toBe('Añadir reloj');
    expect(t('{n} watches', { n: 3 })).toBe('3 relojes');
  });
  it('falls back to English for a missing entry', () => expect(t('Brand new label')).toBe('Brand new label'));
  it('leaves an unknown placeholder visible', () => expect(t('{n} watches', {})).toBe('{n} relojes'));
  it('never resolves an inherited property', () => expect(makeT({})('constructor')).toBe('constructor'));
});

describe('i18n: extraction', () => {
  it('collects literal tx() and toast() strings, skips interpolated and wordless ones', () => {
    const got = scriptStrings("toast('Saved'); x = tx(\"Couldn't save\", v); tx(`Plain`); toast(`Hi ${n}`); tx('—'); t('Local var call'); toast(msg, 'error'); format('Nope')");
    expect([...got].sort()).toEqual(["Couldn't save", 'Plain', 'Saved']);
  });
  it('translatable() needs a word', () => {
    expect(translatable('OK')).toBe(true);
    expect(translatable('× 3')).toBe(false);
  });
  it('stamps the hash into the loader URL only', () => {
    expect(stamp("{ es: 'i18n/es.js?v=00000000' } // i18n/es.json", 'es', 'abcd1234')).toBe("{ es: 'i18n/es.js?v=abcd1234' } // i18n/es.json");
  });
});

describe('i18n: language files', () => {
  const keys = json('i18n/en.keys.json');
  const tags = (s) => (s.match(/<\/?[a-z]+>/gi) || []).map((x) => x.toLowerCase()).sort().join();
  const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  it('built files and their stamps are current (node scripts/i18n.mjs build)', () => {
    expect(() => execFileSync('node', [join(root, 'scripts/i18n.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });
  for (const lang of languages()) {
    const all = json(`i18n/${lang}.json`);
    it(`${lang}: every translation keeps the English tags and {placeholders}`, () => {
      const bad = Object.entries(all).filter(([k, v]) => tags(k) !== tags(v) || holes(k) !== holes(v)).map(([k]) => k);
      expect(bad).toEqual([]);
    });
    it(`${lang}: no emoji`, () => {
      expect(Object.values(all).filter((v) => /\p{Extended_Pictographic}️|[\u{1F300}-\u{1FAFF}]/u.test(v))).toEqual([]);
    });
    it(`${lang}: the built file holds only strings the page still has`, () => {
      const built = readFileSync(join(root, `i18n/${lang}.js`), 'utf8');
      expect(built).toBe(builtSource(lang, liveDict(lang, keys)));
      expect(html).toContain(`i18n/${lang}.js?v=${hashOf(built)}`);
    });
  }
});
