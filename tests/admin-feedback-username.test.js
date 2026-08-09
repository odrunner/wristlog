import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// The admin feedback cards showed date/version/browser but never who wrote the
// row, so every submission read as anonymous even though `feedback.user_id` was
// populated. loadAdminFeedback now resolves the handles in one profiles lookup
// and renderFeedbackCard prints them. Guard-rail coverage — the logic is inline
// in index.html with no extractable pure function.
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('Admin feedback submitter handle', () => {
  it('carries user_id through the app_feedback normalization', () => {
    expect(html).toMatch(/user_id:\s*a\.user_id\s*\|\|\s*null/);
  });

  it('resolves handles in a single profiles lookup over distinct ids', () => {
    expect(html).toMatch(/fbUserIds\s*=\s*\[\.\.\.new Set\(_adminFeedbackData\.map\(f => f\.user_id\)\.filter\(Boolean\)\)\]/);
    expect(html).toContain("db.from('profiles').select('id,username').in('id', fbUserIds)");
  });

  it('renders the list even if the handle lookup fails', () => {
    expect(html).toMatch(/feedback username lookup failed/);
  });

  it('prints the handle on the card and escapes it', () => {
    expect(html).toContain('@${escHtml(f._username)}');
  });

  it('distinguishes a truly anonymous row from a deleted account', () => {
    expect(html).toMatch(/f\.user_id \? 'deleted user' : 'anonymous'/);
  });
});
