# Shared Claude & Gemini Session Dashboard — Design Spec

**Date:** 2026-06-06  
**Status:** Draft  

## Overview
The current dashboard tracks Claude sessions by scanning `~/.claude/projects/` and parsing `.jsonl` transcript logs. Since Gemini CLI stores its active project sessions in `~/.gemini/tmp/` inside a matching `.jsonl` format, we can extend the dashboard's data compiler (`build-session-data.mjs`) and UI (`session-dashboard.html`) to present a unified view of all development sessions across both AI assistants.

---

## Directory & Storage Mapping

We will locate active sessions for both providers using the following structures:

| Feature | Claude CLI | Gemini CLI |
| :--- | :--- | :--- |
| **Base Directory** | `~/.claude/projects/` | `~/.gemini/tmp/` |
| **Project Identification** | Subdirectories are random hashes. No path file. | Subdirectories are project names/slugs containing `.project_root` (which holds the exact workspace path). |
| **Session File Pattern** | `<hash>/*.jsonl` | `<project_slug>/chats/session-*.jsonl` |
| **Session Format** | JSON Lines (`.jsonl`) | JSON Lines (`.jsonl`) |

---

## JSON Schema Comparison

### Claude Line Format:
* **User Line:** `{"type": "user", "message": { "role": "user", "content": "..." }, "cwd": "..."}`
* **Assistant Line:** `{"type": "assistant", "message": { "model": "...", "usage": { ... } }}`

### Gemini Line Format:
* **Metadata (Line 1):** `{"sessionId": "UUID", "projectHash": "...", "startTime": "...", "lastUpdated": "...", "kind": "main"}`
* **User Line:** `{"type": "user", "content": [{ "text": "..." }], "timestamp": "..."}`
* **Gemini Line:** `{"type": "gemini", "model": "gemini-3-flash", "tokens": { "input": 10085, "output": 70 }, "timestamp": "..."}`

---

## Technical Implementation Strategy

### A. Extending the Compiler (`build-session-data.mjs`)
We will introduce a `parseGeminiTranscript` function and scan both directories in the `main` run loop.

```javascript
// New Constants
const GEMINI_TMP_DIR = join(homedir(), '.gemini', 'tmp');

// Parse a Gemini session transcript
async function parseGeminiTranscript(filePath, cwd) {
  const session = {
    session_id: null,
    name: null,
    cwd: cwd,
    rc_url: null,
    first_active: null,
    last_active: null,
    git_branch: null,
    model: null,
    last_prompt: null,
    ctx_tokens: 0,
    ctx_pct: 0,
    total_turns: 0,
    provider: 'gemini' // Explicitly mark provider
  };

  try {
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
    let isFirstLine = true;

    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }

      // 1. First Line Metadata
      if (isFirstLine) {
        session.session_id = obj.sessionId;
        if (obj.startTime) session.first_active = obj.startTime;
        if (obj.lastUpdated) session.last_active = obj.lastUpdated;
        isFirstLine = false;
        continue;
      }

      // 2. Handle nested updates ($set/messages) or direct messages
      let msgList = [];
      if (obj.$set && obj.$set.messages) {
        msgList = obj.$set.messages;
      } else if (obj.type === 'user' || obj.type === 'gemini') {
        msgList = [obj];
      }

      for (const msg of msgList) {
        if (msg.timestamp) {
          session.last_active = msg.timestamp;
        }

        if (msg.type === 'user') {
          const content = msg.content;
          let text = '';
          if (Array.isArray(content)) {
            const firstText = content.find(c => c.text);
            if (firstText) text = firstText.text;
          } else if (typeof content === 'string') {
            text = content;
          }

          // Strip system setup/metadata blocks from the prompt preview
          if (text && !text.startsWith('<session_context>') && text.length > 2) {
            session.last_prompt = text.slice(0, 160).replace(/\n+/g, ' ').trim();
            session.total_turns++;
          }
        }

        if (msg.type === 'gemini') {
          if (msg.model) session.model = msg.model;
          if (msg.tokens && msg.tokens.input) {
            const input = msg.tokens.input;
            const maxCtx = msg.model && msg.model.includes('pro') ? 2_000_000 : 1_000_000;
            if (input > session.ctx_tokens) {
              session.ctx_tokens = input;
              session.ctx_pct = Math.min(99, Math.round((input / maxCtx) * 100));
            }
          }
        }
      }

      if (obj.$set && obj.$set.lastUpdated) {
        session.last_active = obj.$set.lastUpdated;
      }
    }
  } catch (e) { /* Unreadable file or interrupted */ }

  return session;
}
```

### B. Integrating with the Main Scan Loop
In the `main()` execution thread of `build-session-data.mjs`:
1. Keep the Claude projects scan.
2. Add a scanner for `GEMINI_TMP_DIR`:
   ```javascript
   let geminiDirs;
   try { geminiDirs = readdirSync(GEMINI_TMP_DIR); } catch { geminiDirs = []; }

   for (const dir of geminiDirs) {
     const projPath = join(GEMINI_TMP_DIR, dir);
     let cwd = null;
     try {
       cwd = readFileSync(join(projPath, '.project_root'), 'utf8').trim();
     } catch { continue; } // Not a valid project dir if .project_root is missing

     const chatsPath = join(projPath, 'chats');
     let files;
     try { files = readdirSync(chatsPath); } catch { continue; }

     for (const file of files) {
       if (!file.endsWith('.jsonl')) continue;
       const filePath = join(chatsPath, file);
       
       // File filters by mtime & cutoff...
       const s = await parseGeminiTranscript(filePath, cwd);
       if (!s.session_id || !s.last_active) continue;

       // Merge custom user notes from sessions.json if matching
       const hook = hookMap[s.session_id];
       if (hook) {
         s.active = hook.active;
         s.ended = hook.ended || null;
         if (hook.name) s.name = hook.name;
       } else {
         const age = Date.now() - new Date(s.last_active).getTime();
         s.active = age < 2 * 3600_000;
       }

       sessions.push(s);
     }
   }
   ```

---

## UI Updates (`session-dashboard.html`)

To clearly distinguish Claude sessions from Gemini sessions, we will style them uniquely.

### A. CSS Customization
We will define styling variables matching Gemini's branding colors:
```css
:root {
  /* ...existing Claude/Default styles... */
  --gemini: #4285f4;
  --gemini-glow: rgba(66, 133, 244, 0.15);
  --gemini-gradient: linear-gradient(135deg, #4285f4 0%, #9b51e0 50%, #f43f5e 100%);
}

/* Gemini Card Borders & Accents */
.session-card.provider-gemini.is-active {
  border-color: var(--gemini);
  box-shadow: 0 0 16px var(--gemini-glow);
}

.provider-badge {
  font-family: 'DM Mono', monospace;
  font-size: 0.65rem;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  font-weight: 500;
}
.provider-badge.claude {
  background: var(--surface3);
  color: #fca5a5; /* warm coral */
}
.provider-badge.gemini {
  background: rgba(66, 133, 244, 0.1);
  color: #93c5fd; /* bright blue */
  border: 1px solid rgba(66, 133, 244, 0.2);
}
```

### B. JS Template Updates in `renderCard(s)`
In the card renderer, we will display the provider label:
```javascript
const provider = s.provider || 'claude';
const providerBadge = `<span class="provider-badge ${provider}">${provider}</span>`;
```
And insert it right next to the active tag:
```html
<div class="card-top">
  <span class="session-name${name ? '' : ' unnamed'}">${esc(name) || 'unnamed'}</span>
  <div style="display: flex; gap: 6px; align-items: center;">
    ${providerBadge}
    <span class="tag ${isActive ? 'active' : 'ended'}">${isActive ? 'active' : 'ended'}</span>
  </div>
</div>
```

---

## Verification & Validation Plan
1. **Parser Tests:** Validate parsing of the local `session-2026-06-06T12-38-1c43abf1.jsonl` files to ensure token metrics, turning logic, and prompt isolation function perfectly.
2. **Merging Validation:** Verify that running `node build-session-data.mjs` outputs a cohesive `session-data.json` containing both Claude and Gemini records.
3. **UI Polish:** Verify in the local browser dashboard that the cards are rendered with their respective Gemini/Claude styling.
