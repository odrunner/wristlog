// ── Regression: user text must never land in a JS event-handler attribute ────
//
// Guards audit finding S3. escAttr() encodes ' as &#39;, which is correct for an HTML
// attribute but NOT for a JavaScript string inside one: the HTML parser decodes the
// entity back to a quote BEFORE the JS is compiled, so the quote closes the string
// literal and everything after it executes.
//
// Three buttons interpolated a user-controlled name into a handler: Block User, the
// club member menu, and Delete Club. A display name of
//     x'),window.PWNED=1,blockUser('y
// executed as the victim when they pressed the button — and "victim goes to block the
// abusive account" is exactly when that button gets pressed.
//
// The fix passes values through data- attributes (where escAttr IS correct) and reads
// them back via this.dataset, so the value is never parsed as code.
//
// The CSP cannot help here: script-src includes 'unsafe-inline' because the app uses
// inline handlers throughout.

import { test, expect } from '@playwright/test';

const PAYLOAD = "x'),window.PWNED=1,blockUser('y";

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) { return escHtml(s).replace(/'/g, '&#39;'); }

test('the OLD pattern really was exploitable (proves this test can fail)', async ({ page }) => {
  await page.goto('about:blank');
  await page.setContent(
    `<script>window.PWNED=0;function blockUser(){}</script>` +
    `<button id="b" onclick="blockUser('uid','${escAttr(PAYLOAD)}')">block</button>`
  );
  await page.click('#b');
  expect(await page.evaluate(() => window.PWNED)).toBe(1);   // vulnerable, as shipped before
});

test('the NEW pattern is inert — value goes through data- and dataset', async ({ page }) => {
  await page.goto('about:blank');
  await page.setContent(
    `<script>window.PWNED=0;window.seen=null;function blockUser(id,name){window.seen=name;}</script>` +
    `<button id="b" data-uid="uid" data-name="${escAttr(PAYLOAD)}" ` +
    `onclick="blockUser(this.dataset.uid, this.dataset.name)">block</button>`
  );
  await page.click('#b');

  expect(await page.evaluate(() => window.PWNED)).toBe(0);       // nothing executed
  expect(await page.evaluate(() => window.seen)).toBe(PAYLOAD);  // and the name still arrives intact
});

test('no handler attribute in index.html interpolates a name into a JS string', async ({ page }) => {
  const { readFileSync } = await import('fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // on*="...'${ ...display_name/username/name/bio... }'..." — a quoted JS string
  // containing an interpolated user-controlled field.
  const bad = html.match(
    /on[a-z]+="[^"]*'\$\{[^"}]*(display_name|username|club\.name|\bbio\b|caption)[^"}]*\}[^"]*'/g
  ) || [];

  expect(bad, `handler attrs interpolating user text into a JS string:\n${bad.join('\n')}`).toHaveLength(0);
});
