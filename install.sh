#!/usr/bin/env bash
set -e
DASHBOARD_DIR=$(cd "$(dirname "$0")" && pwd)

echo "=== Claude Operative System — install ==="
echo "Dashboard dir: $DASHBOARD_DIR"
echo ""

# 1. Make hooks executable
for f in "$DASHBOARD_DIR/.claude/hooks/"*.sh; do [ -f "$f" ] && chmod +x "$f"; done
echo "✓ Hook scripts marked executable"

# 2. Merge hooks into ~/.claude/settings.json
SETTINGS="$HOME/.claude/settings.json"
existing=$(jq '.' "$SETTINGS" 2>/dev/null || echo '{}')

PROMPT_CMD="$DASHBOARD_DIR/.claude/hooks/on-prompt.sh"
STOP_CMD="$DASHBOARD_DIR/.claude/hooks/on-stop.sh"

has_prompt=$(echo "$existing" | jq --arg cmd "$PROMPT_CMD" \
  '[.hooks.UserPromptSubmit[]?.hooks[]? | select(.command == $cmd)] | length' 2>/dev/null || echo '0')
has_stop=$(echo "$existing" | jq --arg cmd "$STOP_CMD" \
  '[.hooks.Stop[]?.hooks[]? | select(.command == $cmd)] | length' 2>/dev/null || echo '0')

if [ "$has_prompt" = "0" ]; then
  existing=$(echo "$existing" | jq \
    --arg cmd "$PROMPT_CMD" \
    '.hooks.UserPromptSubmit = (.hooks.UserPromptSubmit // []) + [{"hooks": [{"type": "command", "command": $cmd, "async": false}]}]')
  echo "✓ Registered UserPromptSubmit hook"
else
  echo "  UserPromptSubmit hook already registered, skipping"
fi

if [ "$has_stop" = "0" ]; then
  existing=$(echo "$existing" | jq \
    --arg cmd "$STOP_CMD" \
    '.hooks.Stop = (.hooks.Stop // []) + [{"hooks": [{"type": "command", "command": $cmd, "async": false}]}]')
  echo "✓ Registered Stop hook"
else
  echo "  Stop hook already registered, skipping"
fi

mkdir -p "$HOME/.claude"
echo "$existing" | jq '.' > "$SETTINGS"
echo "✓ Updated $SETTINGS"
echo ""

# 3. Copy example config if not present
CONFIG="$DASHBOARD_DIR/dashboard-config.json"
EXAMPLE="$DASHBOARD_DIR/dashboard-config.example.json"
if [ ! -f "$CONFIG" ]; then
  cp "$EXAMPLE" "$CONFIG"
  echo "✓ Created dashboard-config.json from example — edit it to personalise"
else
  echo "  dashboard-config.json already exists, skipping"
fi

# 4. Install git hooks
GIT_DIR="$DASHBOARD_DIR/.git"
if [ -d "$GIT_DIR" ]; then
  POST_MERGE="$GIT_DIR/hooks/post-merge"
  PRE_PUSH="$GIT_DIR/hooks/pre-push"
  SYNC_CALL="\"$DASHBOARD_DIR/sync-skills.sh\" pull"
  STATUS_CALL="\"$DASHBOARD_DIR/sync-skills.sh\" status"

  if [ -f "$POST_MERGE" ]; then
    if ! grep -qF "sync-skills.sh" "$POST_MERGE"; then
      printf '\n%s\n' "$SYNC_CALL" >> "$POST_MERGE"
      echo "✓ Appended sync-skills pull to existing post-merge hook"
    else
      echo "  post-merge already has sync-skills call, skipping"
    fi
  else
    printf '#!/usr/bin/env bash\n%s\n' "$SYNC_CALL" > "$POST_MERGE"
    chmod +x "$POST_MERGE"
    echo "✓ Created .git/hooks/post-merge"
  fi

  if [ -f "$PRE_PUSH" ]; then
    if ! grep -qF "sync-skills.sh" "$PRE_PUSH"; then
      printf '\n%s\n' "$STATUS_CALL" >> "$PRE_PUSH"
      echo "✓ Appended sync-skills status to existing pre-push hook"
    else
      echo "  pre-push already has sync-skills call, skipping"
    fi
  else
    printf '#!/usr/bin/env bash\n%s\n' "$STATUS_CALL" > "$PRE_PUSH"
    chmod +x "$PRE_PUSH"
    echo "✓ Created .git/hooks/pre-push"
  fi
else
  echo "  No .git dir found, skipping git hooks"
fi


# 5. Create venv and install Flask
VENV="$DASHBOARD_DIR/.venv"
if [ ! -f "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
  echo "✓ Created .venv"
fi
"$VENV/bin/pip" install --quiet flask
echo "✓ Flask installed in .venv"

# 6. Install systemd user service
SERVICE_TEMPLATE="$DASHBOARD_DIR/dashboard.service"
SERVICE_DEST="$HOME/.config/systemd/user/dashboard.service"
if [ -f "$SERVICE_TEMPLATE" ]; then
  mkdir -p "$HOME/.config/systemd/user"
  sed "s|{{DASHBOARD_DIR}}|$DASHBOARD_DIR|g" "$SERVICE_TEMPLATE" > "$SERVICE_DEST"
  systemctl --user daemon-reload
  echo "✓ Installed $SERVICE_DEST and reloaded daemon"
else
  echo "  dashboard.service template not found, skipping"
fi

echo ""
echo "=== Done! ==="
echo "  Restart Claude Code to activate session hooks."
echo "  Start dashboard: systemctl --user start dashboard"
echo "  Or run directly: $DASHBOARD_DIR/serve.sh"
