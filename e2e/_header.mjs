import { chromium } from 'playwright';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';
import fs from 'fs';
const phase = process.env.SHOT_PHASE || 'current';
fs.mkdirSync(`ux-screenshots/${phase}`, { recursive: true });
const b = await chromium.launch();
for (const theme of ['light','dark']) {
  const p = await (await b.newContext({ viewport:{width:412,height:120}, deviceScaleFactor:3 })).newPage();
  await mockSupabase(p, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
  await injectSession(p);
  await p.goto('http://localhost:3000/');
  await waitForAppBoot(p);
  await p.evaluate(t => { if (t==='dark') document.documentElement.setAttribute('data-theme','dark'); else document.documentElement.removeAttribute('data-theme'); }, theme);
  await p.waitForTimeout(600);
  await p.locator('header').first().screenshot({ path: `ux-screenshots/${phase}/${theme}-header.png` });
  console.log('  header', theme);
}
await b.close();
