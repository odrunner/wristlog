// Test double for window.safeLS (index.html head, audit finding R1).
//
// App code no longer touches localStorage directly — every read/write goes through
// safeLS so a browser that refuses storage degrades instead of killing boot. Tests
// that extract app source and eval it therefore need safeLS in scope rather than a
// bare localStorage stub.

/**
 * Build a safeLS-shaped accessor over a plain object store.
 * @param {object} store backing object; defaults to a fresh one
 */
export function makeSafeLS(store = {}) {
  return {
    available: true,
    store,
    get: (k) => (k in store ? store[k] : null),
    set: (k, v) => { store[k] = String(v); return true; },
    remove: (k) => { delete store[k]; },
  };
}

/** A safeLS that behaves like a browser refusing storage: reads null, writes drop. */
export function makeBlockedSafeLS() {
  return {
    available: false,
    store: {},
    get: () => null,
    set: () => false,
    remove: () => {},
  };
}
