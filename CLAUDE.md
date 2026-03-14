# WRotate — Project Instructions

## Development Workflow
- **Always test locally first** (localhost:3000) before deploying to production
- **Note the stable commit hash** before making changes (for rollback)
- **Run `npx vitest` before committing** — all tests must pass
- **Bump SW cache version** (`sw.js` → `wristlog-vNN`) on every HTML/JS change
- **Update the test suite** after deployments to cover new/changed behavior

## After Each Working Day
- **Update the Help page** (in-app guide), **landing page**, and **"What's New"** section to reflect changes shipped that day

## Audits
- Run a **security / reliability / usability / performance audit** regularly — run all four categories every time
- Save findings locally in `audit-results/` and keep updating after each audit and after each build that addresses them
- Track what's been fixed vs. what's still open — mark items as FIXED with date when resolved
- Each audit should reference previous findings and note which are new vs. carried forward
- After fixing issues, update the corresponding audit report files to reflect the fix

## Testing & UAT
- **Use test accounts only**: testuser (test@wrotate.com) and testuser2 (test2@wrotate.com) — never James Collins/watchdemo
- **Never post publicly** with test accounts — use private, followers, or close friends visibility only
- **When debugging, debug thoroughly** — reproduce the issue, find root cause, fix it, then verify with UAT across both test accounts
- Both test accounts are mutual close friends and follow each other

## Code Style
- Vanilla JS — no frameworks. Keep it that way.
- Replace browser `confirm()` / `alert()` with custom inline toast UIs
- Don't over-engineer — minimal changes to solve the problem at hand
