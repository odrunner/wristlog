import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// Help page structure guard (2026-11-05). Three help steps were missing their
// closing </div>, so the next step rendered as an extra flex child INSIDE the
// previous one — a squeezed two-column layout on the phone. The document stayed
// balanced because a stray </div> followed, so nothing threw and no other test
// noticed. This walks every <div> in index.html and asserts a .help-step never
// opens inside another .help-step.

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function nestedHelpSteps(src) {
  const re = /<div\b[^>]*>|<\/div>/g;
  const stack = [];
  const offenders = [];
  let m;
  while ((m = re.exec(src))) {
    if (m[0] === '</div>') { stack.pop(); continue; }
    const cls = (m[0].match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/);
    const isStep = cls.includes('help-step');
    if (isStep && stack.some(Boolean)) {
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`index.html:${line}`);
    }
    stack.push(isStep);
  }
  return offenders;
}

describe('Help page markup', () => {
  it('never nests a help-step inside another help-step', () => {
    expect(nestedHelpSteps(html)).toEqual([]);
  });
});
