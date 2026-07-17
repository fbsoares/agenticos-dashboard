#!/usr/bin/env bash
set -euo pipefail

mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keyscan -H gitlab.com >> ~/.ssh/known_hosts 2>/dev/null
ssh-keyscan -H github.com >> ~/.ssh/known_hosts 2>/dev/null

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

# Clone the Dashboard project itself (this template's own repo), so the
# workspace can run and serve it directly (see start-dashboard.sh).
DASHBOARD_DIR="$HOME/dashboard"

if [ -d "$DASHBOARD_DIR/.git" ]; then
  echo "Skipping dashboard (already cloned)"
else
  echo "Cloning dashboard..."
  git clone git@github.com:fbsoares/agenticos-dashboard.git "$DASHBOARD_DIR"
  echo "Done: dashboard"
fi

echo "Repository setup complete."