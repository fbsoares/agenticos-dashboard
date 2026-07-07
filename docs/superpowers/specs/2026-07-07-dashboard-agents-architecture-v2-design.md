# Dashboard With Agents Architecture (v2: Antigravity auto-parse, no Gemini) — Design Spec

**Date:** 2026-07-07
**Status:** Approved
**Supersedes:** `2026-06-10-dashboard-with-agents-architecture-design.md` (§5, §6, §10 revised below)
**Not implemented:** `2026-06-06-shared-claude-gemini-sessions.md` (dropped — user does not use Gemini CLI, uses Antigravity/`agy` instead)

---

## Overview

Restructure the personal dashboard into three focused views (Work, Personal, Agents) served as separate HTML pages sharing a common top nav bar. Extend the backend API to support namespaced personal data and a session registry for tools that cannot self-report. Extend the session dashboard to show active sessions across Claude CLI and Antigravity CLI (`agy`), both auto-parsed from disk, plus manually registered tools (Edgar, other).

This revises the 2026-06-10 spec in one respect: Antigravity was originally planned as manual-registration-only because its `conversations/*.db` files are SQLite blobs of undocumented protobuf. Investigation (2026-07-07) found a parallel plain-jsonl transcript log that makes auto-parsing straightforward — see §5a.

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

All existing `data/*.json` files kept intact — no migration. Files are created lazily by the API on first write if missing, matching the existing `server.py` pattern for `data/checklist.json` et al. — do not pre-create them differently.

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

Same shape as existing work routes — reuse existing handler logic, parameterized by namespace, rather than duplicating per-route bodies. Work routes (`/api/checklist`, etc.) unchanged.

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
| 🌀 | Antigravity | `TBD` |
| ⚡ | Edgar | edgar.dig-in.io |
| ◈ | Sessions | session-dashboard.html |
| ⚡ | Skills | skills.html |

Antigravity is CLI-only today, no web entry point exists (confirmed with user). The link is left as `TBD` in `dashboard-config.json` — either omit the link row entirely at implementation time, or wire it up if/when Google ships a hosted URL. Same `TBD` applies to the click-through fallback in Panel 2.

Defined in `dashboard-config.json` under the existing `agents` section (extended). No Gemini CLI row (dropped from scope).

### Panel 2 — Active Sessions (live, auto-refresh)

Compact cards grid — only sessions where `active: true`. Renders on page load and polls every 30s.

Data sources merged in the browser:
1. `session-data.json` — Claude + Antigravity sessions (file-parsed, built by `build-session-data.mjs`)
2. `GET /api/sessions` — manually registered sessions (Edgar, other)

Each card shows:
- Provider badge: `claude` (coral) · `antigravity` (amber `#f59e0b`) · `edgar` (green `#22c55e`) · `other` (muted)
- Session name (Antigravity: none available, omit — do not fabricate one)
- cwd or notes field
- Last prompt snippet (if available)
- Active/ended tag
- Click → opens `rc_url` if present, else the provider's static tool URL from Panel 1 config. Antigravity has no web entry point (`TBD`, CLI-only tool) — its cards render without a click-through link until/unless one exists.

### Panel 3 — Register Session (inline form)

Always visible, no modal. Fields:

```
Provider: [dropdown: edgar | other]
Name:      [text]
Notes:     [text — what I'm doing]
[Start Session]   [End Session (by selecting active card)]
```

Antigravity is no longer in this dropdown — it self-reports via §5a. "End Session" — clicking an active card from the manual registry shows an End button on the card itself.

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

Claude and Antigravity sessions are **not** stored here — they come from file parsing (§5a). The registry is for tools that cannot self-report (Edgar, any other manual entry).

---

## 5a. Antigravity CLI (`agy`) Session Auto-Parsing

Extends `build-session-data.mjs` with a new `parseAntigravityTranscript()` alongside the existing Claude `parseTranscript()`. Both write into the same `session-data.json`, each entry tagged with a `provider` field (`"claude"` or `"antigravity"`) — this field does not currently exist and must be added to Claude's output too, so the frontend can badge/filter by provider consistently.

### Why this is feasible without touching the SQLite/protobuf store

`agy` (Google's Antigravity CLI, distinct from `gemini` — verified as separate binaries, separate storage) keeps two representations of each conversation under `~/.gemini/antigravity-cli/`:

1. `conversations/<id>.db` — SQLite, but payload columns (`steps.step_payload`, etc.) are opaque protobuf blobs with no public `.proto` schema. **Not used.**
2. `brain/<id>/.system_generated/logs/transcript.jsonl` — plain JSON Lines, one object per step: `{step_index, source, type, status, content, created_at}`. `<id>` here is the same conversation id used as the `.db` filename and as `history.jsonl`'s `conversationId`. **This is what we parse.**

Root-level `history.jsonl` (`{display, timestamp, workspace, conversationId}`) is the only place `cwd` is recorded per conversation — `transcript.jsonl` itself has no cwd field.

### Discovery & fields

- **Scan** `~/.gemini/antigravity-cli/brain/*/`. Each `<uuid>` dir name is the `session_id`.
- **Skip** dirs with no `.system_generated/logs/transcript.jsonl` (empty/aborted conversations — observed 4 of 24 on this machine).
- **Build a `conversationId → workspace` map once** from root `history.jsonl` (small file, read in full) before iterating brain dirs.
- **Per session**, stream `transcript.jsonl`:
  - `first_active` / `last_active` = `created_at` of first / last line.
  - `last_prompt` = `content` of the last line where `source === "USER_EXPLICIT" && type === "USER_INPUT"`, with the `<USER_REQUEST>...</USER_REQUEST>` wrapper stripped via regex, truncated to 160 chars (mirrors Claude's `last_prompt` truncation) — collapse newlines the same way Claude's parser does.
  - `cwd` = lookup in the `history.jsonl`-derived map by session_id; `null` if absent (card omits the cwd line, same as Claude's fallback behavior when cwd is unknown).
  - `model`: omitted. No reliable structured field — only appears embedded in a `USER_SETTINGS_CHANGE` sentence inside `content`, not worth regexing for v1.
  - `active`: recency heuristic — `last_active` within 2 hours ⇒ `true`. Antigravity has no hook system (unlike Claude's `on-prompt.sh`/`on-stop.sh`), so there is no stronger "is this PID still running" signal available; this is the same fallback Claude's own parser already uses when no hook entry exists.
  - `rc_url`: always `null` — no per-session deep link exists. Frontend falls back to the static Antigravity entry point (Panel 1 config) on click.
  - `name`: always `null` — no session-naming concept in Antigravity's data. Do not fabricate a name from cwd or id.
- **Error handling**: wrap each transcript read in try/catch identical to the existing `parseTranscript` — unreadable file or corrupt line is skipped, not fatal to the whole scan.

### Provider field on Claude entries

Add `provider: "claude"` to the object returned by the existing `parseTranscript()` in `build-session-data.mjs`. This is the only change needed to Claude's parsing path.

---

## 6. Gemini CLI Sessions — dropped from scope

`docs/superpowers/specs/2026-06-06-shared-claude-gemini-sessions.md` is **not implemented and not planned**. User does not use the Gemini CLI; Antigravity (§5a above) covers the equivalent need. That spec is left as historical record only.

---

## 7. Future: Edgar Auto-Registration

Edgar (`agentf`) can be adapted in the future to auto-register sessions by adding a fire-and-forget HTTP call to `POST /api/sessions` at agent invocation start/end in `Summoner.summon_agent()`. A `DashboardSessionLogger` utility in `agentf/integrations/` would handle this with a short timeout so Edgar has no hard dependency on the dashboard being available. Not in scope for this implementation — manual registration covers the need for now.

---

## 8. dashboard-config.json Changes

```json
{
  "sections": [
    { "...": "...", "tab": "work" },
    { "id": "personal-checklist", "type": "checklist", "tab": "personal", "...": "..." },
    { "id": "personal-news",      "type": "news",      "tab": "personal", "...": "..." },
    { "id": "agents",             "tab": "agents",     "links": [
      { "icon": "◈", "name": "Claude", "url": "https://claude.ai/new" },
      { "icon": "🌀", "name": "Antigravity", "url": null },
      { "icon": "⚡", "name": "Edgar", "url": "https://edgar.dig-in.io" },
      { "icon": "◈", "name": "Sessions", "url": "session-dashboard.html" },
      { "icon": "⚡", "name": "Skills", "url": "skills.html" }
    ] }
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
| `build-session-data.mjs` | Add `parseAntigravityTranscript()`; add `provider` field to Claude entries |
| `dashboard-config.json` | Add `tab` field, personal sections, agents links update |
| `data/personal-*.json` | New, created lazily on first write (4 files) |
| `data/sessions-registry.json` | New empty file |

---

## 10. Out of Scope

- Antigravity `.db`/protobuf parsing — unnecessary, `transcript.jsonl` supersedes it (§5a)
- Antigravity model/name extraction — no reliable field, deferred
- Gemini CLI parsing — dropped, user doesn't use it (§6)
- Edgar code changes — deferred to future (§7)
- Multi-user conflict resolution for skills
- Skill discovery UI (covered by existing `skills.html`)
- Dashboard hot-reload on config change (page refresh is sufficient)
- Authentication / access control
- `skills.html`, `reports/` — no changes
- Existing work data files — no migration, no changes

---

## 11. Testing Plan

No automated test suite in this repo; verification is manual:

1. Run `node build-session-data.mjs` → inspect `session-data.json`, confirm `provider: "antigravity"` entries appear with correct `cwd` / `last_prompt` / `active`, and existing `provider: "claude"` entries still appear correctly.
2. Start `server.py`, exercise `/api/personal/*` and `/api/sessions` routes with curl (CRUD roundtrip, confirm lazy file creation).
3. Load all three pages in a browser: confirm nav highlights correctly, sections render filtered by `tab`, personal checklist writes don't affect the work checklist, Agents page shows both auto-parsed and manually registered sessions correctly badged.
