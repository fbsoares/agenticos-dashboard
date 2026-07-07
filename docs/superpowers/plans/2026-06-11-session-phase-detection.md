# Session Phase Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect and display a development phase badge (SPEC / PLAN / DEVELOPMENT / TEST / DEPLOY / RUNNING WORK) on each session card in the Sessions dashboard.

**Architecture:** `build-session-data.mjs` gains a `detectPhase()` function that scores signals from the transcript (skill invocations), git branch, session name, and last prompt — highest-confidence signal wins. The resulting `phase` string is added to each session object in `session-data.json`. `session-dashboard.html` renders a coloured phase tag on each card, adds phase filter buttons, and updates the stats row.

**Tech Stack:** Node.js ESM (build script), vanilla HTML/JS (dashboard), no new dependencies.

---

## File Map

| File | Change |
|---|---|
| `build-session-data.mjs` | Track `last_skill` during transcript parse; add `detectPhase(session)` function; populate `session.phase` |
| `session-dashboard.html` | CSS vars + `.tag.phase-*` styles; phase badge in `renderCard()`; phase filter buttons; `applyFilter()` update; `renderStats()` update |

---

## Task 1: Track last skill invocation in transcript parser

**Files:**
- Modify: `build-session-data.mjs:17-103`

- [ ] **Step 1: Add `last_skill` to the session object initialiser**

In `parseTranscript()`, add `last_skill: null` to the initial session object (line 17-25):

```js
const session = {
  session_id: basename(filePath, '.jsonl'),
  name: null, cwd: null, rc_url: null,
  first_active: null, last_active: null,
  git_branch: null, model: null,
  last_prompt: null,
  last_skill: null,
  ctx_tokens: 0, ctx_pct: 0,
  total_turns: 0,
};
```

- [ ] **Step 2: Extract last Skill tool call from assistant messages**

Inside the `if (type === 'assistant')` block (after line 84), add:

```js
if (type === 'assistant') {
  const msg = obj.message || {};
  if (msg.model) session.model = msg.model;
  if (!session.cwd && obj.cwd) session.cwd = obj.cwd;

  // detect skill invocations
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c.type === 'tool_use' && c.name === 'Skill' && c.input?.skill) {
        session.last_skill = c.input.skill;
      }
    }
  }

  const usage = msg.usage;
  // ... rest unchanged
```

- [ ] **Step 3: Verify `last_skill` is captured**

```bash
cd /home/snake/fbsoares/Dashboard && node build-session-data.mjs
node -e "
const d = JSON.parse(require('fs').readFileSync('session-data.json'));
d.sessions.filter(s => s.last_skill).forEach(s => console.log(s.name, '->', s.last_skill));
"
```

Expected: sessions that used skills (e.g. `writing-plans`, `brainstorming`) print their last skill name. Sessions with no skill show nothing.

- [ ] **Step 4: Commit**

```bash
git add build-session-data.mjs
git commit -m "feat(sessions): track last skill invocation in transcript parser"
```

---

## Task 2: Add `detectPhase()` and populate `session.phase`

**Files:**
- Modify: `build-session-data.mjs:104` (insert before `loadHookSessions`)

- [ ] **Step 1: Add the `PHASE_SIGNALS` constant and `detectPhase()` function**

Insert after line 103 (after the `return session;` closing brace of `parseTranscript`):

```js
const PHASE_SIGNALS = {
  SPEC: {
    skills: ['superpowers:brainstorming'],
    branch: /^(spec|prd|requirements|rfc|proposal|docs)\//i,
    name: /\b(spec|prd|requirements?|rfc|proposal|brief|discover)\b/i,
    prompt: /\b(spec|prd|requirements?|propose|define scope|write.*spec|spec.*for)\b/i,
  },
  PLAN: {
    skills: ['superpowers:writing-plans', 'superpowers:executing-plans'],
    branch: /^(plan|design|arch|architecture)\//i,
    name: /\b(plan|design|arch|architecture|roadmap|blueprint)\b/i,
    prompt: /\b(plan|design|architecture|how (should|do) we|approach|breakdown)\b/i,
  },
  DEVELOPMENT: {
    skills: ['superpowers:subagent-driven-development', 'superpowers:systematic-debugging', 'superpowers:test-driven-development'],
    branch: /^(feature|fix|bugfix|bug|refactor|chore|hotfix|improvement|wip)\//i,
    name: /\b(impl|implementation|feature|fix|bug|build|dev|refactor|migration|wip)\b/i,
    prompt: /\b(implement|add|fix|refactor|build|create|write (the|a) (code|function|class|component))\b/i,
  },
  TEST: {
    skills: ['superpowers:verification-before-completion'],
    branch: /^(test|testing|qa)\//i,
    name: /\b(test|tdd|qa|coverage|e2e|spec)\b/i,
    prompt: /\b(test|failing|coverage|unit test|integration test|e2e|assertion|mock)\b/i,
  },
  DEPLOY: {
    skills: ['superpowers:finishing-a-development-branch'],
    branch: /^(release|deploy|staging|infra|hotfix\/prod)\//i,
    name: /\b(deploy|release|ship|publish|prod|infra|ci|cd|pipeline)\b/i,
    prompt: /\b(deploy|release|ship|publish|production|rollout|ci\/cd|pipeline)\b/i,
  },
};

const SKILL_TO_PHASE = {};
for (const [phase, signals] of Object.entries(PHASE_SIGNALS)) {
  for (const skill of signals.skills) SKILL_TO_PHASE[skill] = phase;
}

function detectPhase(session) {
  let best = 'RUNNING WORK';
  let bestConf = 0;

  function score(phase, conf) {
    if (conf > bestConf) { best = phase; bestConf = conf; }
  }

  // 1. Skill invocation — highest confidence
  if (session.last_skill && SKILL_TO_PHASE[session.last_skill]) {
    score(SKILL_TO_PHASE[session.last_skill], 1.0);
  }

  // 2. Git branch
  if (session.git_branch) {
    for (const [phase, sig] of Object.entries(PHASE_SIGNALS)) {
      if (sig.branch.test(session.git_branch)) { score(phase, 0.85); break; }
    }
  }

  // 3. Session name keywords
  if (session.name) {
    for (const [phase, sig] of Object.entries(PHASE_SIGNALS)) {
      if (sig.name.test(session.name)) { score(phase, 0.65); break; }
    }
  }

  // 4. Last prompt keywords
  if (session.last_prompt) {
    for (const [phase, sig] of Object.entries(PHASE_SIGNALS)) {
      if (sig.prompt.test(session.last_prompt)) { score(phase, 0.45); break; }
    }
  }

  return best;
}
```

- [ ] **Step 2: Call `detectPhase()` after transcript parse and hook merge**

In `main()`, after the hook merge block (after line ~150, before `sessions.push(s)`), add:

```js
s.phase = detectPhase(s);
sessions.push(s);
```

Replace the existing `sessions.push(s)` line.

- [ ] **Step 3: Rebuild and verify phase assignment**

```bash
cd /home/snake/fbsoares/Dashboard && node build-session-data.mjs
node -e "
const d = JSON.parse(require('fs').readFileSync('session-data.json'));
const counts = {};
d.sessions.forEach(s => counts[s.phase] = (counts[s.phase]||0)+1);
console.log(counts);
d.sessions.slice(0,5).forEach(s => console.log(s.phase.padEnd(14), s.name || s.cwd?.split('/').pop()));
"
```

Expected: phase counts printed (e.g. `{ DEVELOPMENT: 12, PLAN: 3, 'RUNNING WORK': 8 }`). No session has `undefined` phase.

- [ ] **Step 4: Commit**

```bash
git add build-session-data.mjs
git commit -m "feat(sessions): detect and assign phase to each session"
```

---

## Task 3: Phase badge — CSS and rendering

**Files:**
- Modify: `session-dashboard.html` (`:root` block ~line 11; `.tag` styles ~line 202; `renderCard()` ~line 390)

- [ ] **Step 1: Add phase colour CSS variables to `:root`**

In the `:root` block (after `--accent-ctx-high` on line 28), add:

```css
--phase-spec:  #a78bfa;
--phase-plan:  #60a5fa;
--phase-dev:   #34d399;
--phase-test:  #f59e0b;
--phase-deploy:#f43f5e;
--phase-work:  #5a6070;
```

- [ ] **Step 2: Add `.tag.phase-*` styles**

After the `.tag.ended` rule (~line 208), add:

```css
.tag.phase { font-size: 0.58rem; letter-spacing: 0.08em; border-radius: 4px; padding: 1px 6px; }
.tag.phase-spec   { color: var(--phase-spec);   border: 1px solid rgba(167,139,250,0.3); background: rgba(167,139,250,0.06); }
.tag.phase-plan   { color: var(--phase-plan);   border: 1px solid rgba(96,165,250,0.3);  background: rgba(96,165,250,0.06);  }
.tag.phase-dev    { color: var(--phase-dev);    border: 1px solid rgba(52,211,153,0.3);  background: rgba(52,211,153,0.06);  }
.tag.phase-test   { color: var(--phase-test);   border: 1px solid rgba(245,158,11,0.3);  background: rgba(245,158,11,0.06);  }
.tag.phase-deploy { color: var(--phase-deploy); border: 1px solid rgba(244,63,94,0.3);   background: rgba(244,63,94,0.06);   }
.tag.phase-work   { color: var(--phase-work);   border: 1px solid var(--muted2);          background: transparent; opacity: 0.7; }
```

- [ ] **Step 3: Add `phaseTag()` helper function**

In the `<script>` block, after the `shortModel()` function (~line 377), add:

```js
function phaseTag(phase) {
  if (!phase || phase === 'RUNNING WORK') return '';
  const cls = {
    'SPEC': 'phase-spec', 'PLAN': 'phase-plan',
    'DEVELOPMENT': 'phase-dev', 'TEST': 'phase-test', 'DEPLOY': 'phase-deploy',
  }[phase] || 'phase-work';
  return `<span class="tag phase ${cls}">${phase}</span>`;
}
```

- [ ] **Step 4: Render phase badge in `renderCard()`**

In `renderCard()`, in the `.card-top` div (line 403-406), add `${phaseTag(s.phase)}` after the active/ended tag:

```js
      <div class="card-top">
        <span class="session-name${name ? '' : ' unnamed'}">${esc(name) || 'unnamed'}</span>
        <span class="tag ${isActive ? 'active' : 'ended'}">${isActive ? 'active' : 'ended'}</span>
        ${phaseTag(s.phase)}
      </div>
```

- [ ] **Step 5: Open browser and verify badges render**

Open `http://localhost:8765/session-dashboard.html`. Confirm:
- Each session card shows a coloured phase badge (or nothing for RUNNING WORK)
- Badge colours match the spec: violet=SPEC, blue=PLAN, green=DEVELOPMENT, amber=TEST, red=DEPLOY
- Badge appears between status tag and the rest of the card header

- [ ] **Step 6: Commit**

```bash
git add session-dashboard.html
git commit -m "feat(sessions): render phase badge on session cards"
```

---

## Task 4: Phase filter buttons

**Files:**
- Modify: `session-dashboard.html` (filters HTML ~line 328; `applyFilter()` ~line 437; `activeFilter` state ~line 343)

- [ ] **Step 1: Add a second filter row for phases**

In the HTML, replace the existing `<div class="filters" id="filters">` block (lines 328-334) with:

```html
<div class="filters" id="filters">
  <button class="filter-btn on" data-filter="all">All</button>
  <button class="filter-btn" data-filter="active">Active</button>
  <button class="filter-btn" data-filter="rc">Remote Control</button>
  <button class="filter-btn" data-filter="ended">Ended</button>
  <span class="filter-sep">|</span>
  <button class="filter-btn" data-filter="phase:SPEC">Spec</button>
  <button class="filter-btn" data-filter="phase:PLAN">Plan</button>
  <button class="filter-btn" data-filter="phase:DEVELOPMENT">Dev</button>
  <button class="filter-btn" data-filter="phase:TEST">Test</button>
  <button class="filter-btn" data-filter="phase:DEPLOY">Deploy</button>
  <input class="search-input" id="search-input" placeholder="filter by keyword…" autocomplete="off">
</div>
```

- [ ] **Step 2: Add `.filter-sep` CSS**

After the `.filter-btn:hover` rule (~line 109), add:

```css
.filter-sep { color: var(--muted2); font-size: 0.8rem; align-self: center; padding: 0 4px; }
```

- [ ] **Step 3: Update `applyFilter()` to handle phase filters**

Replace the `applyFilter()` function (lines 437-445):

```js
function applyFilter(sessions) {
  let out = sessions;
  if (activeFilter === 'active')  out = out.filter(s => s.active);
  else if (activeFilter === 'rc') out = out.filter(s => s.rc_url);
  else if (activeFilter === 'ended') out = out.filter(s => !s.active);
  else if (activeFilter.startsWith('phase:')) {
    const phase = activeFilter.slice(6);
    out = out.filter(s => s.phase === phase);
  }
  return out.filter(s => matchesQuery(s, activeQuery));
}
```

- [ ] **Step 4: Verify phase filter works**

Open `http://localhost:8765/session-dashboard.html`. Click "Dev" filter — only DEVELOPMENT sessions show. Click "All" — all sessions return. Search input still works combined with phase filter.

- [ ] **Step 5: Commit**

```bash
git add session-dashboard.html
git commit -m "feat(sessions): add phase filter buttons"
```

---

## Task 5: Phase counts in stats row

**Files:**
- Modify: `session-dashboard.html` — `renderStats()` ~line 466

- [ ] **Step 1: Update `renderStats()` to include active phase counts**

Replace the `renderStats()` function (lines 466-477):

```js
function renderStats(sessions) {
  const total = sessions.length;
  const active = sessions.filter(s => s.active).length;
  const rc = sessions.filter(s => s.rc_url).length;
  const avgCtx = sessions.length ? Math.round(sessions.reduce((a,s) => a + (s.ctx_pct||0), 0) / sessions.length) : 0;

  const phaseCounts = {};
  const phaseOrder = ['SPEC', 'PLAN', 'DEVELOPMENT', 'TEST', 'DEPLOY'];
  for (const s of sessions) if (s.phase && s.phase !== 'RUNNING WORK') phaseCounts[s.phase] = (phaseCounts[s.phase]||0)+1;
  const phaseChips = phaseOrder
    .filter(p => phaseCounts[p])
    .map(p => {
      const cls = {SPEC:'phase-spec',PLAN:'phase-plan',DEVELOPMENT:'phase-dev',TEST:'phase-test',DEPLOY:'phase-deploy'}[p];
      const label = {SPEC:'Spec',PLAN:'Plan',DEVELOPMENT:'Dev',TEST:'Test',DEPLOY:'Deploy'}[p];
      return `<div class="stat-chip"><span class="val" style="color:var(--${cls.replace('phase-','phase-')})">${phaseCounts[p]}</span><span class="lbl">${label}</span></div>`;
    }).join('');

  document.getElementById('stats-row').innerHTML = `
    <div class="stat-chip active"><span class="val">${active}</span><span class="lbl">Active</span></div>
    <div class="stat-chip"><span class="val">${total}</span><span class="lbl">Total (14d)</span></div>
    <div class="stat-chip rc"><span class="val">${rc}</span><span class="lbl">Remote Control</span></div>
    <div class="stat-chip"><span class="val">${avgCtx}%</span><span class="lbl">Avg Context</span></div>
    ${phaseChips}
  `;
}
```

- [ ] **Step 2: Fix the CSS var reference in the inline style**

The `style="color:var(--${...})"` above references `--phase-spec`, `--phase-plan`, etc. which were added in Task 3 Step 1. Verify `:root` contains those vars — they were added in Task 3. No action needed if Task 3 is done.

- [ ] **Step 3: Verify stats row shows phase chips**

Open `http://localhost:8765/session-dashboard.html`. Stats row should now show coloured count chips for each phase that has at least one session. RUNNING WORK is intentionally excluded from stats.

- [ ] **Step 4: Commit**

```bash
git add session-dashboard.html
git commit -m "feat(sessions): show phase counts in stats row"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Detect phase from skill invocations | Task 1 + 2 |
| Detect phase from git branch | Task 2 |
| Detect phase from session name | Task 2 |
| Detect phase from last prompt | Task 2 |
| Default to RUNNING WORK | Task 2 (`detectPhase` returns `'RUNNING WORK'` when bestConf=0) |
| Phase badge on card with colours per spec | Task 3 |
| Phase filter buttons | Task 4 |
| Phase counts in stats strip | Task 5 |
| RUNNING WORK as muted grey, excluded from stats | Task 3 Step 2 (`.tag.phase-work` opacity 0.7), Task 5 Step 1 (filtered out) |

**Placeholder scan:** None found. All steps contain exact code.

**Type consistency:**
- `session.phase` set in Task 2 Step 2, read in Tasks 3/4/5 ✓
- `session.last_skill` set in Task 1 Step 1+2, read in `detectPhase()` Task 2 ✓
- CSS vars `--phase-spec` etc. defined in Task 3 Step 1, used in Task 3 Step 2 and Task 5 Step 1 ✓
- `phaseTag()` defined in Task 3 Step 3, called in Task 3 Step 4 ✓
- `applyFilter()` updated in Task 4 Step 3 to handle `phase:X` prefix from buttons in Task 4 Step 1 ✓
