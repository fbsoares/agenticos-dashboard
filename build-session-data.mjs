#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const SESSIONS_JSON = join(__dirname, 'sessions.json');
const OUTPUT = join(__dirname, 'session-data.json');
const MAX_CONTEXT = 200_000;
const RECENT_DAYS = 14;

async function parseTranscript(filePath) {
  const session = {
    session_id: basename(filePath, '.jsonl'),
    name: null, cwd: null, rc_url: null,
    first_active: null, last_active: null,
    git_branch: null, model: null,
    last_prompt: null,
    ctx_tokens: 0, ctx_pct: 0,
    total_turns: 0,
  };

  try {
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }

      const ts = obj.timestamp;
      if (ts) {
        if (!session.first_active) session.first_active = ts;
        session.last_active = ts;
      }

      const branch = obj.gitBranch;
      if (branch && branch !== 'HEAD') session.git_branch = branch;

      const type = obj.type;

      if (type === 'system') {
        if (obj.subtype === 'bridge_status' && obj.url) {
          session.rc_url = obj.url;
          if (!session.cwd && obj.cwd) session.cwd = obj.cwd;
        }
        if (obj.subtype === 'custom-title' || obj.type === 'custom-title') {
          if (obj.customTitle) session.name = obj.customTitle;
        }
      }

      if (type === 'bridge-session' && obj.bridgeSessionId) {
        const id = obj.bridgeSessionId.replace(/^cse_/, 'session_');
        session.rc_url = `https://claude.ai/code/${id}`;
      }

      if (obj.type === 'custom-title' && obj.customTitle) {
        session.name = obj.customTitle;
      }

      if (type === 'user') {
        const msg = obj.message || {};
        if (msg.role === 'user') {
          if (!session.cwd && obj.cwd) session.cwd = obj.cwd;
          const content = msg.content;
          let text = '';
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === 'text' && c.text) { text = c.text; break; }
            }
          } else if (typeof content === 'string') {
            text = content;
          }
          if (text && !text.startsWith('<') && !text.startsWith('This session is being continued') && text.length > 2) {
            session.last_prompt = text.slice(0, 160).replace(/\n+/g, ' ').trim();
            session.total_turns++;
          }
        }
      }

      if (type === 'assistant') {
        const msg = obj.message || {};
        if (msg.model) session.model = msg.model;
        if (!session.cwd && obj.cwd) session.cwd = obj.cwd;
        const usage = msg.usage;
        if (usage) {
          const ctx = (usage.cache_read_input_tokens || 0) +
                      (usage.cache_creation_input_tokens || 0) +
                      (usage.input_tokens || 0);
          if (ctx > session.ctx_tokens) {
            session.ctx_tokens = ctx;
            session.ctx_pct = Math.min(99, Math.round(ctx / MAX_CONTEXT * 100));
          }
        }
      }
    }
  } catch { /* unreadable file */ }

  return session;
}

function loadHookSessions() {
  try {
    return JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'));
  } catch { return []; }
}

async function main() {
  const hookSessions = loadHookSessions();
  const hookMap = Object.fromEntries(hookSessions.map(s => [s.session_id, s]));

  const cutoff = new Date(Date.now() - RECENT_DAYS * 86400_000);
  const sessions = [];

  let projectDirs;
  try { projectDirs = readdirSync(PROJECTS_DIR); } catch { projectDirs = []; }

  for (const proj of projectDirs) {
    const projPath = join(PROJECTS_DIR, proj);
    let files;
    try { files = readdirSync(projPath); } catch { continue; }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = join(projPath, file);
      let stat;
      try { stat = statSync(filePath); } catch { continue; }
      if (stat.mtime < cutoff && stat.size < 1000) continue;

      const s = await parseTranscript(filePath);
      if (!s.last_active) continue;
      if (new Date(s.last_active) < cutoff) continue;

      // merge hook state
      const hook = hookMap[s.session_id];
      if (hook) {
        const age = Date.now() - new Date(s.last_active).getTime();
        s.active = hook.active && age < 2 * 3600_000;
        s.ended = hook.ended || null;
        if (!s.rc_url && hook.rc_url) s.rc_url = hook.rc_url;
        if (!s.name && hook.name) s.name = hook.name;
        if (!s.cwd && hook.cwd) s.cwd = hook.cwd;
      } else {
        // infer active from recency: if last activity < 2h ago, likely active
        const age = Date.now() - new Date(s.last_active).getTime();
        s.active = age < 2 * 3600_000;
        s.ended = null;
      }

      sessions.push(s);
    }
  }

  sessions.sort((a, b) => new Date(b.last_active) - new Date(a.last_active));

  writeFileSync(OUTPUT, JSON.stringify({ generated_at: new Date().toISOString(), sessions }, null, 2));
  console.log(`Wrote ${sessions.length} sessions to session-data.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
