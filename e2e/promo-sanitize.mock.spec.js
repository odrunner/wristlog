import { test, expect } from '@playwright/test';

// sanitizePromoHtml needs a real DOMParser, so it is tested in Chromium rather
// than vitest (the unit suite runs in Node with no DOM). One page load, many
// table-driven cases — and the real browser parser is the one that actually
// decides whether a bypass works.
const CASES = [
  // [name, input, expected substrings present, expected substrings absent]
  ['strips script with its contents',
    '<p>hi</p><script>alert(1)</script>', ['<p>hi</p>'], ['alert', 'script']],
  ['strips inline event handlers',
    '<img src="https://x.test/a.jpg" onerror="alert(1)">', ['<img'], ['onerror', 'alert']],
  ['drops javascript: hrefs but keeps the text',
    '<a href="javascript:alert(1)">click</a>', ['click'], ['javascript:', 'href']],
  ['drops data: hrefs',
    '<a href="data:text/html,<b>x</b>">click</a>', ['click'], ['data:']],
  ['strips the style attribute',
    '<p style="position:fixed;inset:0">x</p>', ['<p>', 'x'], ['style', 'fixed']],
  ['keeps allowed formatting tags',
    '<b>bold</b> <em>em</em><ul><li>one</li></ul>',
    ['<b>bold</b>', '<em>em</em>', '<li>one</li>'], []],
  ['unwraps unknown tags but keeps their text',
    '<marquee>keep me</marquee>', ['keep me'], ['marquee']],
  ['unwraps unknown nested inside allowed',
    '<p>a <blink>b</blink> c</p>', ['a ', 'b', ' c'], ['blink']],
  ['adds rel and target to external links',
    '<a href="https://example.test/x">go</a>',
    ['rel="noopener noreferrer"', 'target="_blank"', 'https://example.test/x'], []],
  ['survives malformed markup',
    '<p>unclosed <b>bold', ['unclosed', 'bold'], []],
  ['strips svg with its contents',
    '<svg><script>alert(1)</script></svg>ok', ['ok'], ['svg', 'alert']],
  ['strips iframes with their contents',
    '<iframe src="https://evil.test"></iframe>safe', ['safe'], ['iframe', 'evil.test']],
  ['keeps a valid https image',
    '<img src="https://x.test/a.jpg" alt="a">', ['<img', 'https://x.test/a.jpg', 'alt="a"'], []],
  ['drops an image whose src fails sanitizeImageUrl',
    '<img src="javascript:alert(1)">', [], ['javascript:', '<img']],
  ['drops srcset',
    '<img src="https://x.test/a.jpg" srcset="https://evil.test/x 2x">', ['<img'], ['srcset', 'evil.test']],
  ['drops a backslash-escaped href that resolves to an external origin',
    '<a href="/\\evil.test/pwn">click</a>', ['click'], ['href', 'evil.test']],
  ['strips the is attribute so it cannot re-emit as a customized built-in',
    '<span is="evil-el" onclick="x">t</span>', ['t'], ['is=', 'onclick']],
];

test('sanitizePromoHtml — allowlist walker', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate((cases) =>
    cases.map(([name, input]) => [name, window.sanitizePromoHtml(input)]), CASES);

  const failures = [];
  results.forEach(([name, out], i) => {
    const [, , present, absent] = CASES[i];
    for (const s of present) if (!out.includes(s)) failures.push(`${name}: missing ${JSON.stringify(s)} in ${JSON.stringify(out)}`);
    for (const s of absent)  if (out.includes(s))  failures.push(`${name}: leaked ${JSON.stringify(s)} in ${JSON.stringify(out)}`);
  });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('sanitizePromoHtml — a sanitized payload cannot execute', async ({ page }) => {
  await page.goto('/');
  const fired = await page.evaluate(() => {
    window.__xss = false;
    const host = document.createElement('div');
    host.innerHTML = window.sanitizePromoHtml(
      '<img src=x onerror="window.__xss=true"><script>window.__xss=true<\/script>');
    document.body.appendChild(host);
    return new Promise((r) => setTimeout(() => r(window.__xss), 100));
  });
  expect(fired).toBe(false);
});
