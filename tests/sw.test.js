import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock Service Worker globals ──────────────────────────────────────────

let listeners;
let mockCache;
let cacheStore;

function makeResponse(body = 'ok', ok = true) {
  return {
    ok,
    body,
    clone() { return { ...this, _cloned: true }; },
  };
}

function makeRequest(url, opts = {}) {
  return { url, mode: opts.mode || '', method: opts.method || 'GET' };
}

function makeFetchEvent(request) {
  let _response = null;
  return {
    request,
    respondWith(p) { _response = p; },
    waitUntil(p) { return p; },
    get _respondedWith() { return _response; },
  };
}

beforeEach(() => {
  listeners = {};
  cacheStore = {};

  mockCache = {
    addAll: vi.fn(() => Promise.resolve()),
    put: vi.fn((req, res) => { cacheStore[typeof req === 'string' ? req : req.url] = res; return Promise.resolve(); }),
  };

  globalThis.self = {
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: vi.fn(() => Promise.resolve()),
    clients: { claim: vi.fn(() => Promise.resolve()) },
    location: { hostname: 'localhost' },
  };

  globalThis.caches = {
    open: vi.fn(() => Promise.resolve(mockCache)),
    keys: vi.fn(() => Promise.resolve([])),
    delete: vi.fn(() => Promise.resolve(true)),
    match: vi.fn(() => Promise.resolve(undefined)),
  };

  globalThis.fetch = vi.fn(() => Promise.resolve(makeResponse()));

  vi.resetModules();
});

async function loadSW() {
  await import('../sw.js?' + Date.now());
}

// Helper: fire a lifecycle event and await its waitUntil promise
async function fireEvent(name, extraProps = {}) {
  let waitPromise;
  const event = {
    waitUntil: vi.fn(p => { waitPromise = p; }),
    ...extraProps,
  };
  listeners[name](event);
  await waitPromise;
  return event;
}

// ── Install ──────────────────────────────────────────────────────────────

describe('sw.js install', () => {
  it('precaches the expected URLs on install', async () => {
    await loadSW();
    const event = await fireEvent('install');

    expect(event.waitUntil).toHaveBeenCalled();
    expect(globalThis.caches.open).toHaveBeenCalledWith('wristlog-v110');
    expect(mockCache.addAll).toHaveBeenCalledWith(['/', '/index.html', '/manifest.json', '/icon.svg']);
  });

  it('calls skipWaiting after precaching', async () => {
    await loadSW();
    await fireEvent('install');
    expect(globalThis.self.skipWaiting).toHaveBeenCalled();
  });
});

// ── Activate ─────────────────────────────────────────────────────────────

describe('sw.js activate', () => {
  it('deletes old caches and claims clients', async () => {
    globalThis.caches.keys.mockResolvedValue(['wristlog-v109', 'wristlog-v110', 'other-cache']);
    await loadSW();
    await fireEvent('activate');

    expect(globalThis.caches.delete).toHaveBeenCalledWith('wristlog-v109');
    expect(globalThis.caches.delete).toHaveBeenCalledWith('other-cache');
    expect(globalThis.caches.delete).not.toHaveBeenCalledWith('wristlog-v110');
    expect(globalThis.self.clients.claim).toHaveBeenCalled();
  });

  it('does not delete any caches when only current cache exists', async () => {
    globalThis.caches.keys.mockResolvedValue(['wristlog-v110']);
    await loadSW();
    await fireEvent('activate');

    expect(globalThis.caches.delete).not.toHaveBeenCalled();
    expect(globalThis.self.clients.claim).toHaveBeenCalled();
  });
});

// ── Fetch: cross-origin bypass ───────────────────────────────────────────

describe('sw.js fetch — cross-origin', () => {
  it('does not intercept cross-origin requests', async () => {
    await loadSW();
    const req = makeRequest('https://api.supabase.co/rest/v1/watches');
    const event = makeFetchEvent(req);
    listeners.fetch(event);

    expect(event._respondedWith).toBeNull();
  });
});

// ── Fetch: navigation (network-first) ────────────────────────────────────

describe('sw.js fetch — navigation', () => {
  it('returns network response for navigation requests', async () => {
    const networkRes = makeResponse('fresh html');
    globalThis.fetch.mockResolvedValue(networkRes);

    await loadSW();
    const req = makeRequest('http://localhost/index.html', { mode: 'navigate' });
    const event = makeFetchEvent(req);
    listeners.fetch(event);

    const result = await event._respondedWith;
    expect(result).toBe(networkRes);
  });

  it('caches successful navigation responses', async () => {
    const networkRes = makeResponse('fresh');
    globalThis.fetch.mockResolvedValue(networkRes);

    await loadSW();
    const req = makeRequest('http://localhost/index.html', { mode: 'navigate' });
    const event = makeFetchEvent(req);
    listeners.fetch(event);
    await event._respondedWith;

    // Give the background cache.put a tick to complete
    await new Promise(r => setTimeout(r, 10));
    expect(mockCache.put).toHaveBeenCalled();
  });

  it('does not cache non-ok navigation responses', async () => {
    const networkRes = makeResponse('error', false);
    globalThis.fetch.mockResolvedValue(networkRes);

    await loadSW();
    const req = makeRequest('http://localhost/index.html', { mode: 'navigate' });
    const event = makeFetchEvent(req);
    listeners.fetch(event);
    await event._respondedWith;

    await new Promise(r => setTimeout(r, 10));
    expect(mockCache.put).not.toHaveBeenCalled();
  });

  it('falls back to cache when network fails', async () => {
    globalThis.fetch.mockRejectedValue(new Error('offline'));
    const cachedRes = makeResponse('cached html');
    globalThis.caches.match.mockResolvedValue(cachedRes);

    await loadSW();
    const req = makeRequest('http://localhost/index.html', { mode: 'navigate' });
    const event = makeFetchEvent(req);
    listeners.fetch(event);

    const result = await event._respondedWith;
    expect(result).toBe(cachedRes);
  });
});

// ── Fetch: same-origin assets (stale-while-revalidate) ───────────────────

describe('sw.js fetch — same-origin assets', () => {
  it('returns cached response immediately if available', async () => {
    const cachedRes = makeResponse('cached icon');
    globalThis.caches.match.mockResolvedValue(cachedRes);

    await loadSW();
    const req = makeRequest('http://localhost/icon.svg');
    const event = makeFetchEvent(req);
    listeners.fetch(event);

    const result = await event._respondedWith;
    // stale-while-revalidate: returns cached immediately
    expect(result.ok).toBe(true);
    expect(result.body).toBe('cached icon');
  });

  it('falls back to network when no cache exists', async () => {
    globalThis.caches.match.mockResolvedValue(undefined);
    const networkRes = makeResponse('fresh icon');
    globalThis.fetch.mockResolvedValue(networkRes);

    await loadSW();
    const req = makeRequest('http://localhost/icon.svg');
    const event = makeFetchEvent(req);
    listeners.fetch(event);

    const result = await event._respondedWith;
    expect(result).toBe(networkRes);
  });

  it('updates cache in the background for GET requests', async () => {
    globalThis.caches.match.mockResolvedValue(makeResponse('stale'));
    const networkRes = makeResponse('fresh');
    globalThis.fetch.mockResolvedValue(networkRes);

    await loadSW();
    const req = makeRequest('http://localhost/manifest.json');
    const event = makeFetchEvent(req);
    listeners.fetch(event);
    await event._respondedWith;

    // Wait for background revalidation
    await new Promise(r => setTimeout(r, 10));
    expect(mockCache.put).toHaveBeenCalled();
  });

  it('does not cache non-GET responses', async () => {
    globalThis.caches.match.mockResolvedValue(undefined);
    const networkRes = makeResponse('ok');
    globalThis.fetch.mockResolvedValue(networkRes);

    await loadSW();
    const req = makeRequest('http://localhost/api/data', { method: 'POST' });
    const event = makeFetchEvent(req);
    listeners.fetch(event);
    await event._respondedWith;

    await new Promise(r => setTimeout(r, 10));
    expect(mockCache.put).not.toHaveBeenCalled();
  });

  it('returns cached response when network fails', async () => {
    const cachedRes = makeResponse('cached');
    globalThis.caches.match.mockResolvedValue(cachedRes);
    globalThis.fetch.mockRejectedValue(new Error('offline'));

    await loadSW();
    const req = makeRequest('http://localhost/icon.svg');
    const event = makeFetchEvent(req);
    listeners.fetch(event);

    const result = await event._respondedWith;
    // stale-while-revalidate: cached is returned, network fail is caught
    expect(result.ok).toBe(true);
    expect(result.body).toBe('cached');
  });
});
