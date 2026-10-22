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

# What the headless agents may do. Deliberately scoped; tightened 2026-10-22
# (weekly security report 2026-10-19, F1: the old list was escapable — open
# cat/head/tail/sed, open curl as an exfil channel, Edit+node in /private/tmp
# as arbitrary code execution, and a write-capable db query with the
# management token exported into every agent's environment):
# - Read/Edit pinned to the agent work dirs (repo clone + reports)
# - DB only via wrotate-agent-db.sh: one SELECT/WITH statement, forced
#   read-only transaction; the management token never enters agent env
# - HTTP only via wrotate-agent-fetch.sh: one URL, pinned to our own hosts
# - no Playwright and no /private/tmp scripts — write-then-execute was
#   arbitrary code. Live-site checks are HTTP-level now (prompts updated).
# Residual, accepted for now: Glob/Grep are read-only tools Claude Code
# always permits (Grep can surface content outside the Read pin), and
# WebFetch (growth's competitor scan) remains a generic outbound channel.
ALLOWED_TOOLS="Read(//$REPO/**) Read(//$WORK/reports/**) Glob Grep WebSearch WebFetch TodoWrite \
Edit(//$WORK/reports/**) \
Bash(git log:*) Bash(git show:*) Bash(git diff:*) Bash(git status:*) \
Bash(npm test:*) Bash(npm run test:e2e:*) Bash(npm audit:*) \
Bash($HOME/.local/bin/wrotate-agent-db.sh:*) Bash(~/.local/bin/wrotate-agent-db.sh:*) \
Bash($HOME/.local/bin/wrotate-agent-fetch.sh:*) Bash(~/.local/bin/wrotate-agent-fetch.sh:*) \
Bash(ls:*) Bash(wc:*)"

# Allow rules only ADD permission — Read elsewhere stays allowed by default
# (verified 2026-10-22: without these denies an agent could Read
# ~/.config/supabase/env despite the pinned allow rules above). Deny the
# credential directories outright.
DISALLOWED_TOOLS="Read(//$HOME/.config/**) Read(//$HOME/.ssh/**) Read(//$HOME/.aws/**)"

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
# Link once so wrotate-agent-db.sh's `db query --linked` works in this
# checkout. The Supabase token is sourced in this subshell only — agents must
# not inherit it (they reach the DB solely through the read-only wrapper,
# which sources the token itself).
[ -f "$REPO/supabase/.temp/project-ref" ] ||
  (cd "$REPO" && . "$HOME/.config/supabase/env" && export SUPABASE_ACCESS_TOKEN &&
    npx supabase link --project-ref "$PROJECT_REF") || true

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
    --disallowedTools "$DISALLOWED_TOOLS" \
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
