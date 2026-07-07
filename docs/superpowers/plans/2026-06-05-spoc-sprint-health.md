# SPOC Sprint Health Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `/spoc-sprint-health` skill that queries SPOC Hub 2.0, joins with JIRA SPOC for story points, and outputs a self-contained HTML sprint execution report.

**Architecture:** Single SKILL.md file at `~/.claude/skills/spoc-sprint-health/SKILL.md`. Three Airtable queries (SPOC Sprint Atual, JIRA SPOC join, Próximo Sprint count). HTML written to `/home/snake/fbsoares/Dashboard/spoc-sprint-report.html`.

**Tech Stack:** Airtable MCP, pure HTML/CSS/JS (no external dependencies), same stack as `spoc-backlog-health`.

---

## File Structure

- Create: `/home/snake/.claude/skills/spoc-sprint-health/SKILL.md`

---

### Task 1: Create the skill file

**Files:**
- Create: `/home/snake/.claude/skills/spoc-sprint-health/SKILL.md`

- [ ] **Step 1: Create the skills directory**

```bash
mkdir -p /home/snake/.claude/skills/spoc-sprint-health
```

- [ ] **Step 2: Write SKILL.md**

Write the following content to `/home/snake/.claude/skills/spoc-sprint-health/SKILL.md`:

```markdown
---
name: spoc-sprint-health
description: Use when asked for sprint health, sprint execution status, story points by status or assignee, sprint progress, allocation gaps, or "how is the current sprint going". Triggers on phrases like "sprint health", "sprint status", "sprint atual", "sprint progress", "story points", "effort by assignee".
---

# SPOC Sprint Health Analysis

## Overview

Queries SPOC Hub 2.0 (SPOC table filtered to Sprint Atual) and JIRA SPOC table (story points), then outputs a self-contained HTML sprint execution report.

Complements `spoc-backlog-health` (time-window view) with sprint-scoped execution view.

## Trigger

`/spoc-sprint-health` — no arguments. Auto-detects active sprint name from JIRA Sprint field.

---

## Airtable Configuration

| Key | Value |
|---|---|
| Base | SPOC Hub 2.0 |
| Base ID | `appm7sm3GMMeQisUk` |
| Primary table | SPOC (`tblUWBV2EJwOKKicA`) |
| Secondary table | JIRA SPOC (`tblrg8uqtaSbOEJWP`) |

---

## Query Strategy (3-step)

### Step 1 — SPOC table (Sprint Atual)

Filter `fldu0io5kpmgv67b9 = sela7Wc7JjKdMEsiV` (Sprints = "Sprint Atual"), pageSize 200.

Fields to fetch:

| Field ID | Name |
|---|---|
| `fldvwfCAqi9zSqDB9` | SPOC ID |
| `fld8gqM7SzxZPZFzT` | Client Name |
| `fldoOBPaSor5zvUFq` | Subject |
| `fldANMNML2wtDMpvb` | SPOC Support Status |
| `fldvbHi0m0RDJDv53` | Issue Type |
| `fldEpjhP0XMuPrP1n` | Product |
| `fldC6Btl520GMBMci` | Created |
| `fldGqZuu9ssSJRl64` | Support POC |
| `fldzz6wWtMHUkWA9C` | Requestor |
| `fldh7hCKqaa2YPGyA` | Ticket Age |
| `fldKquALsc1BXPygh` | Data da Mudança de Status |
| `fld1zjrQBz03jnwBu` | JIRA Status |
| `fldnsZAuwGDdRWWxK` | JIRA URL |
| `fldz1Ea1qbgPJcY5V` | SPOC_JIRA_ID |
| `fldqg4rsVMtM4Ui1R` | Tech Priority |
| `fldTL2JgVukfLrvMp` | JIRA Sprint |
| `fldwNDXZXAAJjYCyX` | Tech Feedback |
| `fldmdfco877aTsfkL` | JIRA Ticket link |
| `fldu0io5kpmgv67b9` | Sprints |

Filter JSON:
```json
{
  "filters": {
    "operator": "and",
    "operands": [
      {
        "operator": "=",
        "operands": ["fldu0io5kpmgv67b9", "sela7Wc7JjKdMEsiV"]
      }
    ]
  },
  "sort": [{"fieldId": "fldC6Btl520GMBMci", "direction": "desc"}]
}
```

### Step 2 — JIRA SPOC table (story points)

For each record in Step 1 results that has a non-empty `fldmdfco877aTsfkL`, collect the linked record IDs. Query JIRA SPOC table to fetch those records.

Fields to fetch:

| Field ID | Name |
|---|---|
| `fld5SogEhbO90ujKK` | JIRA_SPOC_ID (join key) |
| `fldyONASN7rxmvGR3` | Issue Key |
| `fldcBjKrFoqkyEakM` | Sprint (name) |
| `fldTrHMkS79ZqWAkx` | Story point estimate |
| `fld9KtwxlmyutJ6rr` | Story Points |
| `fldZBVD5tzLI7LOrh` | Status |
| `fldeSRHdIWogu8QT1` | Priority |
| `fldiG05GXIvzoLvQl` | Assignee |

**Join:** `fldz1Ea1qbgPJcY5V` (SPOC_JIRA_ID) ↔ `fld5SogEhbO90ujKK` (JIRA_SPOC_ID)

**Story points logic:** use `fld9KtwxlmyutJ6rr` (Story Points) if present and > 0, fallback to `fldTrHMkS79ZqWAkx` (Story point estimate).

### Auto-detect sprint name

Most common non-empty value in `fldTL2JgVukfLrvMp` (JIRA Sprint) across Step 1 results. Display in report header.

### Step 3 — Próximo Sprint (lightweight count)

Single query on SPOC table filtered by `fldu0io5kpmgv67b9 = selaccQjFFWeJqEKV` (Próximo Sprint). Fields: `fldqg4rsVMtM4Ui1R` (Tech Priority), `fldTL2JgVukfLrvMp` (JIRA Sprint), `fldmdfco877aTsfkL` (JIRA Ticket link). pageSize 200.

From results compute:
- Total Próximo Sprint count
- Estimated count: tickets that have a linked JIRA record (non-empty `fldmdfco877aTsfkL`) AND where the joined JIRA SP > 0
- Needs estimate count: SP = 0 or empty, or no JIRA link

---

## Large Result Handling

If Airtable result exceeds token limit, save raw JSON to file and spawn a subagent with:
1. File path to the saved JSON
2. The complete analysis + HTML instructions from this skill
3. Instruction to write HTML to `/home/snake/fbsoares/Dashboard/spoc-sprint-report.html` AND return markdown summary

---

## Status Categories

**Done** = Closed (`selOSfHDbABV0fAWr`) + Canceled (`selcjeyzLpVlzF3Pc`) + Duplicated (`selWqJptAvJZ854M6`)

**Not Done** = all other values

---

## Analysis Sections

### 1. Overview cards
- Total SPOCs in Sprint Atual
- Total story points committed (sum across all linked JIRA records)
- SP done % = SP of done SPOC tickets / total SP × 100
- SP remaining = total SP − SP done
- Allocation gap count (Sprint Atual + no JIRA link)

### 2. Effort by SPOC Status
Per SPOC status: ticket count, total SP, % of sprint SP.
Sort by total SP desc. CSS progress bar (width = % of max SP row).
Color badges: Tech Pending=`#f59e0b`, On Hold=`#6b7280`, Client Pending=`#3b82f6`, Open=`#10b981`, BIZ Pending=`#ef4444`, default=`#6b7280`.

### 3. Effort by Assignee (Support POC)
Per POC: ticket count, total SP, SP done (tickets in done statuses), SP remaining, % progress.
Sort by total SP desc. CSS progress bar showing done/remaining split.

### 4. JIRA Status breakdown
Per JIRA status value: count + total SP. Flags what's blocking sprint completion.
Colors: Open=`#6b7280`, BIZ PENDING=`#ef4444`, CODE REVIEW=`#8b5cf6`, TO DESCRIBE=`#f59e0b`, no JIRA=`#dc2626`.

### 5. Allocation gaps
Tickets with `Sprints = Sprint Atual` but empty `fldmdfco877aTsfkL` (no JIRA link).
Columns: SPOC ID, Client, Subject, SPOC Status, POC, Age.
Critical flag — sprint commitments with no JIRA ticket.

### 6. Full ticket list
All Sprint Atual tickets sorted by SP desc (no-SP tickets at bottom).
Columns: SPOC ID, Client, Subject, SPOC Status, JIRA ID, JIRA Status, SP, Tech Priority, POC.
Flag tickets with SP = 0 or empty with ⚠️.

### 7. Próximo Sprint pulse
Metric cards only (no table):
- Total Próximo Sprint tickets
- Estimated (SP > 0)
- Needs estimate (SP = 0 or empty)

---

## HTML Output Format

Single self-contained HTML file. No external dependencies — all CSS inline in `<style>` tag.

Requirements:
- Dark mode default with light/dark toggle
- Metric cards at top (overview section)
- Sections as `<details open>` collapsible elements
- Tables: striped rows, sticky header, sortable (pure JS, no library)
- CSS progress bars for effort by status/assignee (no JS charting library, use `width: X%` on a colored div)
- Flags section: bold red for critical, yellow for warning
- Report timestamp + sprint name in header (generated: `<date>`, sprint: `<sprint name>`)

**Output path:** `/home/snake/fbsoares/Dashboard/spoc-sprint-report.html`

---

## Chat Summary (after report)

After writing the HTML file, print this markdown summary in chat:

```
## SPOC Sprint Health — <sprint name>

**Sprint Atual:** <N> tickets | <SP> SP committed | <SP done>/<SP total> done (<%)
**Allocation gaps:** <N> tickets with no JIRA
**Top flag:** <most urgent single finding>

Report saved → /home/snake/fbsoares/Dashboard/spoc-sprint-report.html
```

---

## Default Thresholds

| Threshold | Default |
|---|---|
| Time zone | Europe/Lisbon |
| "Missing SP" | SP = 0 or empty |
| "Allocation gap" | Sprint Atual + no JIRA link |
```

- [ ] **Step 3: Verify file was written**

```bash
cat /home/snake/.claude/skills/spoc-sprint-health/SKILL.md | head -5
```

Expected: frontmatter with `name: spoc-sprint-health`.

- [ ] **Step 4: Commit**

```bash
cd /home/snake/.claude
git add skills/spoc-sprint-health/SKILL.md
git commit -m "feat: add spoc-sprint-health skill"
```

---

### Task 2: Smoke test the skill

- [ ] **Step 1: Invoke the skill**

In Claude Code, run: `/spoc-sprint-health`

Expected: skill loads, queries Airtable SPOC table with Sprint Atual filter, fetches JIRA SPOC story points, writes HTML to `/home/snake/fbsoares/Dashboard/spoc-sprint-report.html`, prints markdown summary.

- [ ] **Step 2: Verify HTML output**

```bash
ls -lh /home/snake/fbsoares/Dashboard/spoc-sprint-report.html
```

Expected: file exists, non-zero size.

- [ ] **Step 3: Spot-check HTML structure**

```bash
grep -c "<details" /home/snake/fbsoares/Dashboard/spoc-sprint-report.html
```

Expected: 7 or more `<details>` elements.

- [ ] **Step 4: Verify metric cards present**

```bash
grep "metric-card\|overview" /home/snake/fbsoares/Dashboard/spoc-sprint-report.html | head -3
```

Expected: metric card elements found.

---

### Task 3: Update MEMORY.md

- [ ] **Step 1: Add skill to memory index**

Check `/home/snake/.claude/projects/-home-snake-fbsoares-Dashboard/memory/MEMORY.md` and add an entry for the new skill if not already present.

- [ ] **Step 2: Write project memory**

If no memory file exists for this skill, create one noting the skill exists and its trigger.
