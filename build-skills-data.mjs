#!/usr/bin/env node
// build-skills-data.mjs — generates skills-data.js for the current device.
// Usage: node build-skills-data.mjs [--out skills-data.js]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// ── Areas ──────────────────────────────────────────────────────────────────

const AREA_ORDER = [
  'Dev workflow', 'Code quality', 'Automation', 'Config & setup',
  'Documentation', 'Project', 'Outros'
];

const AREA_BY_PLUGIN = {
  superpowers: 'Dev workflow',
  warp: 'Dev workflow',
  context7: 'Documentation',
};

const AREA_KEYWORDS = [
  [['code-review','simplify','security','verify','tdd','test','debug','review','lint'], 'Code quality'],
  [['loop','schedule','cron','automation','dispatch','agent'], 'Automation'],
  [['config','settings','keybind','permission','setup','update-config'], 'Config & setup'],
  [['doc','init','readme','wiki','sphera'], 'Documentation'],
  [['nexus','scraper','worker','pipeline'], 'Project'],
];

function classifyArea(skillId, plugin) {
  if (AREA_BY_PLUGIN[plugin]) return AREA_BY_PLUGIN[plugin];
  const low = skillId.toLowerCase();
  for (const [kws, area] of AREA_KEYWORDS) {
    if (kws.some(k => low.includes(k))) return area;
  }
  return 'Outros';
}

// ── Frontmatter parser ────────────────────────────────────────────────────

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { name: '', description: '' };
  const lines = m[1].split(/\r?\n/);
  const out = { name: '', description: '' };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z_]+):\s?(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    if (key !== 'name' && key !== 'description') continue;
    let val = kv[2];
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      const block = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^[A-Za-z_]+:\s?/.test(lines[j]) && !/^\s/.test(lines[j])) break;
        block.push(lines[j].replace(/^\s+/, ''));
      }
      val = block.join(' ').replace(/\s+/g, ' ').trim();
    } else {
      val = val.replace(/^["']|["']$/g, '').trim();
    }
    out[key] = val;
  }
  return out;
}

// ── Tags ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','for','with','when','use','user','this','that','is','are',
  'on','in','by','your','help','using','also','it','as','etc','from','their','they','will','into',
  'such','these','those','what','which','about','before','after','any','each','its','have','been',
  'para','como','mais','pela','pelo','esta','este','esse','essa','isto','isso','pode','sobre',
  'quando','onde','cada','qual','seja','entre','todos','todas','outro','outra','numa','quero',
  'says','used','note','only','even','just','then','than','already','always','never','both',
  'skill','skills','tool','tools','work','code','task'
]);

function buildTags(name, description) {
  const tags = new Set();
  tags.add(name.toLowerCase());
  const words = (description || '')
    .toLowerCase()
    .replace(/[^a-z0-9áàâãéêíóôõúç\s-]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
  for (const w of words) { if (tags.size >= 14) break; tags.add(w); }
  return [...tags];
}

// ── Overlap detection ─────────────────────────────────────────────────────

function detectOverlaps(skills) {
  const byName = new Map();
  for (const s of skills) {
    const key = s.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(s);
  }
  const overlaps = [];
  for (const [key, members] of byName) {
    if (members.length < 2) continue;
    members.forEach(m => { m.overlapGroup = key; });
    overlaps.push({ key, members: members.map(m => m.id) });
  }
  return overlaps;
}

// ── File walker ───────────────────────────────────────────────────────────

function findSkillFiles(root) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === 'SKILL.md') out.push(full);
    }
  };
  walk(root);
  return out;
}

// ── Collect skills ────────────────────────────────────────────────────────

function collectSkills() {
  const skills = [];
  const seen = new Set();

  // From installed plugins
  let plugins = [];
  try {
    const raw = execFileSync('claude', ['plugin', 'list', '--json'], { encoding: 'utf8' });
    plugins = JSON.parse(raw).filter(p => p.enabled && p.installPath && existsSync(p.installPath));
  } catch (e) {
    console.warn('⚠  claude plugin list failed:', e.message);
  }

  for (const p of plugins) {
    const [pluginName] = p.id.split('@');
    for (const file of findSkillFiles(p.installPath)) {
      const fm = parseFrontmatter(readFileSync(file, 'utf8'));
      if (!fm.name) continue;
      const id = `${pluginName}:${fm.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      skills.push({
        id, name: fm.name, plugin: pluginName, source: 'plugin',
        version: p.version || 'unknown',
        invoke: id,
        area: classifyArea(fm.name, pluginName),
        description: fm.description || '',
        tags: buildTags(fm.name, fm.description),
        overlapGroup: null,
      });
    }
  }

  // From local skills dirs
  const home = homedir();
  const localDirs = [
    join(home, '.claude', 'skills'),
    join(process.cwd(), '.claude', 'skills'),
  ];

  for (const dir of [...new Set(localDirs)]) {
    if (!existsSync(dir)) continue;
    for (const file of findSkillFiles(dir)) {
      const fm = parseFrontmatter(readFileSync(file, 'utf8'));
      if (!fm.name) continue;
      if (seen.has(fm.name)) continue;
      seen.add(fm.name);
      skills.push({
        id: fm.name, name: fm.name, plugin: 'local', source: 'local',
        version: null,
        invoke: fm.name,
        area: classifyArea(fm.name, 'local'),
        description: fm.description || '',
        tags: buildTags(fm.name, fm.description),
        overlapGroup: null,
      });
    }
  }

  skills.sort((a, b) => a.id.localeCompare(b.id));
  return skills;
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const outArg = argv.indexOf('--out');
  const here = dirname(fileURLToPath(import.meta.url));
  const outFile = outArg !== -1 ? argv[outArg + 1] : join(here, 'skills-data.js');

  const skills = collectSkills();
  const overlaps = detectOverlaps(skills);

  const byArea = {};
  for (const s of skills) byArea[s.area] = (byArea[s.area] || 0) + 1;

  // Plugin inventory (name → version + count)
  const pluginMap = {};
  for (const s of skills) {
    if (!pluginMap[s.plugin]) pluginMap[s.plugin] = { version: s.version, count: 0 };
    pluginMap[s.plugin].count++;
  }
  const pluginsList = Object.entries(pluginMap).map(([name, info]) => ({ name, ...info }));

  const data = {
    generated: new Date().toISOString().slice(0, 10),
    device: process.env.HOSTNAME || process.env.HOST || 'unknown',
    counts: { total: skills.length, byArea, overlaps: overlaps.length },
    areas: AREA_ORDER.filter(a => byArea[a]),
    plugins: pluginsList,
    skills,
    overlaps,
  };

  const out = `// Generated by build-skills-data.mjs — do not edit manually.\nwindow.SKILLS_DATA = ${JSON.stringify(data, null, 2)};\n`;
  writeFileSync(outFile, out);
  console.log(`✓ ${outFile} — ${data.counts.total} skills, ${data.counts.overlaps} overlaps, ${pluginsList.length} plugins`);
}

main();
