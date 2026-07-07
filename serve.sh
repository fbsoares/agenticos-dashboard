#!/bin/bash
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
echo "Dashboard a correr em http://localhost:8765"
"$SCRIPT_DIR/.venv/bin/python" "$SCRIPT_DIR/server.py"
