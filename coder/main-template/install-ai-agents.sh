#!/usr/bin/env bash

if ! command -v npm >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

sudo npm install -g @anthropic-ai/claude-code opencode-ai
curl -fsSL https://antigravity.google/cli/install.sh | bash