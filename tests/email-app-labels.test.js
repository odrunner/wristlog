import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { APP_LABELS, OTHER_LANGS, buildTranslatePrompt } from '../supabase/functions/_shared/translate-lib.ts';

// An email that says "tap Track" must name the tab the way the screen does.
// The email translator gets the app's own labels (APP_LABELS); this keeps that
// copy equal to the app's dictionaries, so a reworded tab cannot drift.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dict = (lang) => JSON.parse(readFileSync(join(root, `i18n/${lang}.json`), 'utf8'));
const NAV = ['Track', 'Feed', 'Collection', 'Measure', 'Watches', 'Stats'];

describe('email translator: app labels match the app', () => {
  for (const lang of OTHER_LANGS) {
    it(`${lang}: every label equals the dictionary's`, () => {
      const d = dict(lang);
      for (const [en, shown] of Object.entries(APP_LABELS[lang])) expect(shown, `${lang} "${en}"`).toBe(d[en] ?? en);
    });
    it(`${lang}: all six tabs and Post are covered and reach the prompt`, () => {
      for (const en of [...NAV, 'Post']) expect(APP_LABELS[lang]).toHaveProperty(en);
      expect(buildTranslatePrompt({ a: 'x' }, lang)).toContain(`Track = ${APP_LABELS[lang].Track}`);
    });
  }
  it('the tab names are the ones in the page', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    for (const en of NAV) expect(html).toMatch(new RegExp(`<button[^>]*data-page="[a-z]+"[^>]*aria-label="${en}"`));
  });
});
