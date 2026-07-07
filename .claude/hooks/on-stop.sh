#!/usr/bin/env bash
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
DASHBOARD_DIR=$(dirname "$(dirname "$SCRIPT_DIR")")

input=$(cat)
sid=$(echo "$input" | jq -r '.session_id // empty')
[ -z "$sid" ] && exit 0

f="$DASHBOARD_DIR/sessions.json"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
existing=$(jq -e '.' "$f" 2>/dev/null || echo '[]')
echo "$existing" | jq \
  --arg id "$sid" \
  --arg ts "$(date -Iseconds)" \
  'map(if .session_id == $id then . + {active: false, ended: $ts} else . end)' \
  > "$tmp" && mv "$tmp" "$f"

node "$DASHBOARD_DIR/build-session-data.mjs" >/dev/null 2>&1
