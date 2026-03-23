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

async function callFn(path, opts = {}) {
  const start = Date.now();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, opts);
  const ms = Date.now() - start;
  const body = await resp.text();
  return { ok: resp.ok, status: resp.status, ms, body };
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

  // --- Authenticated functions ---

  await check('identify-watch (auth + tiny image)', () =>
    callFn('identify-watch', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ image: TINY_IMAGE }),
    })
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

  // --- Summary ---
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
