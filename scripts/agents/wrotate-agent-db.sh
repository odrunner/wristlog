#!/bin/bash
# Read-only production DB access for the weekly agents.
# Deployed copy: ~/.local/bin/wrotate-agent-db.sh — after editing, copy it:
#   cp scripts/agents/wrotate-agent-db.sh ~/.local/bin/wrotate-agent-db.sh
#
# Replaces direct `npx supabase db query --linked` in the agent allowlist
# (weekly security report 2026-10-19, F1: that path accepted any SQL —
# writes and DDL included — and the management token sat in every agent's
# environment). Layered containment:
#   1. exactly ONE statement (no semicolons), starting with SELECT or WITH
#   2. a keyword blocklist for data-modifying CTEs and side-effect functions
#   3. `SET TRANSACTION READ ONLY` prefixed to the batch — the management
#      API runs the batch as one transaction, so Postgres itself refuses any
#      write that slips past 1–2 (verified 2026-10-22: error 25006)
#   4. SUPABASE_ACCESS_TOKEN is sourced here, in this child process only;
#      the agent runner no longer exports it into agent environments
set -u
SQL="${1:-}"

fail() { echo "wrotate-agent-db: $1" >&2; exit 1; }

[ -n "$SQL" ] || fail 'usage: wrotate-agent-db.sh "SELECT ..." (one read-only statement)'
case "$SQL" in *\;*) fail "one statement only — no semicolons" ;; esac
printf '%s' "$SQL" | grep -qiE '^[[:space:]]*(select|with)\b' ||
  fail "statement must start with SELECT or WITH"
printf '%s' "$SQL" | grep -qiwE 'insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|vacuum|reindex|cluster|lock|set|reset|do|call|execute|listen|notify|refresh|begin|commit|rollback|abort|prepare|deallocate|set_config|pg_sleep|pg_terminate_backend|pg_cancel_backend|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|pg_reload_conf|pg_rotate_logfile' &&
  fail "blocked keyword (writes, DDL, transaction control, side-effect functions). If it only appears inside a string literal, rephrase the literal."

[ -d supabase ] || fail "run from the repo checkout root (no supabase/ directory here)"

# Token for `db query --linked` / `link` — lives only in this process.
[ -f "$HOME/.config/supabase/env" ] && . "$HOME/.config/supabase/env" && export SUPABASE_ACCESS_TOKEN

[ -f supabase/.temp/project-ref ] ||
  npx supabase link --project-ref xnzweevzrojmouzhpwzv >/dev/null 2>&1 ||
  fail "could not link the checkout"

exec npx supabase db query --linked "SET TRANSACTION READ ONLY; $SQL"
