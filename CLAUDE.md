# WRotate — Project Instructions

## Environment Setup
- **Claude runs on the Mac Mini** (192.168.1.246) — the user accesses the local dev server from their MacBook Pro, phone, or sometimes directly on the Mac Mini
- The local dev server runs automatically via LaunchAgent (`com.wrotate.devserver.plist`) — it starts on boot and auto-restarts on crash. Logs at `/tmp/wrotate-devserver.log`

## Deployment
- **Production deploys via `git push origin main`** — hosting auto-deploys from the repo (GitHub: odrunner/wristlog)
- **Always test locally first** (http://192.168.1.246:3000 from MacBook Pro/phone, or localhost:3000 on the Mac Mini) before deploying
- **Supabase edge functions** are deployed via `npx supabase functions deploy <name> --no-verify-jwt` — access token is loaded from `~/.config/supabase/env` via `.zshrc`

## Internal Accounts
These accounts are excluded from all external-facing metrics (admin totals, D/D counts, traffic stats). The canonical list lives in the **`internal_accounts` Supabase table** — single source of truth for both client JS and server-side RPCs. To add or remove an internal account, update the table. Never hardcode UUIDs in JS or SQL.

## Development Workflow
- **Note the stable commit hash** before making changes (for rollback)
- **Run tests before committing** — all tests must pass
- **Bump SW cache version** (`sw.js` → `wristlog-vNN`) on every HTML/JS change
- **Update the test suite** after deployments to cover new/changed behavior

## Verify Before Shipping — Mandatory Checklist
Every change must pass these checks before `git push`. No exceptions.

1. **Read the code you're referencing** — never assume column names, table names, or function signatures from memory. Read the actual schema/code first. When writing SQL, verify every table and column exists.
2. **Check RLS** — if querying a Supabase table from client-side JS, verify there's a SELECT policy for the user role. Tables with RLS enabled and no policies (like `rate_limits`) return empty results silently. Use SECURITY DEFINER RPCs to bypass RLS when needed.
3. **Test the actual path** — unit tests verify code correctness, not feature correctness. For data-display features, verify the query returns expected data before deploying. For RPCs, test with `supabase db query` using `set_config('request.jwt.claims', ...)` to simulate auth.
4. **Don't deploy broken code in multiple rounds** — if a feature touches both server (RPC/edge function) and client (JS), verify both work before pushing. One push, not three fix-up pushes.
5. **When the user says data looks wrong, check the data** — don't explain why it's correct. Query the DB, check who's generating the data, cross-reference with what the user sees on screen (like the internal accounts table on the same page).

## Test Commands
Node is installed via Homebrew at `/opt/homebrew/bin` (v25.8.1)

| What | Command | Notes |
|------|---------|-------|
| **Unit tests** (873 tests) | `npm test` | Pure logic, no network. Run before every commit. |
| **E2E mocked** (42 tests) | `npm run test:e2e` | Playwright with mocked Supabase routes. No network needed. |
| **E2E integration** (7 tests) | `npm run test:e2e:int` | Hits real Supabase with test accounts. Requires `dev-config.js`. |
| **E2E all** | `npm run test:e2e:all` | Both mocked + integration. |
| **Full suite** | `npm test && npm run test:e2e` | Unit + mocked E2E. Best pre-commit check. |
| **Smoke test** | `npm run test:smoke` | Hits real deployed edge functions. Run after every `supabase functions deploy`. |

One-time setup for E2E: `npx playwright install chromium`

## Supabase Database
- **Query remote DB**: `npx supabase db query --linked "SQL"`
- **Check table schema before writing SQL**: `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='TABLE_NAME';`
- **Check if a table exists**: `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%keyword%';`
- **Deploy RPCs directly** (migration push doesn't work due to remote-only migrations): use `supabase db query --linked` with the CREATE OR REPLACE FUNCTION statement
- **Test RPCs with auth context**: `SELECT set_config('request.jwt.claims', '{"sub": "UUID"}', true); SELECT function_name();`

## Edge Function Deployment
- **Always deploy with `--no-verify-jwt`** — the functions handle their own auth internally. The Supabase gateway JWT check causes false 401s.
- **Run `npm run test:smoke` after every deploy** to verify functions respond correctly.
- Deploy command: `npx supabase functions deploy <name> --no-verify-jwt`

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

## User Reports & Observations
- **Always assume the user is right first** — never dismiss or skip past observations
- **Always validate with data** — when the user reports something (fewer dots, worse results, broken behavior), query logs, check the DB, read the code. Never say "looks fine" without numbers to back it up
- **Never ignore a user's ask** — if the user asks you to investigate, that is not optional. Do the work before responding
- **Do not speculate without evidence** — pull actual data (tick logs, DB queries, git diffs) before drawing conclusions
- **Don't jump to conclusions** — when investigating a bug, trace the actual code path before offering an explanation. Don't attribute issues to irrelevant factors (e.g. "probably a bot account" when the real issue is a code bug). Follow the logic: read the code, check what conditions are met, find exactly why something did or didn't fire
- **When data looks wrong, question yourself first** — if the user says a number doesn't look right, don't defend the number. Check the source. Cross-reference with what's visible on screen. The user sees the app every day and knows what's normal.

## Nightly Measurement Analysis
- A Python script runs daily at 5am via LaunchAgent (`com.wrotate.nightly-analysis`)
- Source: `scripts/nightly-analysis.py` — queries Supabase for last 24h of timegrapher sessions, parses tick logs, prints a briefing
- Deployed copy: `~/.local/bin/wrotate-nightly-analysis.py` — LaunchAgent runs this copy (macOS TCC blocks LaunchAgent access to `~/Documents/`)
- **After editing `scripts/nightly-analysis.py`, copy it**: `cp scripts/nightly-analysis.py ~/.local/bin/wrotate-nightly-analysis.py`
- Output log: `/tmp/wrotate-nightly-analysis.log`
- When the user asks to "show the daily analysis" or "show the nightly summary", read `/tmp/wrotate-nightly-analysis.log` and present the results
- To run it manually: `python3 scripts/nightly-analysis.py`

## Code Style
- Vanilla JS — no frameworks. Keep it that way.
- Replace browser `confirm()` / `alert()` with custom inline toast UIs
- Don't over-engineer — minimal changes to solve the problem at hand
