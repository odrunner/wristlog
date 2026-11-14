// Languages: collect the app's English strings, build each language file, check both.
//
//   node scripts/i18n.mjs extract    index.html + model-page.js + PAGES -> i18n/en.keys.json (needs Playwright's chromium)
//   node scripts/i18n.mjs build      i18n/<lang>.json -> i18n/<lang>.js, index.html's runtime -> i18n/page.js,
//                                    and stamp their ?v= hashes in index.html and PAGES
//   node scripts/i18n.mjs status     per language: translated / missing / stale counts
//   node scripts/i18n.mjs --check    exit 1 if a built file or its stamp is out of date (unit test runs this)
//
// English is the key (docs/i18n.md). i18n/en.keys.json is the generated list of every
// string the page can translate; i18n/<lang>.json maps English -> translation and is
// the only hand-edited file. A missing entry shows English, so nothing here can break
// an English user: they never download any of it.
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'i18n');
const read = (f) => readFileSync(join(root, f), 'utf8');
const readJson = (f) => JSON.parse(read(f));

export const languages = () => readdirSync(dir).filter((f) => /^[a-z]{2}\.json$/.test(f)).map((f) => f.slice(0, 2));

// A string is worth translating only if it has a word in it ("×", "—", "0" do not).
export const translatable = (s) => /[A-Za-z]{2}/.test(s);

// Literal strings the script hands to tx() or toast(): tx('Saved'), toast("Couldn't save", 'error').
// Template literals count only when they have no ${…}; interpolated text goes through
// tx('… {name} …', { name }) instead.
const CALL_RE = /\b(?:tx|toast)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)\s*[,)]/g;
// toast('Could not save — ' + error.message): the label in front of the dash or colon is
// a key of its own; the page's toastText() translates it and leaves the server's tail.
const PREFIX_RE = /\btoast\(\s*(['"])((?:(?!\1)[^\\\n])+?)\s*(?:[—–]|:)\s*\1\s*\+/g;
export function scriptStrings(src) {
  const out = new Set();
  for (const m of src.matchAll(PREFIX_RE)) if (translatable(m[2])) out.add(m[2]);
  for (const m of src.matchAll(CALL_RE)) {
    const raw = m[1] ?? m[2] ?? m[3];
    let val;
    try { val = Function(`"use strict"; return \`${raw.replace(/`/g, '\\`')}\`;`)(); } catch { continue; }
    if (translatable(val)) out.add(val);
  }
  return out;
}

// Labels the script draws later live inside its HTML templates. The page translates them
// as they land (MutationObserver + i18nLookup), so all the extractor has to do is list
// them: text between tags, the four translated attributes, and UI-looking quoted strings.
// ${…} becomes {0}, {1}… which is also what a number turns into at lookup time, so
// `${n} wears` is found as "{0} wears". A wrong guess here costs a dictionary entry that
// never matches; it cannot change what an English user sees.
const ENT = { amp: '&', nbsp: ' ', middot: '·', rarr: '→', larr: '←', hellip: '…', times: '×', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', check: '✓', bull: '•', quot: '"', apos: "'", lt: '<', gt: '>' };
const decode = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
function holes(src) { // replace each ${ … } (nested braces allowed) with \u0001
  let out = '', i = 0;
  while (i < src.length) {
    if (src[i] === '$' && src[i + 1] === '{') {
      let depth = 1; i += 2;
      while (i < src.length && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
      out += '\u0001';
    } else out += src[i++];
  }
  return out;
}
const number = (s) => { let n = 0; return s.replace(/\u0001|\d+(?:[.,]\d+)*/g, () => `{${n++}}`); };
// \u2026 written as an escape in the source is the character on screen (and its digits are not a number).
const unescape = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
const clean = (s) => number(decode(unescape(s)).replace(/\s+/g, ' ').trim());
const wordy = (s) => /[A-Za-z]{2}/.test(s.replace(/\{\d+\}/g, '')) && !/&\w+;/.test(s);
export function templateStrings(src) {
  const out = new Set();
  // A hole that only picks an ending (${n !== 1 ? 's' : ''}) is written out both ways first,
  // so the list holds "{0} watch" and "{0} watches", never "{0} watch{1}".
  const pick = /\$\{[^{}`]*\?\s*'(\w{0,3})'\s*:\s*'(\w{0,3})'\s*\}/g;
  const variants = [src.replace(pick, '$1'), src.replace(pick, '$2')];
  for (const v of variants) scan(v, out);
  return out;
}
function scan(src, out) {
  const flat = holes(src);
  // Twice: with ${…} collapsed (text around a value), and as written, because collapsing
  // also swallows a template nested inside a ${cond ? `…` : ''}.
  for (const m of [...flat.matchAll(/>([^<>`\n]{2,240})</g), ...src.matchAll(/>([^<>`$\n]{2,240})</g)]) {
    const raw = m[1];
    if (/[=;{}|\\]|&&|\/\/|\b(?:return|const|let|var|function|null|undefined)\b/.test(raw)) continue;
    const k = clean(raw);
    if (wordy(k) && !/' ?\+|\+ ?'/.test(k)) out.add(k);
  }
  for (const m of flat.matchAll(/\b(?:placeholder|aria-label|title|alt)="([^"<>`\n]{2,200})"/g)) {
    const k = clean(m[1]); if (wordy(k)) out.add(k);
  }
  // Short tag-less templates that return a label: `${n}h ago`, `${n} wear${n !== 1 ? 's' : ''}`.
  // A hole that only picks between two endings is expanded into both spellings.
  for (const m of src.matchAll(/`([^`\n<>]{3,120})`/g)) {
    if (!m[1].includes('${') || /[=;|\\]|&&/.test(m[1].replace(/\$\{[^`]*?\}/g, ''))) continue;
    const pick = /\$\{[^{}`]*\?\s*'(\w{0,3})'\s*:\s*'(\w{0,3})'\s*\}/g;
    for (const v of pick.test(m[1]) ? [m[1].replace(pick, '$1'), m[1].replace(pick, '$2')] : [m[1]]) {
      const k = clean(holes(v)); if (wordy(k) && /^[\p{L}\d{]/u.test(k)) out.add(k);
    }
  }
  // Number glued to a unit: mins + 'm ago'.
  for (const m of src.matchAll(/\w\)?\s*\+\s*'([a-z ][^'\\\n<>=]{1,30})'/g)) {
    const k = clean('\u0001' + m[1]); if (wordy(k)) out.add(k);
  }
  // Quoted UI text used in expressions: ${priv ? 'Private' : 'Public'}, label: 'All posts'.
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.){2,90})'|"((?:[^"\\\n]|\\.){2,90})"/g)) {
    const raw = (m[1] ?? m[2]).replace(/\\(['"])/g, '$1');
    if (/[_=<>{}\\\/#@$;[\]|^~]|^\s|\s$/.test(raw) || /\.\w/.test(raw) || /[a-z][A-Z]/.test(raw)) continue;
    if (!/^[A-Z]/.test(raw) || !/[a-z]{2}/.test(raw)) continue;
    if (!/\s/.test(raw) && !/^[A-Z][a-z]{2,}[.!?…:]?$/.test(raw)) continue;
    if (/^(Bearer|Content|Authorization|Accept|Enter|Escape|Arrow\w+|Tab|Backspace|Delete|Shift|Meta|Control|Alt|Inter|Segoe UI|Helvetica|Arial|Roboto|Georgia|Menlo|Monaco|Courier New)\b/.test(raw)) continue;
    out.add(clean(raw));
  }
}

// The walker and tx() exactly as the page runs them, so extraction can never drift from runtime.
export function runtimeSource(html) {
  const m = /\/\/ i18n-runtime:start\n([\s\S]*?)\/\/ i18n-runtime:end/.exec(html);
  if (!m) throw new Error('i18n: runtime markers not found in index.html');
  return m[1];
}

// The other published pages a member passes through (a shared post, a public profile, the
// stub every email button lands on). They load the same dictionary, and the runtime as its
// own generated file, i18n/page.js, only when a language was chosen.
export const PAGES = ['p/index.html', 'profile/index.html', 'open.html'];
export const PAGE_RUNTIME = 'i18n/page.js';

// What index.html does right after its first walk: the MutationObserver that translates
// whatever a script draws later. Taken from the page as written, like the runtime.
export function observerSource(html) {
  const m = /\nif \(window\.WR_I18N\) \{\n  i18nWalk\(document\.body, i18nLookup\);\n([\s\S]*?\n  \}\)\.observe\([^\n]*\);\n)\}\n/.exec(html);
  if (!m) throw new Error('i18n: boot block (walk + MutationObserver) not found in index.html');
  return m[1];
}
// i18n/page.js: index.html's runtime and observer, unchanged, for a page that is not the app.
// It is loaded from <head>, so the observer starts before <body> exists and translates the
// markup as the parser adds it (no English flash); the walk at DOMContentLoaded is the
// safety net. tx(), i18nMine(), i18nWalk() and i18nLookup() are globals, as in the app.
export function pageRuntimeSource(html) {
  return '// Generated from index.html (i18n-runtime block + boot observer) by scripts/i18n.mjs. Do not edit.\n'
    + runtimeSource(html)
    + '(function () {\n  if (!window.WR_I18N) return;\n  i18nWalk.done = i18nWalk.done || new WeakMap();\n'
    + observerSource(html)
    + '  var all = function () { if (document.body) i18nWalk(document.body, i18nLookup); };\n'
    + "  all();\n  document.addEventListener('DOMContentLoaded', all);\n})();\n";
}
// The scripts written into a page (not the ones it loads by src).
export const inlineScripts = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

async function markupStrings(pages, runtime) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    // JavaScript off: only the static markup exists, which is what the walker sees at boot.
    const page = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
    const seen = [];
    for (const html of pages) {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      seen.push(...await page.evaluate((runtime) => {
        const walk = new Function(runtime + '; return i18nWalk;')();
        const seen = [];
        // wholeOnly: a sentence with inline tags is listed once, whole, not also in pieces.
        const collect = (k) => { seen.push(k); };
        collect.wholeOnly = true;
        walk(document.body, collect);
        return seen;
      }, runtime));
    }
    return seen;
  } finally { await browser.close(); }
}

// Email HTML is built in the page too (EMAIL_RANGES in ds-count.mjs); it is sent, not shown,
// and is never translated by the page.
function scriptOnly(script) {
  return script.replace(/<!DOCTYPE html>[\s\S]*?<\/html>/gi, '');
}

// Script files other than index.html whose labels land inside the app.
export const EXTRA_SOURCES = ['model-page.js'];

export async function extract() {
  const html = read('index.html'), pages = PAGES.map(read);
  const keys = new Set((await markupStrings([html, ...pages], runtimeSource(html))).filter(translatable));
  const script = html.slice(html.indexOf('// i18n-runtime:end'));
  for (const s of scriptStrings(script)) keys.add(s);
  for (const s of templateStrings(scriptOnly(script))) keys.add(s);
  // The model page is drawn by its own file, inside the app (#page-model) as well as on /w/.
  for (const f of EXTRA_SOURCES) {
    const src = read(f);
    for (const s of scriptStrings(src)) keys.add(s);
    for (const s of templateStrings(src)) keys.add(s);
  }
  for (const p of pages) {
    const src = inlineScripts(p);
    for (const s of scriptStrings(src)) keys.add(s);
    for (const s of templateStrings(src)) keys.add(s);
  }
  // Labels no pattern above can see (lower-case list values and the like), added by hand.
  for (const s of readJson('i18n/extra.keys.json')) keys.add(s);
  return [...keys].sort((a, b) => a.localeCompare(b, 'en'));
}

export const builtSource = (lang, dict) =>
  `// Generated from i18n/${lang}.json by scripts/i18n.mjs. Do not edit.\nwindow.WR_I18N=${JSON.stringify({ lang, dict })};\n`;
export const hashOf = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);
const stampRe = (lang) => new RegExp(`(['"])i18n/${lang}\\.js(?:\\?v=[0-9a-f]*)?\\1`);
export const stamp = (html, lang, hash) => html.replace(stampRe(lang), (_, q) => `${q}i18n/${lang}.js?v=${hash}${q}`);

// Entries whose key the page no longer has are dropped from the built file (dead weight),
// but kept in the .json so a reworded string's old translation is there to copy from.
export function liveDict(lang, keys = readJson('i18n/en.keys.json')) {
  const all = readJson(`i18n/${lang}.json`), live = {};
  for (const k of keys) if (typeof all[k] === 'string' && all[k] && all[k] !== k) live[k] = all[k];
  return live;
}

export function status(lang) {
  const keys = readJson('i18n/en.keys.json'), all = readJson(`i18n/${lang}.json`);
  const have = new Set(Object.keys(all));
  return {
    lang, total: keys.length,
    missing: keys.filter((k) => !have.has(k)),
    stale: [...have].filter((k) => !keys.includes(k)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === 'extract') {
    const keys = await extract();
    writeFileSync(join(dir, 'en.keys.json'), JSON.stringify(keys, null, 1) + '\n');
    console.log(`i18n/en.keys.json: ${keys.length} strings`);
  } else if (cmd === 'build' || cmd === '--check') {
    const check = cmd === '--check'; let stale = 0;
    // Every generated file, then its hash into every page that loads it.
    const built = languages().map((lang) => ({ name: lang, file: `i18n/${lang}.js`, src: builtSource(lang, liveDict(lang)), into: ['index.html', ...PAGES] }));
    built.push({ name: 'page', file: PAGE_RUNTIME, src: pageRuntimeSource(read('index.html')), into: PAGES });
    const htmls = Object.fromEntries(['index.html', ...PAGES].map((f) => [f, read(f)]));
    for (const b of built) {
      let current = ''; try { current = read(b.file); } catch {}
      if (current !== b.src) { stale++; if (check) console.log(`stale: ${b.file}`); else writeFileSync(join(root, b.file), b.src); }
      for (const f of b.into) {
        const stamped = stamp(htmls[f], b.name, hashOf(b.src));
        if (!stamped.includes(`${b.file}?v=${hashOf(b.src)}`)) throw new Error(`i18n: ${f} does not load ${b.file}`);
        if (stamped !== htmls[f]) { stale++; if (check) console.log(`stale: ${f} stamp for ${b.file}`); htmls[f] = stamped; }
      }
    }
    // Re-read right before writing: only the stamps are ours, and only a changed file is written.
    if (!check) for (const f in htmls) if (htmls[f] !== read(f)) writeFileSync(join(root, f), htmls[f]);
    console.log(stale ? (check ? 'out of date — run: node scripts/i18n.mjs build' : 'built') : 'up to date');
    if (check && stale) process.exit(1);
  } else if (cmd === 'status') {
    for (const lang of languages()) {
      const s = status(lang);
      console.log(`${lang}: ${s.total - s.missing.length}/${s.total} translated, ${s.missing.length} missing, ${s.stale.length} no longer on the page`);
      if (process.argv.includes('--missing')) console.log(JSON.stringify(s.missing, null, 1));
    }
  } else {
    console.log('usage: node scripts/i18n.mjs extract | build | status [--missing] | --check');
    process.exit(1);
  }
}
