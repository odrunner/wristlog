// Guards sql/2026-11-26-onboarding-drip-rewrite.sql: four onboarding emails rewritten in
// place, and the admin's subject list kept in step with them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-11-26-onboarding-drip-rewrite.sql'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const lib = readFileSync(join(root, 'supabase', 'functions', 'run-campaign', 'lib.ts'), 'utf8');
const updates = sql.split(/\nupdate public\.email_campaigns set/).slice(1);

describe('onboarding drip rewrite', () => {
  it('rewrites exactly four live campaigns, in place, by name', () => {
    expect(updates.length).toBe(4);
    for (const u of updates) expect(u).toMatch(/\nwhere name = '[^']+' and is_active;/);
    expect(sql).not.toMatch(/insert into public\.email_campaigns/i);
    expect(sql).not.toMatch(/backfill_daily|delay_days/);
  });
  it('every new subject is in the admin onboarding list', () => {
    const list = html.slice(html.indexOf('const CAMPAIGN_ONBOARDING = ['), html.indexOf('const CAMPAIGN_DRIP_DAYS'));
    const subjects = updates.map((u) => /subject = '([^']+)'/.exec(u)[1]);
    expect(new Set(subjects).size).toBe(4);
    for (const s of subjects) expect(list).toContain(`'${s}'`);
  });
  it('audiences and button targets are keys the sender and the app know', () => {
    const requires = [...sql.matchAll(/require_state = '([a-z_]+)'/g)].map((m) => m[1]);
    for (const k of requires) expect(lib).toMatch(new RegExp(`\\n  ${k}: \\{ table:`));
    const registry = html.slice(html.indexOf('const PROMO_ACTIONS = {'), html.indexOf('function promoActionFor'));
    const actions = [...sql.matchAll(/cta_action = '([a-z_]+)'/g)].map((m) => m[1]);
    expect(actions.length).toBe(4);
    for (const k of actions) expect(registry).toMatch(new RegExp(`\\n  ${k}:`));
  });
  it('bodies greet by name, sign as the team, carry no emoji and only the {{name}} token', () => {
    for (const u of updates) {
      const body = /body_html = \$b\$([\s\S]*?)\$b\$/.exec(u)[1];
      expect(body.startsWith('Hi {{name}},')).toBe(true);
      expect(body.endsWith('The WRotate team')).toBe(true);
      expect(body.replace('{{name}}', '')).not.toMatch(/\{\{/);
      expect(body).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(body).not.toMatch(/\bI\b|\bmy\b/);
      for (const src of [...body.matchAll(/src="([^"]+)"/g)].map((m) => m[1])) expect(src.startsWith('https://wrotate.com/email-assets/')).toBe(true);
    }
  });
  it('adds the notification metric and two DRAFT experiments (nothing starts by itself)', () => {
    expect(sql).toMatch(/'push_turned_on', 'Turned on real notifications', 'rate', 'feature_events:push_turned_on'/);
    expect(sql).toMatch(/\('push_ask_repeat',[\s\S]*?'draft', 50, 'push_turned_on'/);
    expect(sql).toMatch(/\('msr_retry_coach',[\s\S]*?'draft', 50, 'accuracy_reading_saved'/);
    expect(sql).not.toMatch(/'running'/);
  });
});
