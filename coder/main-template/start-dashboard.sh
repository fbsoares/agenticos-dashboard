#!/usr/bin/env bash
set -euo pipefail

DASHBOARD_DIR="$HOME/dashboard"
LOG_FILE="$HOME/.dashboard-server.log"

if [ ! -d "$DASHBOARD_DIR" ]; then
  echo "Dashboard directory not found at $DASHBOARD_DIR, skipping server start."
  exit 0
fi

if pgrep -f "python3 server.py" >/dev/null 2>&1; then
  echo "Dashboard server already running, skipping."
  exit 0
fi

echo "Starting Dashboard server on port 8765..."
cd "$DASHBOARD_DIR"
nohup python3 server.py >"$LOG_FILE" 2>&1 &
disown
echo "Dashboard server started in background (log: $LOG_FILE)"
