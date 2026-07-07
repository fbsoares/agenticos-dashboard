# Configurable Dashboard & Portable Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Dashboard project into a portable team "Operative System for Claude Code" — JSON-driven sections, portable session-tracking hooks, and shared skills management.

**Architecture:** A single `dashboard-config.json` (gitignored, personal) drives all grid sections; `dashboard.html` renders dynamically from it. Hook scripts self-locate via `SCRIPT_DIR`; `install.sh` wires them into any user's `~/.claude/settings.json`. `sync-skills.sh` syncs `.claude/skills/` bidirectionally with `~/.claude/skills/`.

**Tech Stack:** Vanilla JS (ES2022, fetch, CSS custom properties), Bash, jq, Node.js ESM

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `build-session-data.mjs` | Modify lines 9–10 | Fix hardcoded paths to use `import.meta.url` |
| `.gitignore` | Create | Exclude personal config and generated files |
| `dashboard-config.example.json` | Create | Template with all current sections |
| `.claude/hooks/on-prompt.sh` | Create | UserPromptSubmit hook — portable |
| `.claude/hooks/on-stop.sh` | Create | Stop hook — portable |
| `.claude/settings.json` | Create | Project-level hook template (docs, not live) |
| `sync-skills.sh` | Create | Bidirectional skills sync |
| `install.sh` | Create | Wires hooks + config + git hooks |
| `dashboard.html` | Modify | CSS refactor + HTML cleanup + JS config loader |

---

## Task 1: Fix `build-session-data.mjs` hardcoded paths

**Files:**
- Modify: `build-session-data.mjs:9-10`

- [ ] **Step 1: Verify the problem**

Run: `node -e "import('./build-session-data.mjs')" 2>&1 | head -3`

Expected: script tries to read `/home/snake/fbsoares/Dashboard/sessions.json` — hardcoded to this machine.

- [ ] **Step 2: Replace hardcoded paths with `import.meta.url`-relative paths**

Change lines 1–10 from:
```javascript
#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
```

To:
```javascript
#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
```

And change lines 8–10 from:
```javascript
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const SESSIONS_JSON = join(homedir(), 'fbsoares/Dashboard/sessions.json');
const OUTPUT = join(homedir(), 'fbsoares/Dashboard/session-data.json');
```

To:
```javascript
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const SESSIONS_JSON = join(__dirname, 'sessions.json');
const OUTPUT = join(__dirname, 'session-data.json');
```

- [ ] **Step 3: Verify the script still runs**

Run: `node build-session-data.mjs && echo "OK"`

Expected: `OK` (and `session-data.json` is updated)

- [ ] **Step 4: Commit**

```bash
git add build-session-data.mjs
git commit -m "fix: derive sessions paths from script location, not hardcoded home dir"
```

---

## Task 2: Create `.gitignore`

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
dashboard-config.json
```

- [ ] **Step 2: Verify**

Run: `git check-ignore -v dashboard-config.json`

Expected: `.gitignore:1:dashboard-config.json	dashboard-config.json`

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore for personal dashboard config"
```

---

## Task 3: Create `dashboard-config.example.json`

**Files:**
- Create: `dashboard-config.example.json`

This file is committed to the repo. It doubles as the template for new users and as Filipe's current live config.

- [ ] **Step 1: Create the file**

```json
{
  "user": {
    "name": "Filipe",
    "locale": "pt",
    "city": "Lisboa",
    "timezone": "Europe/Lisbon"
  },
  "theme": {
    "accents": {
      "work":    "#4a9eff",
      "agents":  "#a78bfa",
      "data":    "#34d399",
      "home":    "#f59e0b",
      "gaming":  "#f43f5e",
      "infra":   "#06b6d4",
      "sprint":  "#fb923c",
      "reports": "#e879f9"
    }
  },
  "sections": [
    {
      "id": "work",
      "label": "Work",
      "accent": "work",
      "grid": { "col": "1 / 5", "row": "1" },
      "links": [
        { "icon": "📅", "name": "Google Calendar",      "url": "https://calendar.google.com/calendar/u/0/r" },
        { "icon": "🎯", "name": "Jira — For You",       "url": "https://zmt.atlassian.net/jira/for-you" },
        { "icon": "📋", "name": "Notion — Work Tasks",  "url": "https://www.notion.so/Work-Tasks-2b5294f28d9780de9994da966256cd6f" },
        { "icon": "✉",  "name": "Gmail",                "url": "https://mail.google.com/" },
        { "icon": "🐙", "name": "GitHub",               "url": "https://github.com/" },
        { "icon": "🦊", "name": "GitLab",               "url": "https://gitlab.com/" },
        { "icon": "📐", "name": "draw.io",              "url": "https://app.diagrams.net/" },
        { "icon": "👥", "name": "HR Factorial",         "url": "https://app.factorialhr.com/?locale=pt" }
      ]
    },
    {
      "id": "wip",
      "label": "WIP — Sprints",
      "accent": "sprint",
      "grid": { "col": "5 / 9", "row": "1" },
      "links": [
        { "icon": "🚀", "name": "Go Live",                     "url": "https://zmt.atlassian.net/issues?filter=10122" },
        { "icon": "📌", "name": "GOAPI",                       "url": "https://zmt.atlassian.net/jira/software/c/projects/GOAPI/boards/9/backlog" },
        { "icon": "📌", "name": "ZAPP",                        "url": "https://zmt.atlassian.net/jira/software/c/projects/ZAPP/boards/1/backlog" },
        { "icon": "📌", "name": "ZBUN",                        "url": "https://zmt.atlassian.net/jira/software/c/projects/ZBUN/boards/29/backlog" },
        { "icon": "📌", "name": "DATA",                        "url": "https://zmt.atlassian.net/jira/software/c/projects/DATA/boards/32/backlog" },
        { "icon": "🔄", "name": "Processo de Mudança de Sprint","url": "https://zmt.atlassian.net/wiki/spaces/ZITT/pages/592576513/Processo+de+Mudan+a+de+Sprint+DIG-IN+Dev" }
      ]
    },
    {
      "id": "agents",
      "label": "Agents",
      "accent": "agents",
      "grid": { "col": "9 / 13", "row": "1" },
      "links": [
        { "icon": "🌀", "name": "Spinnable",        "url": "https://www.spinnable.ai/" },
        { "icon": "✦",  "name": "Gemini",           "url": "https://gemini.google.com/" },
        { "icon": "◈",  "name": "Claude",           "url": "https://claude.ai/new" },
        { "icon": "⚡", "name": "Edgar",            "url": "https://edgar.dig-in.io/" },
        { "icon": "⚡", "name": "Skills Dashboard", "url": "skills.html" },
        { "icon": "◈",  "name": "Sessions",         "url": "session-dashboard.html" }
      ]
    },
    {
      "id": "data",
      "label": "Data Project @ Work",
      "accent": "data",
      "grid": { "col": "1 / 7", "row": "2" },
      "linksColumns": 2,
      "links": [
        { "icon": "⚡", "name": "DIG-IN Dispatcher", "url": "http://10.10.10.62:5174/" },
        { "icon": "☁",  "name": "GCP Console",       "url": "https://console.cloud.google.com/welcome?pli=1&authuser=3" },
        { "icon": "🖥",  "name": "Compute Engine",    "url": "https://console.cloud.google.com/compute?authuser=3&project=nexus-487914" }
      ]
    },
    {
      "id": "home",
      "label": "Home",
      "accent": "home",
      "grid": { "col": "7 / 10", "row": "2" },
      "links": [
        { "icon": "🏠", "name": "Daily Management", "url": "https://www.notion.so/Daily-Management-235294f28d9780a78b12eee8a92bc09d?pvs=12" },
        { "icon": "🤖", "name": "Reddit",           "url": "https://www.reddit.com/" }
      ]
    },
    {
      "id": "gaming",
      "label": "Gaming",
      "accent": "gaming",
      "grid": { "col": "10 / 13", "row": "2" },
      "links": [
        { "icon": "🎮", "name": "Playline", "url": "https://www.notion.so/Gaming-Playline-300294f28d978042a699d354d0c17a34?showMoveTo=true" },
        { "icon": "📡", "name": "Twitch",   "url": "https://www.twitch.tv/" },
        { "icon": "💬", "name": "Discord",  "url": "https://discord.com/channels/795244159211405323/813003465856516126" }
      ]
    },
    {
      "id": "infra",
      "label": "Infra & Cloud",
      "accent": "infra",
      "grid": { "col": "1 / 13", "row": "3" },
      "linksColumns": 2,
      "links": [
        { "icon": "☁",  "name": "Azure Portal",  "url": "https://portal.azure.com/#home" },
        { "icon": "🌐", "name": "Cloudflare",    "url": "https://dash.cloudflare.com" },
        { "icon": "🖧",  "name": "PTISP",         "url": "https://my.ptisp.pt/" },
        { "icon": "☁",  "name": "Jotelulu",      "url": "https://admin.jotelulu.com/" },
        { "icon": "📞", "name": "Suporte — SPOC","url": "https://airtable.com/appm7sm3GMMeQisUk/tblUWBV2EJwOKKicA/viwA6YksUoqROBp3A?blocks=hide" },
        { "icon": "📊", "name": "Zabbix",        "url": "https://zabbix-c130.dig-in.io/" },
        { "icon": "🔍", "name": "Sentry",        "url": "https://zmt-europe-lda.sentry.io/issues/" },
        { "icon": "🗄",  "name": "Supabase",      "url": "https://supabase.com/dashboard/organizations" }
      ]
    },
    {
      "id": "reports",
      "type": "dynamic",
      "label": "Reports",
      "accent": "reports",
      "grid": { "col": "1 / 13", "row": "4" }
    }
  ]
}
```

- [ ] **Step 2: Validate JSON**

Run: `jq '.' dashboard-config.example.json > /dev/null && echo "valid JSON"`

Expected: `valid JSON`

- [ ] **Step 3: Commit**

```bash
git add dashboard-config.example.json
git commit -m "feat: add dashboard-config.example.json with all current sections"
```

---

## Task 4: Create portable hook scripts

**Files:**
- Create: `.claude/hooks/on-prompt.sh`
- Create: `.claude/hooks/on-stop.sh`

- [ ] **Step 1: Create hooks directory**

```bash
mkdir -p .claude/hooks
```

- [ ] **Step 2: Create `.claude/hooks/on-prompt.sh`**

```bash
#!/usr/bin/env bash
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
DASHBOARD_DIR=$(dirname "$SCRIPT_DIR")

input=$(cat)
sid=$(echo "$input" | jq -r '.session_id // empty')
cwd=$(echo "$input" | jq -r '.cwd // empty')
transcript=$(echo "$input" | jq -r '.transcript_path // empty')
[ -z "$sid" ] && exit 0

name=$([ -n "$transcript" ] && grep -m1 '"type":"custom-title"' "$transcript" 2>/dev/null | jq -r '.customTitle // empty' || echo '')
rc_url=$([ -n "$transcript" ] && grep -m1 '"subtype":"bridge_status"' "$transcript" 2>/dev/null | jq -r '.url // empty' || echo '')

f="$DASHBOARD_DIR/sessions.json"
tmp=$(mktemp)
existing=$(cat "$f" 2>/dev/null || echo '[]')
echo "$existing" | jq \
  --arg id "$sid" \
  --arg cwd "$cwd" \
  --arg ts "$(date -Iseconds)" \
  --arg name "$name" \
  --arg rc_url "$rc_url" \
  'map(select(.session_id != $id)) + [{session_id: $id, name: $name, cwd: $cwd, last_active: $ts, active: true, rc_url: (if $rc_url != "" then $rc_url else null end)}]' \
  > "$tmp" && mv "$tmp" "$f"

node "$DASHBOARD_DIR/build-session-data.mjs" >/dev/null 2>&1
```

- [ ] **Step 3: Create `.claude/hooks/on-stop.sh`**

```bash
#!/usr/bin/env bash
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
DASHBOARD_DIR=$(dirname "$SCRIPT_DIR")

input=$(cat)
sid=$(echo "$input" | jq -r '.session_id // empty')
[ -z "$sid" ] && exit 0

f="$DASHBOARD_DIR/sessions.json"
tmp=$(mktemp)
existing=$(cat "$f" 2>/dev/null || echo '[]')
echo "$existing" | jq \
  --arg id "$sid" \
  --arg ts "$(date -Iseconds)" \
  'map(if .session_id == $id then . + {active: false, ended: $ts} else . end)' \
  > "$tmp" && mv "$tmp" "$f"
```

- [ ] **Step 4: Make executable and test on-stop.sh**

```bash
chmod +x .claude/hooks/on-prompt.sh .claude/hooks/on-stop.sh
echo '{"session_id":"test-123","cwd":"/tmp"}' | bash .claude/hooks/on-stop.sh
echo "exit: $?"
```

Expected: `exit: 0` (and `sessions.json` updated if it exists)

- [ ] **Step 5: Test on-prompt.sh**

```bash
echo '{"session_id":"test-456","cwd":"/tmp","transcript_path":""}' | bash .claude/hooks/on-prompt.sh
cat sessions.json | jq '.[] | select(.session_id=="test-456")'
```

Expected: JSON entry with `session_id: "test-456"`, `active: true`

- [ ] **Step 6: Create `.claude/settings.json` (project-level template)**

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "_readme": "Hook paths below use $DASHBOARD_DIR as placeholder. Run install.sh to register real absolute paths in ~/.claude/settings.json",
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$DASHBOARD_DIR/.claude/hooks/on-prompt.sh",
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$DASHBOARD_DIR/.claude/hooks/on-stop.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/on-prompt.sh .claude/hooks/on-stop.sh .claude/settings.json
git commit -m "feat: add portable hook scripts for session tracking"
```

---

## Task 5: Create `sync-skills.sh`

**Files:**
- Create: `sync-skills.sh`

- [ ] **Step 1: Create `sync-skills.sh`**

```bash
#!/usr/bin/env bash
set -e
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_SKILLS="$SCRIPT_DIR/.claude/skills"
LOCAL_SKILLS="$HOME/.claude/skills"

CMD="${1:-status}"

case "$CMD" in
  pull)
    echo "=== Syncing repo skills → ~/.claude/skills/ ==="
    if [ ! -d "$REPO_SKILLS" ]; then
      echo "No .claude/skills/ in repo, nothing to pull."
      exit 0
    fi
    CHANGED=0
    while IFS= read -r -d '' src; do
      rel="${src#$REPO_SKILLS/}"
      dst="$LOCAL_SKILLS/$rel"
      mkdir -p "$(dirname "$dst")"
      if [ ! -f "$dst" ] || ! diff -q "$src" "$dst" >/dev/null 2>&1; then
        cp "$src" "$dst"
        echo "  ✓ $rel"
        CHANGED=1
      fi
    done < <(find "$REPO_SKILLS" -type f -print0)
    [ "$CHANGED" -eq 0 ] && echo "  Already up to date."
    echo "Pull complete."
    ;;

  push)
    echo "=== Syncing ~/.claude/skills/ → repo ==="
    if [ ! -d "$LOCAL_SKILLS" ]; then
      echo "No ~/.claude/skills/, nothing to push."
      exit 0
    fi
    mkdir -p "$REPO_SKILLS"
    CHANGED=0
    while IFS= read -r -d '' src; do
      rel="${src#$LOCAL_SKILLS/}"
      dst="$REPO_SKILLS/$rel"
      mkdir -p "$(dirname "$dst")"
      if [ ! -f "$dst" ] || ! diff -q "$src" "$dst" >/dev/null 2>&1; then
        cp "$src" "$dst"
        git -C "$SCRIPT_DIR" add "$dst" 2>/dev/null || true
        echo "  ✓ $rel"
        CHANGED=1
      fi
    done < <(find "$LOCAL_SKILLS" -type f -print0)
    [ "$CHANGED" -eq 0 ] && echo "  Already up to date."
    echo "Push complete. Review staged files and commit only team-shared skills."
    ;;

  status)
    echo "=== Skills sync status ==="
    FOUND=0
    if [ -d "$LOCAL_SKILLS" ]; then
      while IFS= read -r -d '' src; do
        rel="${src#$LOCAL_SKILLS/}"
        dst="$REPO_SKILLS/$rel"
        if [ ! -f "$dst" ]; then
          echo "  local-only : $rel"
          FOUND=1
        elif ! diff -q "$src" "$dst" >/dev/null 2>&1; then
          echo "  modified   : $rel"
          FOUND=1
        fi
      done < <(find "$LOCAL_SKILLS" -type f -print0 2>/dev/null)
    fi
    if [ -d "$REPO_SKILLS" ]; then
      while IFS= read -r -d '' src; do
        rel="${src#$REPO_SKILLS/}"
        if [ ! -f "$LOCAL_SKILLS/$rel" ]; then
          echo "  repo-only  : $rel"
          FOUND=1
        fi
      done < <(find "$REPO_SKILLS" -type f -print0 2>/dev/null)
    fi
    [ "$FOUND" -eq 0 ] && echo "  In sync."
    ;;

  *)
    echo "Usage: sync-skills.sh pull|push|status"
    exit 1
    ;;
esac
```

- [ ] **Step 2: Make executable and test status**

```bash
chmod +x sync-skills.sh
./sync-skills.sh status
```

Expected: output listing local-only skills (the ones in `~/.claude/skills/`)

- [ ] **Step 3: Test pull with dry-run (no .claude/skills/ in repo yet)**

```bash
./sync-skills.sh pull
```

Expected: `No .claude/skills/ in repo, nothing to pull.`

- [ ] **Step 4: Commit**

```bash
git add sync-skills.sh
git commit -m "feat: add sync-skills.sh for bidirectional skills sync"
```

---

## Task 6: Create `install.sh`

**Files:**
- Create: `install.sh`

- [ ] **Step 1: Create `install.sh`**

```bash
#!/usr/bin/env bash
set -e
DASHBOARD_DIR=$(cd "$(dirname "$0")" && pwd)

echo "=== Claude Operative System — install ==="
echo "Dashboard dir: $DASHBOARD_DIR"
echo ""

# 1. Make hooks executable
chmod +x "$DASHBOARD_DIR/.claude/hooks/"*.sh
echo "✓ Hook scripts marked executable"

# 2. Merge hooks into ~/.claude/settings.json
SETTINGS="$HOME/.claude/settings.json"
existing=$(cat "$SETTINGS" 2>/dev/null || echo '{}')

PROMPT_CMD="$DASHBOARD_DIR/.claude/hooks/on-prompt.sh"
STOP_CMD="$DASHBOARD_DIR/.claude/hooks/on-stop.sh"

has_prompt=$(echo "$existing" | jq --arg cmd "$PROMPT_CMD" \
  '[.hooks.UserPromptSubmit[]?.hooks[]? | select(.command == $cmd)] | length' 2>/dev/null || echo '0')
has_stop=$(echo "$existing" | jq --arg cmd "$STOP_CMD" \
  '[.hooks.Stop[]?.hooks[]? | select(.command == $cmd)] | length' 2>/dev/null || echo '0')

if [ "$has_prompt" = "0" ]; then
  existing=$(echo "$existing" | jq \
    --arg cmd "$PROMPT_CMD" \
    '.hooks.UserPromptSubmit = (.hooks.UserPromptSubmit // []) + [{"hooks": [{"type": "command", "command": $cmd, "async": true}]}]')
  echo "✓ Registered UserPromptSubmit hook"
else
  echo "  UserPromptSubmit hook already registered, skipping"
fi

if [ "$has_stop" = "0" ]; then
  existing=$(echo "$existing" | jq \
    --arg cmd "$STOP_CMD" \
    '.hooks.Stop = (.hooks.Stop // []) + [{"hooks": [{"type": "command", "command": $cmd, "async": true}]}]')
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
      echo "$SYNC_CALL" >> "$POST_MERGE"
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
      echo "$STATUS_CALL" >> "$PRE_PUSH"
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

echo ""
echo "=== Done! ==="
echo "  Restart Claude Code to activate session hooks."
echo "  Start dashboard: cd $DASHBOARD_DIR && python3 -m http.server 8765"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x install.sh
```

- [ ] **Step 3: Dry-run test (idempotency check)**

Run install twice. Second run should produce only "already registered / already exists / skipping" messages.

```bash
./install.sh
echo "--- second run ---"
./install.sh 2>&1 | grep -E "(skipping|already)"
```

Expected second run: lines containing "skipping" for both hooks and config.

- [ ] **Step 4: Verify ~/.claude/settings.json was updated correctly**

```bash
jq '.hooks.UserPromptSubmit[-1].hooks[0].command' ~/.claude/settings.json
```

Expected: `"<absolute-path>/.claude/hooks/on-prompt.sh"`

- [ ] **Step 5: Commit**

```bash
git add install.sh
git commit -m "feat: add install.sh to wire hooks and config for any user"
```

---

## Task 7: Refactor `dashboard.html` — CSS and HTML structure

This task removes all hardcoded per-section CSS and static section HTML. After this task the dashboard page will be visually broken until Task 8 adds the JS renderer — this is expected.

**Files:**
- Modify: `dashboard.html`

### CSS changes

- [ ] **Step 1: Replace hardcoded accent vars in `:root` with generic fallbacks**

Remove the following lines from `:root` (lines 19–34):
```css
--accent-work: #4a9eff;
--accent-agent: #a78bfa;
--accent-data: #34d399;
--accent-home: #f59e0b;
--accent-game: #f43f5e;
--accent-infra: #06b6d4;
--accent-sprint: #fb923c;
--glow-work: rgba(74,158,255,0.15);
--glow-agent: rgba(167,139,250,0.15);
--glow-data: rgba(52,211,153,0.15);
--glow-home: rgba(245,158,11,0.15);
--glow-game: rgba(244,63,94,0.15);
--glow-infra: rgba(6,182,212,0.15);
--glow-sprint: rgba(251,146,60,0.15);
--accent-reports: #e879f9;
--glow-reports: rgba(232,121,249,0.15);
```

Add in their place (JS will override these with config values at runtime):
```css
--accent-work: #4a9eff;
--accent-agents: #a78bfa;
--accent-data: #34d399;
--accent-home: #f59e0b;
--accent-gaming: #f43f5e;
--accent-infra: #06b6d4;
--accent-sprint: #fb923c;
--accent-reports: #e879f9;
```

- [ ] **Step 2: Replace per-class `::before` and `:hover` rules with generic section rules**

Remove these CSS blocks (approximately lines 250–268):
```css
.work::before   { background: linear-gradient(90deg, transparent, var(--accent-work), transparent); }
.wip::before    { background: linear-gradient(90deg, transparent, var(--accent-sprint), transparent); }
.agents::before { background: linear-gradient(90deg, transparent, var(--accent-agent), transparent); }
.data::before   { background: linear-gradient(90deg, transparent, var(--accent-data), transparent); }
.home-section::before { background: linear-gradient(90deg, transparent, var(--accent-home), transparent); }
.gaming::before { background: linear-gradient(90deg, transparent, var(--accent-game), transparent); }
.infra::before    { background: linear-gradient(90deg, transparent, var(--accent-infra), transparent); }
.reports::before  { background: linear-gradient(90deg, transparent, var(--accent-reports), transparent); }

.work:hover { box-shadow: 0 0 40px var(--glow-work); }
.wip:hover  { box-shadow: 0 0 40px var(--glow-sprint); }
.agents:hover { box-shadow: 0 0 40px var(--glow-agent); }
.data:hover { box-shadow: 0 0 40px var(--glow-data); }
.home-section:hover { box-shadow: 0 0 40px var(--glow-home); }
.gaming:hover { box-shadow: 0 0 40px var(--glow-game); }
.infra:hover    { box-shadow: 0 0 40px var(--glow-infra); }
.reports:hover  { box-shadow: 0 0 40px var(--glow-reports); }
```

Add in their place:
```css
.section::before { background: linear-gradient(90deg, transparent, var(--section-accent, #888), transparent); }
.section:hover   { box-shadow: 0 0 40px var(--section-glow, rgba(136,136,136,0.15)); }
```

- [ ] **Step 3: Replace per-class layout placement rules**

Remove these CSS rules (approximately lines 280–287):
```css
.work        { grid-column: 1 / 5; grid-row: 1; }
.wip         { grid-column: 5 / 9; grid-row: 1; }
.agents      { grid-column: 9 / 13; grid-row: 1; }
.data        { grid-column: 1 / 7; grid-row: 2; }
.home-section{ grid-column: 7 / 10; grid-row: 2; }
.gaming      { grid-column: 10 / 13; grid-row: 2; }
.infra       { grid-column: 1 / 13; grid-row: 3; }
.reports     { grid-column: 1 / 13; grid-row: 4; }
```

These are replaced by a dynamically-generated `<style>` block from JS (see Task 8).

- [ ] **Step 4: Replace per-class `.dot` rules**

Remove (approximately lines 303–310):
```css
.work .dot    { background: var(--accent-work); box-shadow: 0 0 8px var(--accent-work); }
.wip .dot     { background: var(--accent-sprint); box-shadow: 0 0 8px var(--accent-sprint); }
.agents .dot  { background: var(--accent-agent); box-shadow: 0 0 8px var(--accent-agent); }
.data .dot    { background: var(--accent-data); box-shadow: 0 0 8px var(--accent-data); }
.home-section .dot { background: var(--accent-home); box-shadow: 0 0 8px var(--accent-home); }
.gaming .dot  { background: var(--accent-game); box-shadow: 0 0 8px var(--accent-game); }
.infra .dot    { background: var(--accent-infra); box-shadow: 0 0 8px var(--accent-infra); }
.reports .dot  { background: var(--accent-reports); box-shadow: 0 0 8px var(--accent-reports); }
```

Add in their place:
```css
.section .dot { background: var(--section-accent, #888); box-shadow: 0 0 8px var(--section-accent, #888); }
```

- [ ] **Step 5: Replace per-class `.link-icon` rules**

Remove (approximately lines 355–362):
```css
.work    .link-icon { background: rgba(74,158,255,0.12); }
.wip     .link-icon { background: rgba(251,146,60,0.12); }
.agents  .link-icon { background: rgba(167,139,250,0.12); }
.data    .link-icon { background: rgba(52,211,153,0.12); }
.home-section .link-icon { background: rgba(245,158,11,0.12); }
.gaming  .link-icon { background: rgba(244,63,94,0.12); }
.infra   .link-icon { background: rgba(6,182,212,0.12); }
.reports .link-icon { background: rgba(232,121,249,0.12); }
```

Add in their place:
```css
.section .link-icon { background: var(--section-icon-bg, rgba(255,255,255,0.08)); }
```

- [ ] **Step 6: Replace two-column `.links` override with grid default**

Remove (approximately lines 376–383):
```css
.data .links,
.infra .links,
.reports .links {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
```

Change the base `.links` rule from:
```css
.links { display: flex; flex-direction: column; gap: 4px; }
```

To:
```css
.links { display: grid; grid-template-columns: 1fr; gap: 4px; }
```

Sections with `"linksColumns": 2` will get `style="grid-template-columns: repeat(2, 1fr);"` applied by the JS renderer.

- [ ] **Step 7: Update responsive breakpoints**

Remove the `@media (max-width: 900px)` block (approximately lines 421–432) — the 900px layout was hardcoded to specific class names. With JS-generated grid rules, it's replaced by a simpler mobile-only breakpoint.

Keep and update the `@media (max-width: 600px)` block to:
```css
@media (max-width: 600px) {
  .grid { grid-template-columns: 1fr; }
  .links { grid-template-columns: 1fr !important; }
}
```

- [ ] **Step 8: Replace stagger nth-child rules with animation-delay on section**

The existing nth-child stagger (lines 270–277) can remain as-is — nth-child works on rendered elements regardless of their class, so this still works with dynamic rendering.

### HTML changes

- [ ] **Step 9: Remove all hardcoded section divs from the grid, add id to grid**

Replace the entire `<div class="grid">` block (lines 456–719) with:
```html
<div class="grid" id="grid"></div>
```

The session-banner, header, and footer stay as static HTML — do not remove them.

- [ ] **Step 10: Commit the CSS/HTML changes**

```bash
git add dashboard.html
git commit -m "refactor: remove hardcoded section CSS/HTML, prepare for config-driven rendering"
```

---

## Task 8: Add config loader and renderer to `dashboard.html`

**Files:**
- Modify: `dashboard.html` (script block)

- [ ] **Step 1: Replace the entire `<script>` block contents**

The new script has three parts:
1. Locale data + updated `tick()`
2. Unchanged `pollSessions()` and `pollReports()`  
3. New config loader + section renderer

Replace everything between `<script>` and `</script>` with:

```javascript
// ── Locale ──────────────────────────────────────────────────────────────
const LOCALE_DATA = {
  pt: {
    days:      ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'],
    months:    ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
    dateFmt:   (day, date, month, year) => `${day}, ${date} de ${month} de ${year}`,
    tips:      ['Semana começa amanhã.','Bom trabalho, segunda!','Quarta-feira, meio da semana.','Já passou do meio!','Sexta está perto.','Fim de semana! 🎉','Descansas, mereces.'],
    greetings: ['Bom dia.','Boa tarde.','Boa noite.'],
  },
  en: {
    days:      ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
    months:    ['January','February','March','April','May','June','July','August','September','October','November','December'],
    dateFmt:   (day, date, month, year) => `${day}, ${month} ${date}, ${year}`,
    tips:      ['Week starts tomorrow.','Good work, Monday!','Hump day.','Past the middle!','Friday is near.','Weekend! 🎉','Rest, you deserve it.'],
    greetings: ['Good morning.','Good afternoon.','Good evening.'],
  },
};

let appLocale = 'pt';
let appCity   = 'Lisboa';

function pad(n) { return String(n).padStart(2, '0'); }

function tick() {
  const now = new Date();
  const h = pad(now.getHours()), m = pad(now.getMinutes());
  document.getElementById('clock').textContent = `${h}:${m}`;

  const L = LOCALE_DATA[appLocale] || LOCALE_DATA.pt;
  const day   = L.days[now.getDay()];
  const month = L.months[now.getMonth()];
  document.getElementById('dateline').textContent = L.dateFmt(day, now.getDate(), month, now.getFullYear());

  const hr = now.getHours();
  document.getElementById('greeting').textContent = hr < 12 ? L.greetings[0] : hr < 18 ? L.greetings[1] : L.greetings[2];
  document.getElementById('day-tip').textContent  = L.tips[now.getDay()];
  document.getElementById('focus-text').textContent = `${appCity} · ${h}:${m}`;
}

// ── Session polling (unchanged logic) ───────────────────────────────────
function shortModel(m) {
  if (!m) return '';
  if (m.includes('opus'))   return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku'))  return 'haiku';
  return '';
}

function pollSessions() {
  fetch('session-data.json?t=' + Date.now())
    .then(r => r.json())
    .then(data => {
      const sessions = (data.sessions || []).filter(s => s.active);
      const banner = document.getElementById('session-banner');
      const list   = document.getElementById('session-list');
      if (sessions.length === 0) { banner.classList.remove('active'); return; }
      banner.classList.add('active');
      list.innerHTML = sessions.map(s => {
        const folder   = s.cwd ? s.cwd.replace(/\/+$/, '').split('/').pop() : '—';
        const fullPath = s.cwd || '—';
        const shortId  = s.session_id ? s.session_id.slice(0, 8) : '';
        const time     = s.last_active ? new Date(s.last_active).toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit'}) : '';
        const name     = s.name || folder;
        const branch   = s.git_branch ? s.git_branch.replace(/^feature\/[^/]+\//, '') : '';
        const model    = shortModel(s.model);
        return `<div class="session-item">
          <span class="session-pulse"></span>
          <span class="session-label">Active</span>
          <span class="session-name">${name}</span>
          <span class="session-cwd" title="${fullPath}">${fullPath}</span>
          ${branch ? `<span class="session-id">⎇ ${branch}</span>` : `<span class="session-id">${shortId}</span>`}
          ${model  ? `<span class="session-time">${model}</span>` : ''}
          <span class="session-time">${time}</span>
          ${s.rc_url ? `<a class="session-rc-link" href="${s.rc_url}" target="_blank">↗ RC</a>` : ''}
        </div>`;
      }).join('');
    })
    .catch(() => {});
}

function pollReports() {
  fetch('reports/reports-index.json?t=' + Date.now())
    .then(r => r.json())
    .then(data => {
      const el = document.getElementById('reports-links');
      if (!el) return;
      if (!data.length) {
        el.innerHTML = '<span style="color:var(--muted);font-size:0.78rem;font-family:\'DM Mono\',monospace;">No reports yet.</span>';
        return;
      }
      el.innerHTML = data.map(r => `<a class="link" href="${r.file}" target="_blank">
        <span class="link-icon">📄</span>
        <span class="link-name">${r.title || r.name}</span>
        <span class="link-arrow">↗</span>
      </a>`).join('');
    })
    .catch(() => {
      const el = document.getElementById('reports-links');
      if (el) el.innerHTML = '<span style="color:var(--muted);font-size:0.78rem;font-family:\'DM Mono\',monospace;">No reports found.</span>';
    });
}

// ── Config-driven rendering ──────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildGridStylesheet(sections) {
  const rules = sections.map(s =>
    `#${s.id} { grid-column: ${s.grid.col}; grid-row: ${s.grid.row}; }`
  ).join('\n');
  const mobileRules = sections.map(s => `#${s.id} { grid-column: 1 / -1; }`).join('\n  ');
  return `${rules}\n@media (max-width: 900px) {\n  .grid { grid-template-columns: repeat(6, 1fr); }\n}\n@media (max-width: 600px) {\n  ${mobileRules}\n}`;
}

function renderSection(section) {
  const colStyle = section.linksColumns > 1
    ? ` style="grid-template-columns: repeat(${section.linksColumns}, 1fr);"`
    : '';

  if (section.type === 'dynamic') {
    return `<div id="${section.id}" class="section">
      <div class="label">
        <span class="dot"></span>
        <span class="label-text">${section.label}</span>
      </div>
      <div class="links" id="${section.id}-links">
        <span style="color:var(--muted);font-size:0.78rem;font-family:'DM Mono',monospace;">Loading…</span>
      </div>
    </div>`;
  }

  const links = (section.links || []).map(link =>
    `<a class="link" href="${link.url}" target="_blank">
      <span class="link-icon">${link.icon}</span>
      <span class="link-name">${link.name}</span>
      <span class="link-arrow">↗</span>
    </a>`
  ).join('');

  return `<div id="${section.id}" class="section">
    <div class="label">
      <span class="dot"></span>
      <span class="label-text">${section.label}</span>
    </div>
    <div class="links"${colStyle}>${links}</div>
  </div>`;
}

async function loadConfig() {
  let config;
  try {
    const r = await fetch('dashboard-config.json?t=' + Date.now());
    if (!r.ok) throw new Error(r.status);
    config = await r.json();
  } catch {
    document.getElementById('grid').innerHTML =
      `<div style="grid-column:1/-1;padding:32px;color:var(--muted);font-family:'DM Mono',monospace;font-size:0.82rem;line-height:1.8;">
        <strong style="color:var(--text)">dashboard-config.json not found</strong><br>
        Run <code style="color:var(--text);background:var(--surface2);padding:2px 6px;border-radius:4px;">./install.sh</code> from the repo root to set up.
      </div>`;
    return;
  }

  // Apply user
  if (config.user?.locale) appLocale = config.user.locale;
  if (config.user?.city)   appCity   = config.user.city;
  tick();

  // Inject accent + glow CSS vars into :root
  const root = document.documentElement;
  if (config.theme?.accents) {
    for (const [key, hex] of Object.entries(config.theme.accents)) {
      root.style.setProperty(`--accent-${key}`, hex);
      root.style.setProperty(`--glow-${key}`, hexToRgba(hex, 0.15));
    }
  }

  // Generate grid placement stylesheet
  const sections = config.sections || [];
  const styleEl = document.createElement('style');
  styleEl.id = 'grid-layout';
  styleEl.textContent = buildGridStylesheet(sections);
  document.head.appendChild(styleEl);

  // Render sections
  const grid = document.getElementById('grid');
  grid.innerHTML = sections.map(renderSection).join('');

  // Apply per-section CSS custom properties
  for (const section of sections) {
    const el = document.getElementById(section.id);
    if (!el) continue;
    const accentKey = section.accent || section.id;
    const hex = config.theme?.accents?.[accentKey];
    if (hex) {
      el.style.setProperty('--section-accent',  hex);
      el.style.setProperty('--section-glow',    hexToRgba(hex, 0.15));
      el.style.setProperty('--section-icon-bg', hexToRgba(hex, 0.12));
    }
  }

  // Start reports polling now that the reports section exists
  pollReports();
  setInterval(pollReports, 30000);
}

// ── Boot ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  tick();
  setInterval(tick, 1000);
  pollSessions();
  setInterval(pollSessions, 5000);
  loadConfig();
});
```

- [ ] **Step 2: Commit**

```bash
git add dashboard.html
git commit -m "feat: render dashboard sections dynamically from dashboard-config.json"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Run install.sh**

```bash
./install.sh
```

Expected: hooks registered, `dashboard-config.json` created.

- [ ] **Step 2: Start the dev server**

```bash
python3 -m http.server 8765 &
```

- [ ] **Step 3: Open dashboard in browser**

Navigate to `http://localhost:8765/dashboard.html`

Expected:
- All 8 sections render (work, wip, agents, data, home, gaming, infra, reports)
- Each section has the correct accent color dot and hover glow
- Links are clickable
- Reports section shows "Loading…" then (if reports exist) links, or "No reports found"
- Session banner appears if active sessions exist
- Clock ticks and shows "Bom dia/tarde/noite" based on hour
- Footer shows "Lisboa · HH:MM"

- [ ] **Step 4: Test fallback — rename config and reload**

```bash
mv dashboard-config.json dashboard-config.json.bak
```

Reload browser. Expected: error message "dashboard-config.json not found — run ./install.sh"

```bash
mv dashboard-config.json.bak dashboard-config.json
```

Reload. Expected: sections render again.

- [ ] **Step 5: Test install.sh idempotency**

```bash
./install.sh
```

Expected: all lines say "already registered / already exists / skipping".

- [ ] **Step 6: Test sync-skills.sh**

```bash
./sync-skills.sh status
./sync-skills.sh push
```

Expected: status lists local-only skills; push copies them into `.claude/skills/` and stages them.

- [ ] **Step 7: Review and commit skills you want to share with the team**

```bash
git status          # see staged .claude/skills/ files
git diff --staged   # review content
# commit only the skills intended for the team:
git add .claude/skills/<skill-name>/
git commit -m "feat: add <skill-name> team skill"
```

- [ ] **Step 8: Kill dev server**

```bash
kill %1
```

- [ ] **Step 9: Final verification — run install.sh instructions for a new user**

```bash
# Simulate a fresh clone
rm dashboard-config.json
bash install.sh
python3 -m http.server 8765 &
# open http://localhost:8765/dashboard.html — should render from the copied example config
kill %1
```
