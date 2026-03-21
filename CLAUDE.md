# WRotate — Project Instructions

## Environment Setup
- **Claude runs on the Mac Mini** (192.168.1.246) — the user accesses the local dev server from their MacBook Pro, phone, or sometimes directly on the Mac Mini
- The local dev server runs automatically via LaunchAgent (`com.wrotate.devserver.plist`) — it starts on boot and auto-restarts on crash. Logs at `/tmp/wrotate-devserver.log`

## Deployment
- **Production deploys via `git push origin main`** — hosting auto-deploys from the repo (GitHub: odrunner/wristlog)
- **Always test locally first** (http://192.168.1.246:3000 from MacBook Pro/phone, or localhost:3000 on the Mac Mini) before deploying
- **Supabase edge functions** are deployed separately via `npx supabase functions deploy <name>` (requires `supabase login` first)

## Development Workflow
- **Note the stable commit hash** before making changes (for rollback)
- **Run tests before committing** — all tests must pass
- **Bump SW cache version** (`sw.js` → `wristlog-vNN`) on every HTML/JS change
- **Update the test suite** after deployments to cover new/changed behavior

## Test Commands
Node is installed via Homebrew at `/opt/homebrew/bin` (v25.8.1)

| What | Command | Notes |
|------|---------|-------|
| **Unit tests** (774 tests) | `npm test` | Pure logic, no network. Run before every commit. |
| **E2E mocked** (42 tests) | `npm run test:e2e` | Playwright with mocked Supabase routes. No network needed. |
| **E2E integration** (7 tests) | `npm run test:e2e:int` | Hits real Supabase with test accounts. Requires `dev-config.js`. |
| **E2E all** | `npm run test:e2e:all` | Both mocked + integration. |
| **Full suite** | `npm test && npm run test:e2e` | Unit + mocked E2E. Best pre-commit check. |

One-time setup for E2E: `npx playwright install chromium`

## After Each Working Day
- **Update the Help page** (in-app guide) and **"What's New"** section to reflect changes shipped that day
- **Do not modify the landing page** unless explicitly asked — it has a custom layout with a live public feed and sticky sidebar

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
