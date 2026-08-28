import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('experiments client wiring', () => {
  it('defines experiment() on top of resolveExperiment', () => {
    expect(html).toMatch(/function experiment\(key\)\s*\{[^}]*resolveExperiment\(EXPERIMENTS, _expOverrides\(\), key\)/);
  });
  it('loads experiments after login and clears them on sign-out', () => {
    expect(html).toContain('applyWatchDbFlag();\n  loadExperiments();');
    expect(html).toMatch(/async function signOut\(\) \{[\s\S]*?clearExperiments\(\);/);
  });
  it('mirrors resolveExperiment verbatim', () => {
    const src = readFileSync(join(__dirname, '..', 'wrotate_test.js'), 'utf8');
    const fn = src.match(/export (function resolveExperiment[\s\S]*?\n\})/)[1];
    expect(html).toContain(fn);
  });
  it('has an Experiments admin tab wired to its loader', () => {
    expect(html).toContain('data-tab="experiments"');
    expect(html).toContain('id="admin-tab-experiments"');
    expect(html).toContain("if (tab === 'experiments') loadAdminExperiments();");
    expect(html).toMatch(/async function loadAdminExperiments\(\)[\s\S]*?db\.rpc\('admin_experiments_list'\)/);
  });
  it('mirrors the display helpers verbatim', () => {
    const src = readFileSync(join(__dirname, '..', 'wrotate_test.js'), 'utf8');
    for (const name of ['experimentVerdict', 'experimentSortRank', 'fmtExperimentMetric']) {
      const fn = src.match(new RegExp(`export (function ${name}[\\s\\S]*?\\n\\})`))[1];
      expect(html).toContain(fn);
    }
  });
});
