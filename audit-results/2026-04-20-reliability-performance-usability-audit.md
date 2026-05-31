# Reliability / Performance / Usability Audit — WRotate (April 20, 2026)

---

## RELIABILITY

### CRITICAL
| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| R11 | saveEnhanceResult db.update has no try/catch — UI shows success on failure, in-memory state diverges from DB | index.html:16482 | NEW |
| R12 | saveEnhanceResult Save button has no double-click guard | index.html:16476 | NEW |
| R13 | saveEnhanceResult doesn't call markDirty/save() — changes may not sync | index.html:16476-16492 | NEW |
| R14 | saveAllEnhanceResults loop has no try/catch — one failure kills remaining saves | index.html:16494-16505 | NEW |

### HIGH
| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| R15 | "Save All" button has no disable guard — double-click causes duplicate saves | index.html:3798 | NEW |
| R16 | 429 rate limit shows opaque "Failed (429)" — no user-friendly message | index.html:16574 | NEW |
| R17 | closeEnhanceAll during individual saves orphans in-flight operations | index.html:16467-16473 | NEW |
| R18 | Image fetch timeout uses Promise.race without AbortController — hung fetch continues | index.html:16558 | NEW |

### MEDIUM
| # | Finding | Status |
|---|---------|--------|
| R19 | maybeShowNewFeatures sets localStorage before modal shows | NEW |
| R20 | Confirm dialog + modal stacking edge case | NEW |
| R21 | stripCitations called without null check on API data | NEW |
| R22 | _enhanceSaveCount === 2 magic number for review trigger | NEW |
| R23 | renderCollection called per-save in saveAll loop (N repaints) | NEW |

### Priority Fixes
1. R11 — try/catch on db.update, revert state on failure
2. R12 — disable Save button during async operation
3. R14 — try/catch per item in saveAll loop
4. R15 — disable Save All button during operation
5. R13 — call markDirty after successful save

---

## PERFORMANCE

### CRITICAL
| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| P1 | enhance-all makes sequential API calls — 10 watches = 550s worst case | index.html:16547 | NEW |

### HIGH
| # | Finding | File:Line | Status |
|---|---------|-----------|--------|
| P2 | Full DOM wipe + re-render on every feed refresh (innerHTML) | index.html:8258 | Carried |
| P3 | send-broadcast N+1 profile fetches (getUserById per user) | send-broadcast/index.ts:128-139 | NEW |
| P4 | Full localStorage JSON write on every save() — blocks main thread | index.html:10186-10187 | NEW |

### MEDIUM
| # | Finding | Status |
|---|---------|--------|
| P5 | Tick data O(N) iteration per tick (capped at 2000 but still expensive) | Partially Fixed |
| P6 | Profile cache TTL 30s too long | Carried |
| P7 | Public + private feed double-render on login | NEW |
| P8 | querySelectorAll in render loops for event binding (40+ occurrences) | Carried |
| P9 | Image fetching in enhance-all not parallelized | NEW |

### Priority Fixes
1. P1 — Batch 3-5 parallel enhance API calls
2. P4 — Debounce localStorage writes
3. P9 — Fetch all images in parallel upfront
4. P3 — Use listUsers pagination instead of N getUserById calls

---

## USABILITY

### HIGH
| # | Finding | Status |
|---|---------|--------|
| U-ACC-001 | Very small text sizes (.6-.75rem / 9-11px) throughout | NEW |
| U-MOBILE-001 | Touch targets under 44x44px on chips, pills, table actions | NEW |

### MEDIUM (Top Items)
| # | Finding | Status |
|---|---------|--------|
| U-ACC-002 | Missing aria-labels on icon-only buttons | NEW |
| U-ACC-003 | No prefers-reduced-motion support | NEW |
| U-ACC-004 | Non-semantic heading structure (divs instead of h1-h3) | NEW |
| U-ACC-005 | Gold color contrast borderline on dark theme (4.2:1) | NEW |
| U-MOBILE-002 | Keyboard may hide form inputs on iOS | NEW |
| U-MOBILE-003 | Tall modals (88vh) content unreachable on small phones | NEW |
| U-FORM-001 | Required fields lack `required` attr and aria-required | NEW |
| U-FEATURE-001 | Enhance-all lacks progress bar or count ("3 of 12") | NEW |
| U-FEATURE-002 | Auto-scroll interrupts user reading previous card | NEW |
| U-FEATURE-003 | Review prompt 800ms delay may fire after modal closes | NEW |
| U-NAV-001 | Enhance modal Close disabled during processing — user stuck | NEW |
| U-CONSISTENCY-001 | Delete confirmation flows vary across features | NEW |
| U-KEYBOARD-001 | Focus not restored after modal closes | NEW |

### FIXED
- U-ASYNC-001 — Enhance button spinner: already has spinner ✓
- U-ASYNC-002 — Photo identify spinner: FIXED ✓

### Priority Fixes
1. U-MOBILE-001 — Increase touch targets to 44px minimum
2. U-FEATURE-001 — Add progress counter to enhance-all
3. U-NAV-001 — Allow close with warning during enhance processing
4. U-FEATURE-003 — Cancel review prompt timeout on modal close
