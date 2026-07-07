# Claude Operative System — Configurable Dashboard & Portable Hooks

**Date:** 2026-06-06  
**Status:** Approved  
**Scope:** v1

---

## Overview

Transform the Dashboard project from a personal single-user tool into a portable "Operative System for Claude Code" that any team member can clone, install, and personalize. Three pillars:

1. **JSON-driven dashboard** — all sections, links, layout, identity, and theme move to `dashboard-config.json`
2. **Portable hooks** — session tracking hooks extracted into scripts; `install.sh` wires them into any user's `~/.claude/settings.json`
3. **Shared skills management** — `.claude/skills/` in repo holds team skills; git hooks + `sync-skills.sh` keep local and repo in sync

---

## 1. JSON Config Schema (`dashboard-config.json`)

Single file at repo root. Gitignored (personal). `dashboard-config.example.json` committed as template.

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
      "grid": { "col": "1 / 3", "row": "1" },
      "links": [
        { "icon": "📅", "name": "Google Calendar", "url": "https://calendar.google.com/calendar/u/0/r" }
      ]
    },
    {
      "id": "sessions",
      "type": "dynamic",
      "label": "Sessions",
      "accent": "agents",
      "grid": { "col": "1 / 4", "row": "2" }
    },
    {
      "id": "reports",
      "type": "dynamic",
      "label": "Reports",
      "accent": "reports",
      "grid": { "col": "1 / 4", "row": "7" }
    }
  ]
}
```

**Rules:**
- `grid.col` / `grid.row` are raw CSS `grid-column` / `grid-row` values
- Sections with `"type": "dynamic"` have no `links` array — internal JS handles their content
- `theme.accents` keys match section `accent` values; `dashboard.html` injects them as CSS custom properties (`--accent-{key}`)
- `user.locale` controls date/greeting language; `user.city` renders in footer

---

## 2. `dashboard.html` Rendering

On page load:

1. `fetch('dashboard-config.json')` → parse JSON
2. Inject `theme.accents` into `:root` as CSS custom properties
3. Apply `user` block: greeting logic uses `user.locale`, footer shows `user.city`
4. Render `sections[]` into `.grid`:
   - Each section becomes a `.section` div with `grid-column` / `grid-row` set from config
   - Regular sections: render `links[]` as anchor tags
   - Dynamic sections (`sessions`, `reports`): render empty placeholder; existing polling JS attaches by `id`
5. Fallback: if `dashboard-config.json` missing or fetch fails, show error state in grid (not blank page)

Existing polling logic (`pollSessions`, `pollReports`) unchanged — they target `#session-list` and `#reports-links` by id.

Static CSS (grid container, link styles, animations) remains in `<style>` block. Theme colors become CSS vars, not hardcoded hex.

---

## 3. Portable Hooks

### Hook scripts

**`.claude/hooks/on-prompt.sh`** — UserPromptSubmit handler  
**`.claude/hooks/on-stop.sh`** — Stop handler

Both scripts self-locate via:
```bash
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
DASHBOARD_DIR=$(dirname "$SCRIPT_DIR")
```

All paths (`sessions.json`, `build-session-data.mjs`) derived from `$DASHBOARD_DIR`. No hardcoded paths.

### `.claude/settings.json` (project-level, committed)

Documents the hook structure as a template. Contains placeholder paths — `install.sh` is the actual installer, not this file.

### `install.sh`

Runs from repo root. Steps:

1. Detect `DASHBOARD_DIR=$PWD`
2. `chmod +x .claude/hooks/*.sh`
3. Read `~/.claude/settings.json` (or `{}` if missing)
4. Merge `UserPromptSubmit` and `Stop` hook entries with absolute script paths using `jq`
5. Write back to `~/.claude/settings.json`
6. Copy `dashboard-config.example.json` → `dashboard-config.json` if not present
7. Install git hooks (see §4)
8. Print summary + "Restart Claude Code to activate hooks"

**Merge strategy:** if a hook entry for the same script path already exists, skip (idempotent). If a hook for the same event exists with a different command, append alongside (don't replace).

---

## 4. Skills Management

### Directory

```
.claude/skills/           ← shared team skills, committed to repo
  <skill-name>/
    SKILL.md              ← standard frontmatter: name, description
```

Already discovered by `build-skills-data.mjs` (reads `{cwd}/.claude/skills/`).

### `sync-skills.sh`

```
./sync-skills.sh pull     # repo → ~/.claude/skills/ (repo wins per file)
./sync-skills.sh push     # ~/.claude/skills/ → .claude/skills/ (local wins per file), git add
./sync-skills.sh status   # diff only, no changes
```

**Pull logic:** for each file in `.claude/skills/**`, copy to `~/.claude/skills/` (create dirs as needed).  
**Push logic:** for each file in `~/.claude/skills/`, if content differs from `.claude/skills/` counterpart (or file is absent), copy and `git add`.  
**Conflict rule:** direction of operation wins. No interactive merge in v1.

### Git hooks (installed by `install.sh`)

- **`post-merge`**: calls `./sync-skills.sh pull` — auto-applies new repo skills after every pull
- **`pre-push`**: calls `./sync-skills.sh status` — prints unsynced local skills, non-blocking

If `.git/hooks/post-merge` already exists, `install.sh` appends a call rather than replacing.

---

## 5. File Inventory

| File | Status | Description |
|---|---|---|
| `dashboard-config.json` | new, gitignored | personal config |
| `dashboard-config.example.json` | new, committed | template + Filipe's current config |
| `dashboard.html` | modified | render from config |
| `.claude/hooks/on-prompt.sh` | new, committed | UserPromptSubmit logic |
| `.claude/hooks/on-stop.sh` | new, committed | Stop logic |
| `.claude/settings.json` | new, committed | hook structure template |
| `install.sh` | new, committed | wires everything |
| `sync-skills.sh` | new, committed | bidirectional skills sync |
| `.gitignore` | new/modified | ignore `dashboard-config.json` |

---

## 6. Out of Scope (v1)

- Multi-user conflict resolution for skills
- Skill discovery UI (covered by existing `skills.html`)
- Dashboard hot-reload on config change (page refresh is sufficient)
- Authentication / access control
- RTK plugin (does not exist)
