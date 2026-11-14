import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { scriptStrings, templateStrings, runtimeSource, stamp, builtSource, hashOf, liveDict, languages, translatable, EXTRA_SOURCES } from '../scripts/i18n.mjs';

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

describe('i18n: a weekday inside a sentence', () => {
  const dict = { 'Friday': 'Viernes', 'Often on {0}s': 'A menudo los {0}', '{0} is your busiest day of all': '{0} es tu día más activo' };
  const lookup = (lang, d) => new Function('window', runtimeSource(html) + '; return i18nLookup;')({ WR_I18N: { lang, dict: d } });
  it('is lower-case mid-sentence in Spanish', () => expect(lookup('es', dict)('Often on Fridays')).toBe('A menudo los viernes'));
  it('keeps its capital at the start of the sentence', () => expect(lookup('es', dict)('Friday is your busiest day of all')).toBe('Viernes es tu día más activo'));
  it('keeps its capital on its own', () => expect(lookup('es', dict)('Friday')).toBe('Viernes'));
  it('keeps its capital in German', () =>
    expect(lookup('de', { 'Friday': 'Freitag', 'Often on {0}s': 'Oft am {0}' })('Often on Fridays')).toBe('Oft am Freitag'));
});

describe('i18n: fun facts in the reader\'s language', () => {
  const src = /const FACT_COLS = [\s\S]*?\n}\n(?=\/\/ For the paths)/.exec(html)[0];
  const make = (WR_I18N) => new Function('window', 'i18nLang', src + '; return { factTr, FACT_COLS };')(
    { WR_I18N }, () => (WR_I18N ? WR_I18N.lang : 'en'));
  const row = { fact: 'English fact.', translations: { es: 'Dato en español.', it: '' } };
  it('an English reader never asks for translations and always gets the English', () => {
    const { factTr, FACT_COLS } = make(undefined);
    expect(FACT_COLS).toBe('id, fact');
    expect(factTr(row)).toBe('English fact.');
  });
  it('another language gets its translation, or the English until one exists', () => {
    expect(make({ lang: 'es' }).FACT_COLS).toBe('id, fact, translations');
    expect(make({ lang: 'es' }).factTr(row)).toBe('Dato en español.');
    expect(make({ lang: 'it' }).factTr(row)).toBe('English fact.');
    expect(make({ lang: 'de' }).factTr(row)).toBe('English fact.');
    expect(make({ lang: 'de' }).factTr({ fact: 'Only English.' })).toBe('Only English.');
    expect(make({ lang: 'de' }).factTr(null)).toBe('');
  });
});

describe('i18n: an error toast keeps the server message and translates its label', () => {
  const src = /function toastText\(msg\) \{[\s\S]*?\n\}\n/.exec(html)[0];
  const make = (dict) => {
    const window = dict ? { WR_I18N: { dict } } : {};
    return new Function('window', runtimeSource(html) + ';' + src + '; return toastText;')(window);
  };
  const de = make({ 'Could not save': 'Speichern fehlgeschlagen', 'Enhance failed': 'Verbessern fehlgeschlagen', 'Saved': 'Gespeichert' });
  it('translates a whole message that has an entry', () => expect(de('Saved')).toBe('Gespeichert'));
  it('translates the label before a dash and leaves the tail', () =>
    expect(de('Could not save — permission denied for table x')).toBe('Speichern fehlgeschlagen — permission denied for table x'));
  it('does the same before a colon', () => expect(de('Enhance failed: timeout: 30s')).toBe('Verbessern fehlgeschlagen: timeout: 30s'));
  it('leaves a message alone when the label has no entry', () => expect(de('Odd thing — detail')).toBe('Odd thing — detail'));
  it('is a pass-through in English', () => expect(make(null)('Could not save — x')).toBe('Could not save — x'));
});

describe('i18n: the model page', () => {
  const mp = readFileSync(join(root, 'model-page.js'), 'utf8');
  it('is read by the extractor, so its labels reach the dictionary', () => {
    expect(EXTRA_SOURCES).toContain('model-page.js');
    const keys = json('i18n/en.keys.json');
    for (const k of [...scriptStrings(mp)]) expect(keys, k).toContain(k);
    for (const k of ['The story', 'Reference spec', 'I own one']) { expect([...templateStrings(mp)]).toContain(k); expect(keys).toContain(k); }
  });
  it('story text comes in the reader\'s language when the model has it, English otherwise', () => {
    const src = /const MODEL_COLS_EN = [\s\S]*?\n}\n/.exec(html)[0];
    const make = (lang) => new Function('window', 'i18nLang', src + '; return { modelTr, MODEL_COLS };')(lang === 'en' ? {} : { WR_I18N: { lang } }, () => lang);
    const m = { id: 1, description: 'A dive watch.', history: 'Born in 1953.', translations: { de: { description: 'Eine Taucheruhr.', history: ' ' }, fr: {} } };
    expect(make('en').MODEL_COLS).not.toContain('translations');
    expect(make('de').MODEL_COLS).toContain('translations');
    expect(make('en').modelTr(m)).toBe(m);
    expect(make('de').modelTr(m)).toMatchObject({ description: 'Eine Taucheruhr.', history: 'Born in 1953.' });
    expect(make('fr').modelTr(m)).toMatchObject({ description: 'A dive watch.', history: 'Born in 1953.' });
    expect(make('tr').modelTr(m)).toBe(m);
    expect(make('de').modelTr(null)).toBe(null);
  });
});

describe('i18n: What\'s New', () => {
  it('is translated from November 2026 on; only the older notes are skipped', () => {
    expect(html).not.toMatch(/#whats-new-modal,\[data-i18n-skip\]/);
    const modal = /<div id="whats-new-modal"[\s\S]*?closeWhatsNew\(\)">Close/.exec(html)[0];
    const skipAt = modal.indexOf('<div data-i18n-skip>');
    expect(skipAt).toBeGreaterThan(modal.indexOf('>November 2026<'));
    expect(skipAt).toBeLessThan(modal.indexOf('>October 2026<'));
  });
});

describe('i18n: extraction', () => {
  it('lists the label of a toast that carries a server message', () => {
    const got = scriptStrings("toast('Could not save — ' + error.message, 'error'); toast(\"Couldn't delete comment — \" + e.message); toast('Enhance failed: ' + (e?.message || e), 'error'); toast('Fine — whole')");
    expect([...got].sort()).toEqual(['Could not save', "Couldn't delete comment", 'Enhance failed', 'Fine — whole']);
  });
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
