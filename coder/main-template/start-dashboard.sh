#!/usr/bin/env bash
set -euo pipefail

DASHBOARD_DIR="$HOME/dashboard"
LOG_FILE="$HOME/.dashboard-server.log"

if [ ! -d "$DASHBOARD_DIR" ]; then
  echo "Dashboard directory not found at $DASHBOARD_DIR, skipping server start."
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found, skipping server start. Select the Python language to enable it."
  exit 0
fi

VENV="$DASHBOARD_DIR/.venv"
if [ ! -d "$VENV" ]; then
  echo "Creating virtualenv for Dashboard..."
  python3 -m venv "$VENV"
fi

# server.py depends on flask and flasgger, same as install.sh's local setup.
echo "Installing Dashboard dependencies (flask, flasgger)..."
"$VENV/bin/pip" install --quiet flask flasgger

if pgrep -f "$VENV/bin/python .*server.py" >/dev/null 2>&1; then
  echo "Dashboard server already running, skipping."
  exit 0
fi

echo "Starting Dashboard server on port 8765..."
cd "$DASHBOARD_DIR"
nohup "$VENV/bin/python" server.py >"$LOG_FILE" 2>&1 &
disown
echo "Dashboard server started in background (log: $LOG_FILE)"
