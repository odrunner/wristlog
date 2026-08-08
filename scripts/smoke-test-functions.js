#!/usr/bin/env node
// Smoke test for deployed Supabase edge functions.
// Hits each function with a real request and checks the response status.
// Usage: node scripts/smoke-test-functions.js

const SUPABASE_URL = 'https://api.wrotate.com';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs';
const TEST_EMAIL = 'test@wrotate.com';
const TEST_PASS = 'wrotate-test-2026';

// 1x1 white PNG for identify-watch test
const TINY_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    const result = await fn();
    if (result.ok) {
      console.log(`  ✓ ${name} — ${result.status} (${result.ms}ms)`);
      passed++;
    } else {
      console.error(`  ✗ ${name} — ${result.status} ${result.body?.slice(0, 120) || ''}`);
      failed++;
    }
  } catch (err) {
    console.error(`  ✗ ${name} — ${err.message}`);
    failed++;
  }
}

// expectStatus asserts a specific status instead of any 2xx — used for the paths
// whose CORRECT behaviour is a rejection (403 on a not-owned watch, 400 on a
// missing id). Without it a silently-removed guard would still read as "passing".
async function callFn(path, opts = {}, expectStatus = null) {
  const start = Date.now();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, opts);
  const ms = Date.now() - start;
  const body = await resp.text();
  const ok = expectStatus === null ? resp.ok : resp.status === expectStatus;
  return { ok, status: resp.status, ms, body };
}

async function getAuthToken() {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Auth failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function run() {
  console.log('\nSmoke testing deployed edge functions...\n');

  // Get auth token for authenticated endpoints
  let token;
  try {
    token = await getAuthToken();
    console.log('  ✓ Auth — got test user token\n');
  } catch (err) {
    console.error('  ✗ Auth — ' + err.message);
    console.error('\nCannot continue without auth token.\n');
    process.exit(1);
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    apikey: ANON_KEY,
  };

  // --- Public functions (no auth needed) ---

  await check('share-collection (public)', () =>
    callFn('share-collection?u=testuser2')
  );

  await check('share-post (no id → 400)', async () => {
    const r = await callFn('share-post?id=');
    // 400 is expected (no post id), proves function is running
    return { ...r, ok: r.status === 400 };
  });

  await check('share-recap (public)', () =>
    callFn('share-recap?u=testuser2&m=2026-07')
  );

  // The month comes from a URL anyone can edit, so a malformed one must be
  // refused rather than reaching the date filters.
  await check('share-recap (bad month → 400)', async () => {
    const r = await callFn('share-recap?u=testuser2&m=nope');
    return { ...r, ok: r.status === 400 };
  });

  // A link preview whose image 404s renders as a grey box, so image mode
  // answers with an SVG even for a request that has no recap behind it.
  await check('share-recap (og image is always an SVG)', async () => {
    const r = await callFn('share-recap?u=nosuchuser&m=2026-07&img=1');
    return { ...r, ok: r.status === 200 && r.body.trimStart().startsWith('<svg') };
  });

  // --- Authenticated functions ---

  await check('identify-watch (auth + tiny image)', () =>
    callFn('identify-watch', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ image: TINY_IMAGE }),
    })
  );

  // Facts mode only generates for a watch the caller owns (2026-07-25 audit S3).
  // A brand/model the test user cannot own must be rejected BEFORE any Gemini call,
  // so this costs nothing to run.
  await check('identify-watch facts (not-owned watch → 403)', () =>
    callFn('identify-watch', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        mode: 'facts',
        watchInfo: { brand: 'ZZ-Not-A-Real-Brand', model: 'zz-not-owned-model' },
      }),
    }, 403)
  );

  await check('search-watch-image (auth)', () =>
    callFn('search-watch-image', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ query: 'Rolex Submariner', brand: 'Rolex', model: 'Submariner' }),
    })
  );

  await check('extract-url-meta (auth, non-admin → 403)', async () => {
    const r = await callFn('extract-url-meta', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ url: 'https://wrotate.com' }),
    });
    // 403 is expected — test user is not admin. Proves function runs & auth works.
    return { ...r, ok: r.status === 403 };
  });

  // Email transport. `quota_only` is a read-only introspection call — it sends
  // nothing — and reports which provider _shared/mailer.ts actually resolved from
  // the EMAIL_PROVIDER secret. That is the only way to know the live provider
  // without grepping a deployed bundle, and a wrong flip is otherwise silent
  // until real mail goes out. Needs the cron secret, so export it to get the full
  // assertion: CAMPAIGN_TRIGGER_SECRET=… npm run test:smoke
  const cronSecret = process.env.CAMPAIGN_TRIGGER_SECRET;
  if (cronSecret) {
    await check('send-broadcast (quota_only → provider is ses)', async () => {
      const r = await callFn('send-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-campaign-secret': cronSecret },
        body: JSON.stringify({ drain: true, quota_only: true }),
      });
      if (!r.ok) return r;
      let provider = null;
      try { provider = JSON.parse(r.body).provider; } catch { /* fall through */ }
      return { ...r, ok: provider === 'ses', body: `provider=${provider}` };
    });
  } else {
    // Without the secret we can still prove the function is deployed and its auth
    // gate works — the drain falls through to the admin-JWT check, which answers
    // 403 with no token. That beats skipping silently.
    await check('send-broadcast (no secret → 403)', () =>
      callFn('send-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drain: true, quota_only: true }),
      }, 403)
    );
    console.log('    ↳ set CAMPAIGN_TRIGGER_SECRET to also assert the live provider');
  }

  // --- Summary ---
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
