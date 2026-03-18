// ── E2E Test Helpers ─────────────────────────────────────────────────────
// Shared utilities for both mocked and integration Playwright tests.

/**
 * Mock all Supabase REST and Auth API calls via Playwright route interception.
 * Injects a fake authenticated session so the app boots without real credentials.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {object[]} opts.watches  - Watch rows to return from the API
 * @param {object[]} opts.logs     - Log rows to return
 * @param {object[]} opts.wishlist - Wishlist rows to return
 * @param {object}   opts.user     - Fake user object (id, email, etc.)
 * @param {object}   opts.profile  - Fake profile row (username, display_name, etc.)
 */
export async function mockSupabase(page, opts = {}) {
  const {
    watches = [],
    logs = [],
    wishlist = [],
    user = FAKE_USER,
    profile = FAKE_PROFILE,
  } = opts;

  const fakeSession = {
    access_token: 'fake-token-for-testing',
    refresh_token: 'fake-refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user,
  };

  // ── Auth endpoints ──
  // Build a fake JWT so the Supabase client can parse it
  const b64 = (s) => Buffer.from(s).toString('base64url');
  const fakeJwt = [
    b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    b64(JSON.stringify({
      sub: user.id, email: user.email, aud: 'authenticated',
      role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    })),
    'fakesig',
  ].join('.');
  fakeSession.access_token = fakeJwt;

  await page.route('**/auth/v1/token*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeSession) })
  );

  await page.route('**/auth/v1/user', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
  );

  // ── REST API: watches, logs, wishlist ──
  await page.route('**/rest/v1/watches*', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(watches) });
    }
    // POST/PATCH/DELETE — accept and return empty
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/rest/v1/logs*', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(logs) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/rest/v1/wishlist*', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wishlist) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  // ── Profiles ──
  await page.route('**/rest/v1/profiles*', route => {
    if (route.request().method() === 'GET') {
      // Return single object if Accept header requests it (.single() calls)
      const accept = route.request().headers()['accept'] || '';
      if (accept.includes('vnd.pgrst.object')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([profile]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) });
  });

  // ── Social: friends, follows, likes, comments, notifications ──
  for (const table of ['friend_requests', 'follows', 'likes', 'comments', 'notifications', 'clubs', 'club_members', 'page_visits', 'feed_posts']) {
    await page.route(`**/rest/v1/${table}*`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );
  }

  // ── Supabase Realtime (websocket) — block to prevent connection errors ──
  await page.route('**/realtime/**', route => route.abort());
}

/**
 * Inject a fake Supabase auth session into localStorage so the app's
 * getSession() call succeeds without a real login.
 */
export async function injectSession(page, user = FAKE_USER) {
  const storageKey = 'sb-xnzweevzrojmouzhpwzv-auth-token';
  // Build a minimal valid JWT (header.payload.signature) so the Supabase
  // client's getSession() parses it without error.
  const b64 = (s) => Buffer.from(s).toString('base64url');
  const fakeJwt = [
    b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    b64(JSON.stringify({
      sub: user.id, email: user.email, aud: 'authenticated',
      role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    })),
    'fakesig',
  ].join('.');

  const session = {
    access_token: fakeJwt,
    refresh_token: 'fake-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  };
  await page.addInitScript((args) => {
    localStorage.setItem(args.key, JSON.stringify(args.session));
    // Prevent A/B test redirect to r.html
    localStorage.setItem('ab_landing', 'a');

    // The Supabase JS client's getSession() rejects fake JWTs even when
    // stored in localStorage. Override createClient to patch getSession()
    // and onAuthStateChange() so the app boots with our fake session.
    const origDefineProperty = Object.defineProperty;
    let _patched = false;
    // Watch for the `supabase` global (set by the CDN UMD script) and
    // patch its createClient to inject our fake session.
    const _origCreateClient = null;
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      set(val) {
        // The CDN sets window.supabase = { createClient, ... }
        if (val && val.createClient && !_patched) {
          _patched = true;
          const origCC = val.createClient;
          val.createClient = function() {
            const client = origCC.apply(this, arguments);
            const fakeSessionData = {
              data: {
                session: {
                  access_token: args.session.access_token,
                  refresh_token: args.session.refresh_token,
                  expires_at: args.session.expires_at,
                  expires_in: args.session.expires_in,
                  token_type: 'bearer',
                  user: args.session.user,
                },
              },
              error: null,
            };
            client.auth.getSession = () => Promise.resolve(fakeSessionData);
            client.auth.getUser = () => Promise.resolve({ data: { user: args.session.user }, error: null });
            const origOnAuth = client.auth.onAuthStateChange.bind(client.auth);
            client.auth.onAuthStateChange = (cb) => {
              // Fire INITIAL_SESSION immediately with our fake session
              setTimeout(() => cb('INITIAL_SESSION', fakeSessionData.data.session), 0);
              return origOnAuth(cb);
            };
            return client;
          };
        }
        origDefineProperty(window, 'supabase', { value: val, configurable: true, writable: true });
      },
      get() { return undefined; },
    });
  }, { key: storageKey, session });
}

/**
 * Wait for the app to fully boot (auth screen hidden, nav visible).
 */
export async function waitForAppBoot(page) {
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 10_000 });
  await page.waitForSelector('nav', { state: 'visible', timeout: 5_000 });
}

/**
 * Navigate to an in-app page by clicking its nav button.
 */
export async function navigateTo(page, pageName) {
  await page.click(`nav button[data-page="${pageName}"]`);
  await page.waitForSelector(`#page-${pageName}`, { state: 'visible', timeout: 5_000 });
}

// ── Fixtures ─────────────────────────────────────────────────────────────

export const FAKE_USER = {
  id: 'test-user-id-000',
  email: 'test@wrotate.com',
  aud: 'authenticated',
  role: 'authenticated',
  created_at: '2025-01-01T00:00:00Z',
  app_metadata: { provider: 'email' },
  user_metadata: { full_name: 'Test User' },
};

export const FAKE_PROFILE = {
  id: 'test-user-id-000',
  username: 'testuser',
  display_name: 'Test User',
  avatar_url: null,
  bio: 'Test account',
  profile_privacy: 'public',
  eula_accepted_at: '2025-01-01T00:00:00Z',
  theme_preference: 'light',
};

export const SAMPLE_WATCHES = [
  {
    id: 'watch-001',
    user_id: 'test-user-id-000',
    brand: 'Rolex',
    name: 'Submariner Date',
    ref: '126610LN',
    price: 9150,
    purchase_date: '2024-01-15',
    color: '#1a1a2e',
    image: null,
    url: null,
    tags: ['Dive'],
    straps: [{ id: 'strap-001', label: 'Oyster Bracelet', material: 'Steel', isOn: true }],
    owner: null,
    market_price: 13500,
    market_price_date: '2025-03-01',
    market_price_src: 'WatchCharts',
    watch_charts_url: null,
    price_history: [],
    warranty_expiry: '2029-01-15',
    has_box: true,
    has_papers: true,
    insurance: null,
    insured_value: null,
    insurance_notes: null,
    receipts: [],
    elo_rating: 1050,
    watch_privacy: null,
  },
  {
    id: 'watch-002',
    user_id: 'test-user-id-000',
    brand: 'Omega',
    name: 'Speedmaster Professional',
    ref: '310.30.42.50.01.001',
    price: 6550,
    purchase_date: '2024-06-01',
    color: '#1a1a2e',
    image: null,
    url: null,
    tags: ['Chronograph'],
    straps: [{ id: 'strap-002', label: 'Hesalite Bracelet', material: 'Steel', isOn: true }],
    owner: null,
    market_price: 5800,
    market_price_date: '2025-03-01',
    market_price_src: 'WatchCharts',
    watch_charts_url: null,
    price_history: [],
    warranty_expiry: '2029-06-01',
    has_box: true,
    has_papers: true,
    insurance: null,
    insured_value: null,
    insurance_notes: null,
    receipts: [],
    elo_rating: 980,
    watch_privacy: null,
  },
];

export const SAMPLE_LOGS = [
  {
    id: 'log-001',
    user_id: 'test-user-id-000',
    watch_id: 'watch-001',
    date: '2025-03-15',
    use_case: 'work',
    notes: 'Great lume on the Sub',
    strap_id: 'strap-001',
    photo_url: null,
    visibility: 'public',
    club_id: null,
  },
  {
    id: 'log-002',
    user_id: 'test-user-id-000',
    watch_id: 'watch-002',
    date: '2025-03-14',
    use_case: 'leisure',
    notes: null,
    strap_id: 'strap-002',
    photo_url: null,
    visibility: 'private',
    club_id: null,
  },
];
