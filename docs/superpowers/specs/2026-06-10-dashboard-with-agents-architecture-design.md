# Dashboard With Agents Architecture — Design Spec

**Date:** 2026-06-10  
**Status:** Draft  

---

## Overview

Restructure the personal dashboard into three focused views (Work, Personal, Agents) served as separate HTML pages sharing a common top nav bar. Extend the backend API to support namespaced personal data and a session registry for manual agent session tracking. Extend the session dashboard to show active sessions across Claude CLI, Gemini CLI, and manually registered tools (Antigravity, Edgar, etc.).

---

## 1. Navigation & File Structure

### Approach
Separate HTML pages with a shared `nav.js` that injects a top nav bar into each page. No router, no SPA — plain `<a href>` links.

### File Layout

```
dashboard-work.html       ← current dashboard.html renamed and refocused
dashboard-personal.html   ← new personal life view
dashboard-agents.html     ← new agents view (extends session-dashboard.html)
nav.js                    ← shared nav bar rendered by all three pages
session-dashboard.html    ← kept as-is, linked from Agents dashboard
skills.html               ← kept as-is, no changes
```

### Nav Bar

`nav.js` exports a `renderNav(activeTab)` function called on page load. Renders a fixed top strip with three tabs:

| Tab | Accent | Page |
|-----|--------|------|
| Work | `#4a9eff` | `dashboard-work.html` |
| Personal | `#f59e0b` | `dashboard-personal.html` |
| Agents | `#a78bfa` | `dashboard-agents.html` |

Active tab is highlighted. All other dashboard chrome (grid bg, fonts, shell padding) unchanged.

---

## 2. Work Dashboard (`dashboard-work.html`)

Current `dashboard.html` with these changes:
- Add `renderNav('work')` call
- Remove `home` and `gaming` sections (moved to Personal)
- All other sections unchanged: checklist, announcements, agents links, code, wip/sprints, data, infra, reports, news, music
- Existing data files untouched: `data/checklist.json`, `data/news.json`, `data/music.json`, `data/announcements.json`
- Existing API routes untouched: `/api/checklist`, `/api/news`, `/api/music`, `/api/announcements`

`dashboard-config.json` gains `"tab": "work"` on all current sections for clarity.

---

## 3. Personal Dashboard (`dashboard-personal.html`)

New page using the same grid system and component patterns. Sections:

| Section | Type | Accent |
|---------|------|--------|
| Personal Checklist | checklist | `#facc15` |
| Personal Announcements | announcements | `#f97316` |
| Personal News | news | `#38bdf8` |
| Personal Music | music | `#c084fc` |
| Home | links | `#f59e0b` |
| Gaming | links | `#f43f5e` |

Home and Gaming sections moved from Work, content unchanged.

### New Data Files

```
data/personal-checklist.json      ← empty array initially
data/personal-news.json           ← empty array initially
data/personal-music.json          ← empty array initially
data/personal-announcements.json  ← empty array initially
```

All existing `data/*.json` files kept intact — no migration.

### New API Routes (`server.py`)

```
GET    /api/personal/checklist
POST   /api/personal/checklist
PATCH  /api/personal/checklist/:id
DELETE /api/personal/checklist/:id

GET    /api/personal/news
POST   /api/personal/news
DELETE /api/personal/news/:id

GET    /api/personal/music
POST   /api/personal/music
DELETE /api/personal/music/:id

GET    /api/personal/announcements
POST   /api/personal/announcements
DELETE /api/personal/announcements/:id
```

Same shape as existing work routes. Work routes (`/api/checklist`, etc.) unchanged.

### Dashboard Config

`dashboard-config.json` gains `"tab": "personal"` on personal sections. The dashboard-manager skill is updated to pass `context: "work"|"personal"` when creating tasks/news/music so it targets the right route.

---

## 4. Agents Dashboard (`dashboard-agents.html`)

Three panels stacked vertically, with `renderNav('agents')` at top.

### Panel 1 — Agent Tools (links)

Config-driven link section (same pattern as existing link sections). Quick-launch shortcuts:

| Icon | Name | URL |
|------|------|-----|
| ◈ | Claude | claude.ai/new |
| ✦ | Gemini CLI | gemini.google.com |
| 🌀 | Antigravity | (Antigravity web entry point) |
| ⚡ | Edgar | edgar.dig-in.io |
| ◈ | Sessions | session-dashboard.html |
| ⚡ | Skills | skills.html |

Defined in `dashboard-config.json` under the existing `agents` section (extended).

### Panel 2 — Active Sessions (live, auto-refresh)

Compact cards grid — only sessions where `active: true`. Renders on page load and polls every 30s.

Data sources merged in the browser:
1. `session-data.json` — Claude + Gemini CLI sessions (file-parsed, built by `build-session-data.mjs`)
2. `GET /api/sessions` — manually registered sessions (Antigravity, Edgar, other)

Each card shows:
- Provider badge: `claude` (coral) · `gemini` (blue) · `edgar` (green `#22c55e`) · `antigravity` (amber `#f59e0b`) · `other` (muted)
- Session name
- cwd or notes field
- Last prompt snippet (if available)
- Active/ended tag
- Click → opens `rc_url` or relevant tool URL

### Panel 3 — Register Session (inline form)

Always visible, no modal. Fields:

```
Provider: [dropdown: edgar | antigravity | other]
Name:      [text]
Notes:     [text — what I'm doing]
[Start Session]   [End Session (by selecting active card)]
```

"End Session" — clicking an active card from the manual registry shows an End button on the card itself.

---

## 5. Session Registry API

New routes added to `server.py`. Manual sessions stored in `data/sessions-registry.json`.

```
GET    /api/sessions          list all (supports ?active=true query param)
POST   /api/sessions          register { provider, name, notes }
PATCH  /api/sessions/:id      update { status, notes }
DELETE /api/sessions/:id      remove entry
```

Auto-generates `id` (UUID) and `started_at` on POST. Sets `ended_at` on PATCH with `status: "ended"`.

Claude and Gemini CLI sessions are **not** stored here — they come from file parsing. The registry is for tools that cannot self-report (Antigravity, any other manual entry).

---

## 6. Gemini CLI Sessions (existing spec)

Already fully designed in `docs/superpowers/specs/2026-06-06-shared-claude-gemini-sessions.md`. Implementation is part of this work:
- Extend `build-session-data.mjs` with `parseGeminiTranscript` scanning `~/.gemini/tmp/`
- Add `provider: "gemini"` field to session objects
- Style Gemini cards with blue accent in session dashboard

---

## 7. Future: Edgar Auto-Registration

Edgar (`agentf`) can be adapted in the future to auto-register sessions by adding a fire-and-forget HTTP call to `POST /api/sessions` at agent invocation start/end in `Summoner.summon_agent()`. A `DashboardSessionLogger` utility in `agentf/integrations/` would handle this with a short timeout so Edgar has no hard dependency on the dashboard being available. Not in scope for this implementation — manual registration covers the need for now.

---

## 8. dashboard-config.json Changes

```json
{
  "sections": [
    { ..., "tab": "work" },
    { "id": "personal-checklist", "type": "checklist", "tab": "personal", ... },
    { "id": "personal-news",      "type": "news",      "tab": "personal", ... },
    { "id": "agents",             "tab": "agents",     "links": [...] }
  ]
}
```

Each section gains a `"tab"` field. Pages filter sections by tab at render time.

---

## 9. Files Changed / Created

| File | Action |
|------|--------|
| `dashboard.html` | Rename → `dashboard-work.html`, add nav, remove home/gaming |
| `dashboard-personal.html` | New |
| `dashboard-agents.html` | New (extends session-dashboard.html patterns) |
| `nav.js` | New |
| `session-dashboard.html` | Kept as-is |
| `server.py` | Add `/api/personal/*` routes + `/api/sessions` CRUD |
| `build-session-data.mjs` | Add Gemini CLI parsing (from existing spec) |
| `dashboard-config.json` | Add `tab` field, personal sections, agents links update |
| `data/personal-*.json` | New empty files (4 files) |
| `data/sessions-registry.json` | New empty file |

---

## 10. Out of Scope

- Antigravity `.pb` file parsing — binary protobuf, no schema available
- Edgar code changes — deferred to future
- `skills.html` — no changes
- `reports/` — no changes
- Existing work data files — no migration, no changes
