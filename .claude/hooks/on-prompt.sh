#!/usr/bin/env bash
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
DASHBOARD_DIR=$(dirname "$(dirname "$SCRIPT_DIR")")

input=$(cat)
sid=$(echo "$input" | jq -r '.session_id // empty')
cwd=$(echo "$input" | jq -r '.cwd // empty')
transcript=$(echo "$input" | jq -r '.transcript_path // empty')
[ -z "$sid" ] && exit 0

name=$([ -n "$transcript" ] && grep -m1 '"type":"custom-title"' "$transcript" 2>/dev/null | jq -r '.customTitle // empty' || echo '')
rc_url=$([ -n "$transcript" ] && grep -m1 '"subtype":"bridge_status"' "$transcript" 2>/dev/null | jq -r '.url // empty' || echo '')

f="$DASHBOARD_DIR/sessions.json"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
existing=$(jq -e '.' "$f" 2>/dev/null || echo '[]')
echo "$existing" | jq \
  --arg id "$sid" \
  --arg cwd "$cwd" \
  --arg ts "$(date -Iseconds)" \
  --arg name "$name" \
  --arg rc_url "$rc_url" \
  'map(select(.session_id != $id)) + [{session_id: $id, name: $name, cwd: $cwd, last_active: $ts, active: true, rc_url: (if $rc_url != "" then $rc_url else null end)}]' \
  > "$tmp" && mv "$tmp" "$f"

node "$DASHBOARD_DIR/build-session-data.mjs" >/dev/null 2>&1
