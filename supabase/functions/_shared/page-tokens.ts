// GENERATED from design-system.css by scripts/design-system/export_page_tokens.mjs. Do not edit.
// The share pages and the unsubscribe page cannot load the stylesheet (another origin),
// so this is their copy of the tokens they use. tests/share-page-tokens.test.js fails
// when it is stale.

export const TOKENS_LIGHT = `--bg: #e9edf1; --surface: #ffffff; --surface2: #f1f4f7; --border: #d3d9e1; --gold: #87661a; --gold-lt: #c9a84c; --text: #141a24; --muted: #566070; --danger-text: #b03636; --white: #fff; --radius: 10px; --radius-sm: 6px; --radius-btn: 8px; --radius-pill: 999px; --radius-round: 50%; --space-px: 1px; --space-0-5: .125rem; --space-1: .25rem; --space-1-5: .375rem; --space-2: .5rem; --space-2-5: .625rem; --space-3: .75rem; --space-3-5: .875rem; --space-4: 1rem; --space-5: 1.25rem; --space-6: 1.5rem; --space-8: 2rem; --space-10: 2.5rem; --space-12: 3rem; --space-16: 4rem; --fs-body: .9375rem; --fs-input: 1rem; --fs-xs: .68rem; --fs-sm: .75rem; --fs-base: .82rem; --fs-md: .88rem; --fs-xl: 1.1rem; --fs-2xl: 1.3rem; --fs-3xl: 1.6rem; --fs-4xl: 2.5rem; --fs-display: 2rem; --fw-semibold: 600; --fw-bold: 700; --fw-heavy: 800; --lh-none: 1; --lh-body: 1.55; --ls-snug: .02em; --ls-tight: .04em; --ls-eyebrow: .08em; --ls-wide: .16em; --ls-display: -.02em; --size-px: 1px; --size-6: 24px; --size-9: 36px; --size-10: 40px; --size-18: 72px; --size-20: 80px; --size-85: 340px; --size-105: 420px; --size-130: 520px; --size-max: 9999px; --opacity-dim: .5; --shadow-1: 0 1px 4px rgba(0,0,0,.18); --shadow-3: 0 4px 16px rgba(0,0,0,.25); --dur-fast: .15s; --z-header: 100; --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;`;
export const TOKENS_DARK = `--bg: #0b0b10; --surface: #141419; --surface2: #1c1c25; --border: #272734; --gold: #c9a84c; --gold-lt: #dbbe72; --text: #e6e6f0; --muted: #82829d; --danger-text: var(--danger);`;

/** Both themes, for a page that follows the reader's light/dark setting. */
export const PAGE_TOKENS_CSS = `:root { ${TOKENS_LIGHT} }
    @media (prefers-color-scheme: dark) { :root { ${TOKENS_DARK} } }`;
