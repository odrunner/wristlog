// Languages: collect the app's English strings, build each language file, check both.
//
//   node scripts/i18n.mjs extract    index.html -> i18n/en.keys.json (needs Playwright's chromium)
//   node scripts/i18n.mjs build      i18n/<lang>.json -> i18n/<lang>.js, and stamp its ?v= hash in index.html
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
export function scriptStrings(src) {
  const out = new Set();
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
  const out = new Set(), flat = holes(src);
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
  return out;
}

// The walker and tx() exactly as the page runs them, so extraction can never drift from runtime.
export function runtimeSource(html) {
  const m = /\/\/ i18n-runtime:start\n([\s\S]*?)\/\/ i18n-runtime:end/.exec(html);
  if (!m) throw new Error('i18n: runtime markers not found in index.html');
  return m[1];
}

async function markupStrings(html) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    // JavaScript off: only the static markup exists, which is what the walker sees at boot.
    const page = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await page.evaluate((runtime) => {
      const walk = new Function(runtime + '; return i18nWalk;')();
      const seen = [];
      walk(document.body, (k) => { seen.push(k); });
      return seen;
    }, runtimeSource(html));
  } finally { await browser.close(); }
}

// Email HTML is built in the page too (EMAIL_RANGES in ds-count.mjs); it is sent, not shown,
// and is never translated by the page.
function scriptOnly(script) {
  return script.replace(/<!DOCTYPE html>[\s\S]*?<\/html>/gi, '');
}

export async function extract() {
  const html = read('index.html');
  const keys = new Set((await markupStrings(html)).filter(translatable));
  const script = html.slice(html.indexOf('// i18n-runtime:end'));
  for (const s of scriptStrings(script)) keys.add(s);
  for (const s of templateStrings(scriptOnly(script))) keys.add(s);
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
    let html = read('index.html');
    for (const lang of languages()) {
      const src = builtSource(lang, liveDict(lang));
      let current = ''; try { current = read(`i18n/${lang}.js`); } catch {}
      if (current !== src) { stale++; if (check) console.log(`stale: i18n/${lang}.js`); else writeFileSync(join(dir, `${lang}.js`), src); }
      const stamped = stamp(html, lang, hashOf(src));
      if (stamped !== html) { stale++; if (check) console.log(`stale: index.html stamp for ${lang}`); html = stamped; }
    }
    if (!check && html !== read('index.html')) writeFileSync(join(root, 'index.html'), html);
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
