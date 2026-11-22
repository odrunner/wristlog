import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Onboarding email buttons open the screen the email is about (2026-11-22):
// email_campaigns.cta_action -> &go=<key> on the /open link -> the page's
// PROMO_ACTIONS registry. Four places must agree on the key's shape and on
// which keys exist; behaviour is covered by e2e/email-go-link.mock.spec.js,
// run-campaign/lib.test.ts and android GoLinkTest.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const html = read('index.html');
const sql = read('sql', '2026-11-22-campaign-cta-action.sql');
const SHAPE = '^[a-z_]{1,40}$';

const registry = html.slice(html.indexOf('const PROMO_ACTIONS = {'), html.indexOf('};', html.indexOf('const PROMO_ACTIONS = {')));
const known = [...registry.matchAll(/^\s+(open_[a-z_]+):/gm)].map(m => m[1]);

describe('email go link', () => {
  it('every key the SQL assigns to a drip exists in the app registry', () => {
    const assigned = [...sql.matchAll(/'(open_[a-z_]+)'\)/g)].map(m => m[1]);
    expect(assigned.length).toBe(9);
    expect(known.length).toBeGreaterThan(5);
    for (const k of assigned) expect(known, k).toContain(k);
  });

  it('the key shape is the same in the database, the email function and both shells', () => {
    expect(sql).toContain(`cta_action ~ '${SHAPE}'`);
    expect(read('supabase', 'functions', '_shared', 'campaign-slug.ts')).toContain(`/${SHAPE}/.test(k)`);
    expect(read('ios', 'Wrotate', 'Wrotate', 'ContentView.swift')).toContain(`Self.matches(go, #"${SHAPE}"#)`);
    expect(read('android', 'app', 'src', 'main', 'kotlin', 'com', 'wrotate', 'app', 'GoLink.kt')).toContain(`Regex("${SHAPE}")`);
  });

  it('the page only ever runs a registry entry, behind the own-property guard', () => {
    const fn = html.slice(html.indexOf('function runGoLink(key) {'), html.indexOf('function maybeRunGoFromLink()'));
    expect(fn).toContain("Object.prototype.hasOwnProperty.call(PROMO_ACTIONS, key)) return false;");
    expect(fn).not.toContain('promoActionFor');   // no url:/feedback: payloads over a link
    expect(html).toContain('maybeRunGoFromLink();\n  maybeOpenFeedbackFromLink();');
    expect(html).toContain('_goLinkReady = false; _goLinkPending = null;');
  });

  it('both shells hand the key to runGoLink and neither splices it unchecked', () => {
    const ios = read('ios', 'Wrotate', 'Wrotate', 'ContentView.swift');
    expect(ios).toContain(`"return (typeof runGoLink === 'function') ? runGoLink(k) : null;"`);
    expect(ios).toContain('arguments: ["k": go]');
    expect(read('android', 'app', 'src', 'main', 'kotlin', 'com', 'wrotate', 'app', 'ShellActivity.kt'))
      .toContain('GoLink.parse(data.toString())?.let { pendingGo = it }');
  });

  it('the admin editor saves the setting', () => {
    expect(html).toContain('id="camp-cta-${c.id}"');
    expect(html).toContain("if (ctaEl) update.cta_action = ctaEl.value || null;");
  });
});
