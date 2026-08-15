const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  const errs = [], api4xx = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0,160)); });
  p.on('response', async r => {
    if (r.status() >= 400 && (r.url().includes('/rest/v1/') || r.url().includes('/rpc/'))) {
      let body=''; try { body = JSON.stringify(await r.json()).slice(0,180); } catch {}
      api4xx.push(`${r.status()} ${r.url().split('/v1/')[1].split('?')[0]} ${body}`);
    }
  });
  await p.goto('http://localhost:3000/', { waitUntil:'domcontentloaded' });
  await p.waitForSelector('#auth-screen', { state:'visible', timeout:15000 });
  await p.click('#dev-login-wrap button:first-child');
  await p.waitForSelector('#auth-screen', { state:'hidden', timeout:20000 });
  await p.waitForTimeout(4000);
  await p.evaluate(() => document.querySelectorAll('.overlay:not(.hidden)').forEach(o=>o.classList.add('hidden')));

  // Open the composer the way a user does.
  const opened = await p.evaluate(() => {
    if (typeof openNewPost === 'function') { openNewPost(); return true; }
    return false;
  });
  await p.waitForTimeout(1500);
  const state = await p.evaluate(() => {
    const m = document.getElementById('new-post-modal');
    return {
      composerOpen: m ? !m.classList.contains('hidden') : null,
      bodyField: !!document.getElementById('np-body'),
      visibilityDefault: typeof defaultPostVisibility === 'function' ? defaultPostVisibility() : 'n/a',
      myProfileLoaded: !!myProfile,
    };
  });
  console.log('openNewPost callable :', opened);
  console.log('composer state       :', JSON.stringify(state));
  console.log('page/console errors  :', errs.length); errs.slice(0,5).forEach(e=>console.log('   ', e.slice(0,150)));
  console.log('API 4xx              :', api4xx.length); api4xx.slice(0,5).forEach(x=>console.log('   ', x));
  await b.close();
})();
