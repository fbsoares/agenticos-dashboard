#!/usr/bin/env bash
set -euo pipefail

mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keyscan -H gitlab.com >> ~/.ssh/known_hosts 2>/dev/null

ENTERPRISE_AGENT="$HOME/enterprise-agent"

# Clone enterprise-agent root
if [ -d "$ENTERPRISE_AGENT/.git" ]; then
  echo "Skipping enterprise-agent (already cloned)"
else
  echo "Cloning enterprise-agent..."
  git clone git@gitlab.com:outdare.pt/erp/enterprise-agent.git "$ENTERPRISE_AGENT"
  echo "Done: enterprise-agent"
fi

# Clone orchaistra and dig-in-saas-framework inside enterprise-agent
NESTED_REPOS=(
  "git@gitlab.com:diginio/nexus/orchaistra.git"
  "git@gitlab.com:outdare.pt/dig-in-saas-framework.git"
)

for REPO in "${NESTED_REPOS[@]}"; do
  DIR="$ENTERPRISE_AGENT/$(basename "$REPO" .git)"
  if [ -d "$DIR/.git" ]; then
    echo "Skipping $(basename "$DIR") (already cloned)"
  else
    echo "Cloning $REPO into enterprise-agent/..."
    git clone "$REPO" "$DIR"
    echo "Done: $(basename "$DIR")"
  fi
done

echo "Repository setup complete."