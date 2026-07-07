# SPOC Sprint Health — Design Spec

**Date:** 2026-06-05
**Status:** Approved

## Overview

A skill that produces a sprint execution health report for the current sprint. Filters SPOC Hub 2.0 by `Sprints = "Sprint Atual"`, joins with JIRA SPOC table to pull story points, and outputs a self-contained HTML report with effort breakdowns by status and assignee.

Complements `spoc-backlog-health` (time-window view) with a sprint-scoped execution view.

---

## Trigger

`/spoc-sprint-health` — no arguments needed. Auto-detects the active sprint name from the JIRA Sprint lookup field.

---

## Airtable Configuration

| Key | Value |
|---|---|
| Base | SPOC Hub 2.0 |
| Base ID | `appm7sm3GMMeQisUk` |
| Primary table | SPOC (`tblUWBV2EJwOKKicA`) |
| Secondary table | JIRA SPOC (`tblrg8uqtaSbOEJWP`) |

---

## Query Strategy (2-step)

### Step 1 — SPOC table

Filter `fldu0io5kpmgv67b9 = sela7Wc7JjKdMEsiV` (Sprints = "Sprint Atual"), pageSize 200.

Fields to fetch (all 18 from backlog skill + Sprints):

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
| `fldu0io5kpmgv67b9` | Sprints (sprint decision) |

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

### Step 2 — JIRA SPOC table

Fetch records linked via `fldmdfco877aTsfkL` (record IDs collected from Step 1 results).

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

**Story points logic:** use `Story Points` if present, fallback to `Story point estimate`.

### Auto-detect sprint name

Most common non-empty value in `fldTL2JgVukfLrvMp` (JIRA Sprint) across Step 1 results. Display in report header.

---

## Analysis Sections

### 1. Overview cards
- Total SPOCs in Sprint Atual
- Total story points committed (sum of SP for all tickets)
- Story points done % (SP of closed/done SPOC tickets / total SP)
- Story points remaining
- Allocation gap count (Sprint Atual but no linked JIRA record)

### 2. Effort by SPOC Status
- Story points per SPOC status, sorted by SP desc
- Show: status name, ticket count, total SP, % of sprint SP
- Color-coded badges (same palette as backlog-health)
- Bar-style visual in HTML (CSS width %, no JS charting)

### 3. Effort by Assignee (Support POC)
- Per POC: ticket count, total SP, SP done (tickets in done statuses), SP remaining, % progress
- Done statuses: Closed (`selOSfHDbABV0fAWr`), Canceled (`selcjeyzLpVlzF3Pc`), Duplicated (`selWqJptAvJZ854M6`)
- Sort by total SP desc

### 4. JIRA Status breakdown
- Count + total SP per JIRA status value
- Flags what's blocking sprint completion
- Color-coded (same as backlog-health: Open=`#6b7280`, BIZ PENDING=`#ef4444`, CODE REVIEW=`#8b5cf6`, TO DESCRIBE=`#f59e0b`)

### 5. Allocation gaps
- Tickets with `Sprints = Sprint Atual` but empty `fldmdfco877aTsfkL` (no JIRA link)
- Columns: SPOC ID, Client, Subject, SPOC Status, POC, Age
- These are sprint commitments with no JIRA ticket — critical flag

### 6. Full ticket list
- All Sprint Atual tickets sorted by SP desc (no-SP tickets at bottom)
- Columns: SPOC ID, Client, Subject, SPOC Status, JIRA ID, JIRA Status, SP, Tech Priority, POC
- Flag tickets with no SP with ⚠️

### 7. Próximo Sprint pulse (lightweight)
- Count of tickets with `Sprints = "Próximo Sprint"` (`selaccQjFFWeJqEKV`)
- How many have SP > 0 (estimated) vs SP = 0/empty (need estimate)
- No full table — just metric cards

---

## Status Categories

**Done** = Closed (`selOSfHDbABV0fAWr`) + Canceled (`selcjeyzLpVlzF3Pc`) + Duplicated (`selWqJptAvJZ854M6`)

**Not Done** = all other values

---

## HTML Output Format

Same spec as `spoc-backlog-health`:
- No external dependencies — all CSS inline
- Dark mode default, light/dark toggle
- Metric cards at top (overview)
- Sections as `<details open>` collapsible elements
- Tables: striped rows, sticky header, sortable (pure JS, no library)
- CSS progress bars for effort by status/assignee (no JS charting library)
- Flags section: bold red for critical, yellow for warning
- Report timestamp + sprint name in header

**Output path:** `/home/snake/fbsoares/Dashboard/spoc-sprint-report.html`

---

## Large Result Handling

Same pattern as `spoc-backlog-health`: if Airtable result exceeds token limit, save to file and spawn subagent with file path + full analysis instructions. Subagent writes HTML AND returns markdown summary.

---

## Chat Summary (after report)

```
## SPOC Sprint Health — <sprint name>

**Sprint Atual:** <N> tickets | <SP> SP committed | <SP done>/<SP total> done (<%)
**Allocation gaps:** <N> tickets with no JIRA
**Top flag:** <most urgent single finding>

Report saved → /home/snake/fbsoares/Dashboard/spoc-sprint-report.html
```

---

## Próximo Sprint query (Step 3, lightweight)

Single count query on SPOC table filtered by `fldu0io5kpmgv67b9 = selaccQjFFWeJqEKV` (Próximo Sprint). Fields: `fldqg4rsVMtM4Ui1R` (Tech Priority), `fldTL2JgVukfLrvMp` (JIRA Sprint), `fldmdfco877aTsfkL` (JIRA Ticket link) — enough to compute estimated vs unestimated count from JIRA SP join.

---

## Thresholds

| Threshold | Default |
|---|---|
| Time zone | Europe/Lisbon |
| "Missing SP" | SP = 0 or empty |
| "Allocation gap" | Sprint Atual + no JIRA link |
