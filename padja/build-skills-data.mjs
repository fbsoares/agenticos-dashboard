// scripts/build-skills-data.mjs  (topo do ficheiro)
// Parser de frontmatter minimal: extrai name + description.
// Suporta description single-line e folded (> / |).
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { name: '', description: '' };
  const lines = m[1].split(/\r?\n/);
  const out = { name: '', description: '' };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z_]+):\s?(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2];
    if (key !== 'name' && key !== 'description') continue;
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      // bloco indentado até à próxima chave top-level
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

export function classifyArea(id, plugin, tax) {
  if (tax.areaBySkill && tax.areaBySkill[id]) return tax.areaBySkill[id];
  if (tax.areaByPlugin && tax.areaByPlugin[plugin]) return tax.areaByPlugin[plugin];
  return (tax.areaDefaults && tax.areaDefaults.fallback) || 'Outros';
}

const STOPWORDS = new Set([
  // EN
  'the','a','an','and','or','of','to','for','with','when','use','user','says','this','that','is','are','on','in','by','your','help','using','also','it','as','etc','from','their','they','will','into','such','these','those','what','which','about',
  // PT (só >3 chars passam o filtro de comprimento)
  'para','como','mais','pela','pelo','esta','este','esse','essa','isto','isso','pode','sobre','quando','onde','cada','qual','seja','entre','todos','todas','outro','outra','numa','quero'
]);

export function buildTags(skill, tax) {
  const tags = new Set();
  tags.add(skill.name.toLowerCase());
  const ov = tax.tagOverrides && tax.tagOverrides[skill.id];
  if (ov) ov.forEach(t => tags.add(t.toLowerCase()));
  // deriva keywords da descrição (palavras alfanuméricas >3 chars, sem stopwords)
  const words = (skill.description || '')
    .toLowerCase()
    .replace(/[^a-z0-9áàâãéêíóôõúç\s-]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
  // até 16 tags distintas no total (nome + overrides + keywords)
  for (const w of words) { if (tags.size >= 16) break; tags.add(w); }
  return [...tags];
}

export function detectOverlaps(skills) {
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
    overlaps.push({
      key,
      members: members.map(m => m.id),
      note: `${members.length} plugins, mesma skill`
    });
  }
  overlaps.sort((a, b) => a.key.localeCompare(b.key));
  return overlaps;
}

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_DIRS = ['/home/padja/.claude-work', '/home/padja/.claude-personal'];
const LOCAL_SKILLS_DIRS = [
  join(process.cwd(), '.claude', 'skills'),
  '/home/padja/.claude/skills'
];

// Lê plugins enabled (id, plugin, marketplace, installPath) de ambos os config dirs, dedupe por id.
export function readEnabledPlugins(configDirs = CONFIG_DIRS) {
  const byId = new Map();
  for (const dir of configDirs) {
    let json;
    try {
      const out = execFileSync('claude', ['plugin', 'list', '--json'], {
        env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, encoding: 'utf8'
      });
      json = JSON.parse(out);
    } catch (e) {
      continue; // dir indisponível → tenta o próximo
    }
    for (const p of json) {
      if (!p.enabled || !p.installPath || !existsSync(p.installPath)) continue;
      const [plugin, marketplace] = p.id.split('@');
      if (!byId.has(p.id)) byId.set(p.id, { plugin, marketplace, installPath: p.installPath });
    }
  }
  if (byId.size === 0) {
    throw new Error('Nenhum plugin enabled resolvido via `claude plugin list --json`. Aborto (sem dados parciais).');
  }
  return [...byId.values()];
}

// Glob recursivo por SKILL.md sob um diretório.
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

export function collectSkills(tax, { plugins = readEnabledPlugins(), localDirs = LOCAL_SKILLS_DIRS } = {}) {
  const skills = [];
  const seen = new Set();
  // plugins
  for (const p of plugins) {
    for (const file of findSkillFiles(p.installPath)) {
      const fm = parseFrontmatter(readFileSync(file, 'utf8'));
      if (!fm.name) continue;
      const id = `${p.plugin}:${fm.name}`;
      if (seen.has(id)) continue; seen.add(id);
      const skill = {
        id, name: fm.name, plugin: p.plugin, source: 'plugin',
        invoke: id, area: classifyArea(id, p.plugin, tax),
        tags: [], description: fm.description, triggers: extractTriggers(fm.description),
        overlapGroup: null
      };
      skill.tags = buildTags(skill, tax);
      skills.push(skill);
    }
  }
  // locais
  for (const dir of localDirs) {
    if (!existsSync(dir)) continue;
    for (const file of findSkillFiles(dir)) {
      const fm = parseFrontmatter(readFileSync(file, 'utf8'));
      if (!fm.name) continue;
      const id = fm.name;
      if (seen.has(id)) continue; seen.add(id);
      const skill = {
        id, name: fm.name, plugin: 'local', source: 'local',
        invoke: fm.name, area: classifyArea(id, 'local', tax),
        tags: [], description: fm.description, triggers: extractTriggers(fm.description),
        overlapGroup: null
      };
      skill.tags = buildTags(skill, tax);
      skills.push(skill);
    }
  }
  skills.sort((a, b) => a.id.localeCompare(b.id));
  return skills;
}

// Extrai a parte de triggers da descrição (após "Triggers" / "Use when"), senão "".
export function extractTriggers(desc = '') {
  const m = desc.match(/(?:Triggers?|Use when|TRIGGER)\b[:\s—-]*(.+)$/is);
  return m ? m[1].trim().slice(0, 400) : '';
}

export function buildData(date, tax) {
  const skills = collectSkills(tax);
  const overlaps = detectOverlaps(skills);
  const byArea = {};
  for (const s of skills) byArea[s.area] = (byArea[s.area] || 0) + 1;
  return {
    generated: date,
    counts: { total: skills.length, byArea, overlaps: overlaps.length },
    areas: ['Prospecção & sites','Research nichos','Campanhas','Backend dev','Briefing','Finanças','Workflow/meta','Context-eng','Figma','Docs','Caveman','Outros'],
    skills, overlaps
  };
}

function main() {
  const argv = process.argv.slice(2);
  const di = argv.indexOf('--date');
  if (di === -1 || !argv[di + 1]) {
    console.error('Uso: node scripts/build-skills-data.mjs --date YYYY-MM-DD');
    process.exit(1);
  }
  const date = argv[di + 1];
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..');
  const tax = JSON.parse(readFileSync(join(root, 'skills-taxonomy.json'), 'utf8'));
  const data = buildData(date, tax);
  const out = `// GERADO por scripts/build-skills-data.mjs — não editar à mão.\nwindow.SKILLS_DATA = ${JSON.stringify(data, null, 2)};\n`;
  writeFileSync(join(root, 'skills-data.js'), out);
  console.log(`skills-data.js escrito: ${data.counts.total} skills, ${data.counts.overlaps} grupos overlap.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
