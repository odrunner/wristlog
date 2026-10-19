#!/bin/bash
# Weekly agent team: growth, security, bugs, usability run in parallel as
# headless `claude -p` sessions, then an overseer consolidates their reports
# into ~/.local/share/wrotate-agents/reports/<date>/overseer.md.
#
# Scheduled by ~/Library/LaunchAgents/com.wrotate.weekly-agents.plist (Mon 7:12am).
# Deployed copy: ~/.local/bin/wrotate-weekly-agents.sh — after editing, copy it:
#   cp scripts/agents/run-weekly-agents.sh ~/.local/bin/wrotate-weekly-agents.sh
#
# launchd + TCC can't read ~/Documents (claude is a native binary without FDA),
# so agents run against a clone at ~/.local/share/wrotate-agents/repo.
# Prompts are NOT in the repo (they contain business strategy; the repo is
# public): they live in ~/.local/share/wrotate-agents/prompts/.
#
# Agents run with a scoped tool allowlist (read/search, report writes, and a
# fixed set of read-only shell commands) — NOT with permissions disabled.
# Everything else a prompt asks for is simply unavailable to them.
set -u

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
WORK="$HOME/.local/share/wrotate-agents"
PROMPTS="$WORK/prompts"
REPO="$WORK/repo"
DATE=$(date +%F)
REPORTS="$WORK/reports/$DATE"
LOG="$HOME/.local/share/wrotate-logs/weekly-agents.log"
CLAUDE="/opt/homebrew/bin/claude"
PROJECT_REF="xnzweevzrojmouzhpwzv" # public (it's in index.html)

# What the headless agents may do. Deliberately scoped:
# - read-only git/npm-test/db-query/curl shell commands
# - web search/fetch for the growth agent's competitor scan
# - file writes only under the reports directory and /private/tmp (throwaway
#   Playwright scripts); no Edit of repo files, no git push, no deploys.
ALLOWED_TOOLS="Read Glob Grep WebSearch WebFetch TodoWrite \
Edit(//$HOME/.local/share/wrotate-agents/reports/**) \
Edit(//private/tmp/**) \
Bash(git log:*) Bash(git show:*) Bash(git diff:*) Bash(git status:*) \
Bash(npm test:*) Bash(npm run test:e2e:*) Bash(npm audit:*) \
Bash(npx supabase db query --linked:*) Bash(npx supabase link:*) \
Bash(npx playwright:*) Bash(node /private/tmp/*) \
Bash(curl -s:*) Bash(curl -sI:*) \
Bash(ls:*) Bash(cat:*) Bash(head:*) Bash(tail:*) Bash(grep:*) Bash(rg:*) \
Bash(mkdir -p /private/tmp/*) Bash(wc:*) Bash(sed -n:*)"

# Same-day guard (like rollout-check): a manual kickstart plus the 7:12
# calendar fire must not produce two runs and two emails. Checked before the
# log redirect so a skipped run can't truncate the real run's log.
if [ -e "$REPORTS/.started" ]; then
  echo "[$(date)] weekly agents: already ran today ($REPORTS) — skipping"
  exit 0
fi
mkdir -p "$REPORTS" "$(dirname "$LOG")"
touch "$REPORTS/.started"
exec >"$LOG" 2>&1 # latest run only, persistent across reboots
echo "[$(date)] weekly agents: start"

# Supabase access token for `db query --linked` (normally loaded by .zshrc)
[ -f "$HOME/.config/supabase/env" ] && . "$HOME/.config/supabase/env" && export SUPABASE_ACCESS_TOKEN

# Claude Code auth for headless runs: launchd can't use the interactive
# session's Keychain OAuth (first unattended run failed 2026-10-19 with
# "OAuth session expired and could not be refreshed"; same Keychain/TCC class
# as the gh CLI finding 2026-09-23). The owner generates a long-lived token
# with `claude setup-token` and saves it as CLAUDE_CODE_OAUTH_TOKEN=... in
# the env file below (chmod 600). Without it the run stops here and emails.
if [ -f "$HOME/.config/wrotate/claude-agent.env" ]; then
  . "$HOME/.config/wrotate/claude-agent.env" && export CLAUDE_CODE_OAUTH_TOKEN
else
  echo "[$(date)] FATAL: no $HOME/.config/wrotate/claude-agent.env (claude setup-token needed)"
  printf 'Weekly agents could not run: headless claude has no auth token.\nRun `claude setup-token` and save it as CLAUDE_CODE_OAUTH_TOKEN=... in ~/.config/wrotate/claude-agent.env\n' |
    python3 "$WORK/send-agent-email.py" "WRotate weekly agents FAILED — $DATE" - || true
  exit 1
fi

# Fresh checkout of the public repo (read-only; agents never push)
if [ -d "$REPO/.git" ]; then
  git -C "$REPO" fetch origin main && git -C "$REPO" reset --hard origin/main
else
  git clone https://github.com/odrunner/wristlog.git "$REPO"
fi
if [ $? -ne 0 ]; then
  echo "[$(date)] FATAL: git clone/update failed"
  exit 1
fi
# Link once so `npx supabase db query --linked` works in this checkout
[ -f "$REPO/supabase/.temp/project-ref" ] ||
  (cd "$REPO" && npx supabase link --project-ref "$PROJECT_REF") || true

run_agent() {
  local name="$1"
  local report="$REPORTS/$name.md"
  sed -e "s|__DATE__|$DATE|g" \
    -e "s|__REPORT__|$report|g" \
    -e "s|__REPORTS_DIR__|$REPORTS|g" \
    -e "s|__REPORTS_ROOT__|$WORK/reports|g" \
    "$PROMPTS/$name.md" >"$REPORTS/.$name.prompt"
  echo "[$(date)] agent $name: start"
  (cd "$REPO" && "$CLAUDE" -p "$(cat "$REPORTS/.$name.prompt")" \
    --allowedTools "$ALLOWED_TOOLS" \
    >"$REPORTS/$name.transcript.txt" 2>&1)
  echo "[$(date)] agent $name: exit=$? report=$([ -s "$report" ] && echo yes || echo MISSING)"
  [ -s "$report" ] ||
    echo "The $name agent finished without writing a report — see its transcript ($REPORTS/$name.transcript.txt)." >"$report"
}

for a in growth security bugs usability; do run_agent "$a" & done
wait

run_agent overseer

# Email the consolidated summary to the owner (approved 2026-10-12).
# A placeholder overseer.md (agent died without writing) is a FAILURE, not a
# summary — 2026-10-19 the auth outage emailed the placeholder as if it were
# the weekly report.
if [ -s "$REPORTS/overseer.md" ] && ! grep -q "finished without writing a report" "$REPORTS/overseer.md"; then
  python3 "$WORK/send-agent-email.py" \
    "WRotate weekly agents — $DATE" "$REPORTS/overseer.md" ||
    echo "[$(date)] WARNING: emailing the overseer report failed"
else
  printf 'The weekly agent run produced no overseer report. Log tail:\n\n%s\n' \
    "$(tail -40 "$LOG" 2>/dev/null)" |
    python3 "$WORK/send-agent-email.py" "WRotate weekly agents FAILED — $DATE" - || true
fi
echo "[$(date)] weekly agents: done — summary at $REPORTS/overseer.md"
