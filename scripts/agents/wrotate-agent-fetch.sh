#!/bin/bash
# Host-pinned HTTP fetch for the weekly agents.
# Deployed copy: ~/.local/bin/wrotate-agent-fetch.sh — after editing, copy it:
#   cp scripts/agents/wrotate-agent-fetch.sh ~/.local/bin/wrotate-agent-fetch.sh
#
# Replaces open `curl -s:*` in the agent allowlist (weekly security report
# 2026-10-19, F1: arbitrary curl was an exfiltration channel for a
# prompt-injected agent). Prefix permission rules cannot pin curl safely:
# curl accepts multiple URLs per command, `https://wrotate.com@evil.com`
# passes a prefix match, and -o writes files. This wrapper takes exactly one
# URL and only on our own hosts.
#
#   usage: wrotate-agent-fetch.sh [-I] [-X POST] [-H 'Header: v']... [-d DATA] URL
set -u

fail() { echo "wrotate-agent-fetch: $1" >&2; exit 1; }

ARGS=(-s --max-time 30)
URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    -I) ARGS+=(-I); shift ;;
    -X) [ "${2:-}" = "POST" ] || fail "-X supports POST only"; ARGS+=(-X POST); shift 2 ;;
    -H) [ -n "${2:-}" ] || fail "-H needs a value"; ARGS+=(-H "$2"); shift 2 ;;
    -d) [ -n "${2:-}" ] || fail "-d needs a value"; ARGS+=(-d "$2"); shift 2 ;;
    -*) fail "flag $1 not allowed (only -I, -X POST, -H, -d)" ;;
    *) [ -z "$URL" ] || fail "exactly one URL per call"; URL="$1"; shift ;;
  esac
done
[ -n "$URL" ] || fail "no URL given"
printf '%s' "$URL" | grep -qE '^https://(wrotate\.com|click\.wrotate\.com|xnzweevzrojmouzhpwzv\.supabase\.co)(/[^[:space:]]*)?$' ||
  fail "URL must be on https://wrotate.com, https://click.wrotate.com or the Supabase project host"

exec curl "${ARGS[@]}" "$URL"
