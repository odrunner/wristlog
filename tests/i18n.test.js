import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { scriptStrings, templateStrings, runtimeSource, stamp, builtSource, hashOf, liveDict, languages, translatable, EXTRA_SOURCES, PAGES, PAGE_RUNTIME, pageRuntimeSource, inlineScripts } from '../scripts/i18n.mjs';

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
  it('a context picks its own entry: the follow button is not the list title', () => {
    const c = makeT({ 'Following': 'Takip edilenler', 'Following@btn': 'Takip ediliyor' });
    expect(c('Following')).toBe('Takip edilenler');
    expect(c('Following', null, 'btn')).toBe('Takip ediliyor');
  });
  it('a context with no entry of its own uses the plain one, then English', () => {
    expect(makeT({ 'Following': 'Siguiendo' })('Following', null, 'btn')).toBe('Siguiendo');
    expect(makeT({})('Following', null, 'btn')).toBe('Following');
    expect(makeT(null)('Following', null, 'btn')).toBe('Following');
  });
  it('the follow button never reads as the list of people followed', () => {
    for (const lang of ['tr', 'it', 'fr']) {
      const d = json(`i18n/${lang}.json`);
      expect(d['Following@btn'], lang).toBeTruthy();
      expect(d['Following@btn'], lang).not.toBe(d['Following']);
      // Help tells the member which button to tap; it must be this word.
      const help = Object.entries(d).find(([k]) => k.startsWith('To unfollow, go to their profile'))[1];
      expect(help, lang).toContain(`<strong>${d['Following@btn']}</strong>`);
    }
  });
  it('every follow button in the page asks for the button wording', () => {
    expect(html).not.toMatch(/btn\.textContent = tx\('Following'\);/);
    expect(html).not.toMatch(/confirmUnfollow\([^)]*\)">Following</);
  });
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

// A shared post, a public profile and the stub behind every email button: same dictionary,
// the app's own runtime as a generated file, and nothing at all for an English visitor.
describe('i18n: the pages outside the app', () => {
  const pages = Object.fromEntries(PAGES.map((p) => [p, readFileSync(join(root, p), 'utf8')]));
  const runtime = readFileSync(join(root, PAGE_RUNTIME), 'utf8');
  it('cover the post, the profile and the email landing stub', () => {
    expect(PAGES).toEqual(['p/index.html', 'profile/index.html', 'open.html']);
  });
  for (const p of PAGES) {
    it(`${p}: requests nothing unless a supported language was chosen`, () => {
      const loader = /var FILES = \{[^}]*\};[\s\S]*?document\.write\([^\n]*\n/.exec(pages[p])[0];
      const run = (stored, search = '') => {
        const writes = [], doc = { documentElement: {}, write: (x) => writes.push(x) };
        new Function('localStorage', 'location', 'document', loader)(
          { getItem: () => stored, setItem: (k, v) => { stored = v; } }, { search }, doc);
        return { writes, lang: doc.documentElement.lang };
      };
      for (const none of [null, 'en', 'xx']) expect(run(none)).toEqual({ writes: [], lang: undefined });
      const de = run('de');
      expect(de.lang).toBe('de');
      // Dictionary first, then the runtime that reads it: two blocking scripts, nothing else.
      expect(de.writes).toHaveLength(1);
      expect(de.writes[0]).toMatch(/^<script src=\/i18n\/de\.js\?v=[0-9a-f]{8}><\/script><script src=\/i18n\/page\.js\?v=[0-9a-f]{8}><\/script>$/);
      expect(run(null, '?id=1&lang=it').lang).toBe('it');
    });
    it(`${p}: carries the current hash of every language file and of the runtime`, () => {
      for (const lang of languages()) expect(pages[p]).toContain(`'i18n/${lang}.js?v=${hashOf(readFileSync(join(root, `i18n/${lang}.js`), 'utf8'))}'`);
      expect(pages[p]).toContain(`'${PAGE_RUNTIME}?v=${hashOf(runtime)}'`);
    });
    it(`${p}: its labels are in the dictionary`, () => {
      const keys = json('i18n/en.keys.json'), src = inlineScripts(pages[p]);
      for (const k of [...scriptStrings(src), ...templateStrings(src)]) expect(keys, k).toContain(k);
    });
  }
  it('the runtime file is the app\'s own, generated: never a second copy to maintain', () => {
    expect(runtime).toBe(pageRuntimeSource(html));
    expect(runtime).toContain(runtimeSource(html));
    expect(runtime).toContain('new MutationObserver(');
    // Stale after any change to the runtime in index.html, and --check says so.
    expect(pageRuntimeSource(html.replace('function i18nIsMine(k)', 'function i18nIsMine(k) /* changed */'))).not.toBe(runtime);
  });
  it('the runtime does nothing, and touches nothing, without a dictionary', () => {
    expect(() => new Function('window', 'document', 'MutationObserver', runtime)({}, undefined, undefined)).not.toThrow();
  });
  it('the static labels and the ones scripts draw are extracted', () => {
    const keys = json('i18n/en.keys.json');
    for (const k of ['Loading post…', 'Loading profile…', 'Open App', 'Redirecting to WRotate...', 'Open WRotate', 'Sign in to view this post',
      'Private profile', 'Collection ({0})', '{0} wear', '{0} wears', 'This collection is private. Follow {0} on WRotate to see their watches.',
      'No user found with username "{0}".', 'It may be private, or it may have been removed.']) expect(keys, k).toContain(k);
  });
  it('dates follow the chosen language and stay en-US in English', () => {
    expect(pages['p/index.html']).toContain("toLocaleDateString(I18N || 'en-US'");
    for (const p of PAGES) expect(pages[p].match(/toLocale\w+\('en-US'/g)).toBeNull();
  });
  // What a member wrote goes through escUser() (or mine() inside an attribute or a sentence),
  // never through the plain escape that leaves it open to the translator.
  it('text a member wrote is never handed to the translator', () => {
    const mineFields = /\$\{esc(?:Html)?\((?!mine\()[^`)]*?\b(?:caption|trimmedWatch|memberName|member|profile\.bio|profile\.display_name|w\.brand|w\.name|mostWorn\.\w+|log\.notes)\b/g;
    const hits = (p) => (inlineScripts(pages[p]).match(mineFields) || []);
    expect(hits('p/index.html')).toEqual([]);
    expect(hits('profile/index.html')).toEqual([]);
    // The helpers are plain escapes for an English visitor: no marker, no call into a runtime that is not there.
    for (const [p, esc] of [['p/index.html', 'esc'], ['profile/index.html', 'escHtml']]) {
      const src = inlineScripts(pages[p]);
      const helpers = /const I18N = [\s\S]*?\n    function escUser[^\n]*\n/.exec(src)[0];
      const make = (WR_I18N, seen) => new Function('window', 'i18nMine', esc, helpers + '; return { escUser, mine, I18N };')(
        { WR_I18N }, (x) => { seen.push(x); return x; }, (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'));
      const en = make(undefined, []);
      expect([en.I18N, en.escUser('Steel & <Co>'), en.escUser(''), en.escUser(null), en.mine('Steel')]).toEqual([null, 'Steel &amp; &lt;Co>', '', '', 'Steel']);
      const seen = [], de = make({ lang: 'de' }, seen);
      expect(de.escUser('Steel & <Co>')).toBe('<!--u-->Steel &amp; &lt;Co><!--/u-->');
      expect(de.escUser('')).toBe('');
      expect(de.mine('Leather')).toBe('Leather');
      expect(seen).toEqual(['Steel & <Co>', 'Leather']);
    }
    // The avatar and the @username hold nothing but the member's own letters.
    expect(pages['profile/index.html'].match(/<div class="avatar" data-i18n-skip>/g)).toHaveLength(2);
    expect(pages['profile/index.html'].match(/<div class="username-lbl" data-i18n-skip>/g)).toHaveLength(2);
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
