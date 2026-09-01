#!/usr/bin/env node
// Download a product packshot THROUGH a real Chrome session (Rolex/Tudor 403
// scripted fetches — Akamai). Loads the product page, picks the first image
// response whose URL matches <regex> (or the largest image if none given),
// re-requests it inside the same browser context and writes the bytes.
// Usage: node fetch_via_chrome.cjs <page_url> <out_file> [url_regex]
// Prints JSON {url, bytes, contentType} or {error}.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [page_url, out, rx] = process.argv.slice(2);
  if (!page_url || !out) { console.log(JSON.stringify({ error: 'usage' })); process.exit(2); }
  const re = rx ? new RegExp(rx, 'i') : null;
  let b;
  try { b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-blink-features=AutomationControlled'] }); }
  catch (e) { b = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] }); }
  const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36', locale: 'en-US', viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const p = await ctx.newPage();
  const seen = [];
  p.on('response', r => { const ct = r.headers()['content-type'] || ''; if (ct.startsWith('image/') && !/svg|icon|logo|sprite/i.test(r.url())) seen.push({ u: r.url(), ct, len: +(r.headers()['content-length'] || 0) }); });
  try {
    await p.goto(page_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(7000);
    let pick = re ? seen.find(s => re.test(s.u)) : null;
    if (!pick && !re) pick = seen.sort((a, b2) => b2.len - a.len)[0];
    if (!pick) { console.log(JSON.stringify({ error: 'no matching image', seen: seen.slice(0, 12).map(s => s.u) })); await b.close(); return; }
    // Rolex + Tudor are Cloudinary: drop the page's transforms, ask for a 1600px JPEG of the same asset.
    let url = pick.u;
    if (/media\.(rolex|tudorwatch)\.com\/image\/upload\//.test(url)) url = url.replace(/\/image\/upload\/.*?\/v1\//, '/image/upload/c_limit,w_1600,f_jpg/v1/').replace(/\?.*$/, '');
    const resp = await ctx.request.get(url, { headers: { Referer: page_url } });
    if (!resp.ok()) { console.log(JSON.stringify({ error: `download ${resp.status()}`, url })); await b.close(); return; }
    const buf = await resp.body();
    fs.writeFileSync(out, buf);
    console.log(JSON.stringify({ url, bytes: buf.length, contentType: resp.headers()['content-type'] }));
  } catch (e) { console.log(JSON.stringify({ error: e.message.slice(0, 200) })); }
  await b.close();
})();
