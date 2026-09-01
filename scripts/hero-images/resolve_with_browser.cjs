#!/usr/bin/env node
// Headless resolver for client-rendered product pages (Rolex, Cartier, Swatch
// Group…). Prints JSON: { og, ld, imgs:[{src, w, h}] } after the page's JS has
// run, so the Python backfill can pick a packshot where a plain GET shows none.
// Usage: node resolve_with_browser.js <url>
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  if (!url) { console.error('usage: resolve_with_browser.js <url>'); process.exit(2); }
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36' });
  try {
    await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await p.waitForTimeout(1500);
    const out = await p.evaluate(() => {
      const og = document.querySelector('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"]')?.content || null;
      let ld = null;
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try { const stack = [JSON.parse(s.textContent)]; while (stack.length) { const n = stack.pop();
          if (Array.isArray(n)) stack.push(...n); else if (n && typeof n === 'object') {
            if ((n['@type'] === 'Product' || n['@type'] === 'IndividualProduct') && n.image) { const i = n.image; ld = typeof i === 'string' ? i : Array.isArray(i) ? (typeof i[0] === 'string' ? i[0] : i[0]?.url) : i.url; break; }
            stack.push(...Object.values(n)); } } } catch (e) {}
        if (ld) break;
      }
      const imgs = [...document.images].map(i => ({ src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight }))
        .filter(i => i.src && !i.src.startsWith('data:') && i.w >= 400)
        .sort((a, b) => (b.w * b.h) - (a.w * a.h)).slice(0, 12);
      return { og, ld, imgs };
    });
    console.log(JSON.stringify(out));
  } catch (e) { console.log(JSON.stringify({ error: e.message })); }
  await b.close();
})();
