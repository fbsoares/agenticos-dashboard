// ── Page config (read from this script's own tag) ──────────────────────────
const PAGE_TAB = document.currentScript.dataset.tab || 'work';
const API_BASE = document.currentScript.dataset.apiBase || '';

// ── Locale ──────────────────────────────────────────────────────────────
const LOCALE_DATA = {
  pt: {
    days:      ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'],
    months:    ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
    dateFmt:   (day, date, month, year) => `${day}, ${date} de ${month} de ${year}`,
    tips:      ['Semana começa amanhã.','Bom trabalho, segunda!','Quarta-feira, meio da semana.','Já passou do meio!','Sexta está perto.','Fim de semana! 🎉','Descansas, mereces.'],
    greetings: ['Bom dia.','Boa tarde.','Boa noite.'],
  },
  en: {
    days:      ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
    months:    ['January','February','March','April','May','June','July','August','September','October','November','December'],
    dateFmt:   (day, date, month, year) => `${day}, ${month} ${date}, ${year}`,
    tips:      ['Week starts tomorrow.','Good work, Monday!','Hump day.','Past the middle!','Friday is near.','Weekend! 🎉','Rest, you deserve it.'],
    greetings: ['Good morning.','Good afternoon.','Good evening.'],
  },
};

let appLocale = 'pt';
let appCity   = 'Lisboa';
let appName   = '';

function pad(n) { return String(n).padStart(2, '0'); }

function tick() {
  const now = new Date();
  const h = pad(now.getHours()), m = pad(now.getMinutes());
  document.getElementById('clock').textContent = `${h}:${m}`;

  const L = LOCALE_DATA[appLocale] || LOCALE_DATA.pt;
  const day   = L.days[now.getDay()];
  const month = L.months[now.getMonth()];
  document.getElementById('dateline').textContent = L.dateFmt(day, now.getDate(), month, now.getFullYear());

  const hr = now.getHours();
  const greet = hr < 12 ? L.greetings[0] : hr < 18 ? L.greetings[1] : L.greetings[2];
  document.getElementById('greeting').textContent = appName ? greet.replace(/\.$/, '') + ', ' + appName + '.' : greet;
  document.getElementById('day-tip').textContent  = L.tips[now.getDay()];
  document.getElementById('focus-text').textContent = `${appCity} · ${h}:${m}`;
}

// ── Session polling (global — same feed on all pages) ───────────────────
function shortModel(m) {
  if (!m) return '';
  if (m.includes('opus'))   return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku'))  return 'haiku';
  return '';
}

function pollSessions() {
  fetch('session-data.json?t=' + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(data => {
      const sessions = (data.sessions || []).filter(s => s.active);
      const banner = document.getElementById('session-banner');
      const list   = document.getElementById('session-list');
      if (sessions.length === 0) { banner.classList.remove('active'); return; }
      banner.classList.add('active');
      list.innerHTML = sessions.map(s => {
        const folder   = s.cwd ? s.cwd.replace(/\/+$/, '').split('/').pop() : '—';
        const fullPath = s.cwd || '—';
        const shortId  = s.session_id ? s.session_id.slice(0, 8) : '';
        const time     = s.last_active ? new Date(s.last_active).toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit'}) : '';
        const name     = s.name || folder;
        const branch   = s.git_branch ? s.git_branch.replace(/^feature\/[^/]+\//, '') : '';
        const model    = shortModel(s.model);
        return `<div class="session-item">
          <span class="session-pulse"></span>
          <span class="session-label">Active</span>
          <span class="session-name">${escHtml(name)}</span>
          <span class="session-cwd" title="${escAttr(fullPath)}">${escHtml(fullPath)}</span>
          ${branch ? `<span class="session-id">⎇ ${escHtml(branch)}</span>` : `<span class="session-id">${shortId}</span>`}
          ${model  ? `<span class="session-time">${escHtml(model)}</span>` : ''}
          <span class="session-time">${time}</span>
          ${s.rc_url && /^https?:\/\//.test(s.rc_url) ? `<a class="session-rc-link" href="${s.rc_url}" target="_blank">↗ RC</a>` : ''}
        </div>`;
      }).join('');
    })
    .catch(() => {});
}

function pollReports() {
  fetch('reports/reports-index.json?t=' + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(data => {
      const el = document.getElementById('reports-links');
      if (!el) return;
      if (!data.length) {
        el.innerHTML = '<span style="color:var(--muted);font-size:0.78rem;font-family:\'DM Mono\',monospace;">No reports yet.</span>';
        return;
      }
      el.innerHTML = data.filter(r => r.file && !/^(?!https?:\/\/)[\w+.-]+:/i.test(r.file)).map(r => `<a class="link" href="${r.file}" target="_blank">
        <span class="link-icon">📄</span>
        <span class="link-name">${escHtml(r.title || r.name)}</span>
        <span class="link-arrow">↗</span>
      </a>`).join('');
    })
    .catch(() => {
      const el = document.getElementById('reports-links');
      if (el) el.innerHTML = '<span style="color:var(--muted);font-size:0.78rem;font-family:\'DM Mono\',monospace;">No reports found.</span>';
    });
}

// ── Escaping helpers (used by this file and by dashboard-agents.html's own script) ──
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Checklist ────────────────────────────────────────────────────────────
function pollChecklist() {
  fetch(`/api${API_BASE}/checklist?t=` + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(items => {
      const el = document.getElementById('checklist-items');
      if (!el) return;
      el.innerHTML = items.map(item => `
        <div class="checklist-item${item.checked ? ' done' : ''}" onclick="toggleChecklist('${escAttr(item.id)}', this)">
          <span class="checklist-check">${item.checked ? '✓' : ''}</span>
          <span class="checklist-text">${escHtml(item.text)}</span>
          <button class="checklist-copy" onclick="event.stopPropagation();copyChecklistItem(this,'${escAttr(item.text)}')" title="Copy">⎘</button>
          <button class="checklist-delete" onclick="event.stopPropagation();deleteChecklistItem('${escAttr(item.id)}',this)">✕</button>
        </div>`).join('');
    })
    .catch(() => {});
}

function toggleChecklist(id, el) {
  const done = el.classList.contains('done');
  fetch(`/api${API_BASE}/checklist/${id}`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({checked: !done}),
  })
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(item => {
      el.classList.toggle('done', item.checked);
      el.querySelector('.checklist-check').textContent = item.checked ? '✓' : '';
    })
    .catch(() => {});
}

function copyChecklistItem(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const prev = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = prev; }, 1200);
  }).catch(() => {});
}

function deleteChecklistItem(id, btn) {
  fetch(`/api${API_BASE}/checklist/${id}`, { method: 'DELETE' })
    .then(r => { if (!r.ok && r.status !== 404) throw new Error(r.statusText); })
    .then(() => { btn.closest('.checklist-item').remove(); })
    .catch(() => {});
}

function addChecklistItem(input) {
  const text = input.value.trim();
  if (!text) return;
  fetch(`/api${API_BASE}/checklist`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({text}),
  })
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(() => { input.value = ''; pollChecklist(); })
    .catch(() => {});
}

// ── Announcements ─────────────────────────────────────────────────────────
function pollAnnouncements() {
  fetch(`/api${API_BASE}/announcements?t=` + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(items => {
      const el = document.getElementById('announcements-items');
      if (!el) return;
      if (!items.length) {
        el.innerHTML = '<div class="announcement-empty">No announcements.</div>';
        return;
      }
      el.innerHTML = items.map(item => `
        <div class="announcement-item" data-id="${escAttr(item.id)}">
          <div class="announcement-body">
            <div class="announcement-source">${escHtml(item.source || 'manual')}</div>
            <div class="announcement-text">${escHtml(item.text)}</div>
          </div>
          <button class="announcement-dismiss" onclick="dismissAnnouncement('${escAttr(item.id)}',this)" title="Dismiss">✕</button>
        </div>`).join('');
    })
    .catch(() => {});
}

function dismissAnnouncement(id, btn) {
  fetch(`/api${API_BASE}/announcements/${id}/dismiss`, { method: 'PATCH' })
    .then(r => { if (!r.ok) throw new Error(r.statusText); })
    .then(() => { btn.closest('.announcement-item').remove(); })
    .catch(() => {});
}

// ── News ──────────────────────────────────────────────────────────────────
function pollNews() {
  fetch(`/api${API_BASE}/news?t=` + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(items => {
      const el = document.getElementById('news-items');
      if (!el) return;
      if (!items.length) { el.innerHTML = '<div class="news-empty">No articles yet.</div>'; return; }
      el.innerHTML = items.map(item => `
        <div class="news-item${item.read ? ' read' : ''}" data-id="${escAttr(item.id)}" data-url="${escAttr(item.url)}" onclick="openNews(this)">
          <div style="flex:1;min-width:0;">
            <div class="news-meta">
              ${item.source ? `<span>${escHtml(item.source)}</span>` : ''}
              ${item.date   ? `<span>${escHtml(item.date)}</span>`   : ''}
            </div>
            <div class="news-title">${escHtml(item.title)}</div>
          </div>
          <button class="news-delete" onclick="event.stopPropagation();deleteNews('${escAttr(item.id)}',this)" title="Remove">✕</button>
        </div>`).join('');
    }).catch(() => {});
}

function openNews(el) {
  const url = el.dataset.url;
  if (!url || !/^https?:\/\//i.test(url)) return;
  fetch(`/api${API_BASE}/news/${el.dataset.id}/read`, { method: 'PATCH' }).catch(() => {});
  window.open(url, '_blank', 'noopener');
  el.classList.add('read');
}

function deleteNews(id, btn) {
  fetch(`/api${API_BASE}/news/${id}`, { method: 'DELETE' })
    .then(r => { if (!r.ok && r.status !== 404) throw new Error(r.statusText); })
    .then(() => { btn.closest('.news-item').remove(); })
    .catch(() => {});
}

function addNewsItem() {
  const urlEl   = document.getElementById('news-add-url');
  const titleEl = document.getElementById('news-add-title');
  const url   = (urlEl?.value || '').trim();
  const title = (titleEl?.value || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) { urlEl?.focus(); return; }
  const body = { url, title: title || new URL(url).hostname };
  fetch(`/api${API_BASE}/news`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(() => {
      if (urlEl)   urlEl.value   = '';
      if (titleEl) titleEl.value = '';
      pollNews();
    })
    .catch(() => {});
}

// ── Music ─────────────────────────────────────────────────────────────────
function pollMusic() {
  fetch(`/api${API_BASE}/music?t=` + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(items => {
      const el = document.getElementById('music-items');
      if (!el) return;
      if (!items.length) { el.innerHTML = '<div class="news-empty">No tracks yet.</div>'; return; }
      el.innerHTML = items.map(item => {
        if (!/^https?:\/\//i.test(item.url)) return '';
        return `<a class="music-item" href="${escAttr(item.url)}" target="_blank" rel="noopener">
          <span class="music-icon">${escHtml(item.icon || '🎵')}</span>
          <div class="music-body">
            <div class="music-title">${escHtml(item.title)}</div>
            ${item.artist ? `<div class="music-artist">${escHtml(item.artist)}</div>` : ''}
          </div>
          <span class="music-arrow">↗</span>
        </a>`;
      }).join('');
    }).catch(() => {});
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildGridStylesheet(sections) {
  const rules = sections.map(s =>
    `#${s.id} { grid-column: ${s.grid.col}; grid-row: ${s.grid.row}; }`
  ).join('\n');
  const mobileRules = sections.map(s => `#${s.id} { grid-column: 1 / -1; }`).join('\n  ');
  return `${rules}\n@media (max-width: 900px) {\n  .grid { grid-template-columns: repeat(6, 1fr); }\n}\n@media (max-width: 600px) {\n  ${mobileRules}\n}`;
}

function renderSection(section) {
  const colStyle = section.linksColumns > 1
    ? ` style="grid-template-columns: repeat(${section.linksColumns}, 1fr);"`
    : '';

  if (section.type === 'checklist') {
    return `<div id="${section.id}" class="section">
      <div class="label">
        <span class="dot"></span>
        <span class="label-text">${section.label}</span>
      </div>
      <div class="checklist-list" id="checklist-items"></div>
      <div class="checklist-add">
        <input class="checklist-input" id="checklist-input" type="text" placeholder="Add item…"
          onkeydown="if(event.key==='Enter') addChecklistItem(this)">
        <button class="checklist-btn" onclick="addChecklistItem(document.getElementById('checklist-input'))">+</button>
      </div>
    </div>`;
  }

  if (section.type === 'announcements') {
    return `<div id="${section.id}" class="section">
      <div class="label">
        <span class="dot"></span>
        <span class="label-text">${section.label}</span>
      </div>
      <div class="announcement-list" id="announcements-items">
        <div class="announcement-empty">Loading…</div>
      </div>
    </div>`;
  }

  if (section.type === 'news') {
    return `<div id="${section.id}" class="section">
      <div class="label"><span class="dot"></span><span class="label-text">${section.label}</span></div>
      <div class="news-list" id="news-items"><div class="news-empty">Loading…</div></div>
      <div class="news-add">
        <input class="news-add-url" id="news-add-url" type="url" placeholder="URL…"
          onkeydown="if(event.key==='Enter') addNewsItem()">
        <input class="news-add-title" id="news-add-title" type="text" placeholder="Title (optional)"
          onkeydown="if(event.key==='Enter') addNewsItem()">
        <button class="news-add-btn" onclick="addNewsItem()" title="Add article">+</button>
      </div>
    </div>`;
  }

  if (section.type === 'music') {
    return `<div id="${section.id}" class="section">
      <div class="label"><span class="dot"></span><span class="label-text">${section.label}</span></div>
      <div class="music-list" id="music-items"><div class="news-empty">Loading…</div></div>
    </div>`;
  }

  if (section.type === 'dynamic') {
    return `<div id="${section.id}" class="section">
      <div class="label">
        <span class="dot"></span>
        <span class="label-text">${section.label}</span>
      </div>
      <div class="links" id="${section.id}-links">
        <span style="color:var(--muted);font-size:0.78rem;font-family:'DM Mono',monospace;">Loading…</span>
      </div>
    </div>`;
  }

  if (section.type === 'agent-sessions') {
    return `<div id="${section.id}" class="section">
      <div class="label">
        <span class="dot"></span>
        <span class="label-text">${section.label}</span>
      </div>
      <div class="agent-session-grid" id="agent-session-cards">
        <span style="color:var(--muted);font-size:0.78rem;font-family:'DM Mono',monospace;">Loading…</span>
      </div>
      <div class="agent-register-form">
        <select id="agent-reg-provider">
          <option value="edgar">Edgar</option>
          <option value="other">Other</option>
        </select>
        <input id="agent-reg-name" type="text" placeholder="Name…">
        <input id="agent-reg-notes" type="text" placeholder="Notes — what I'm doing…">
        <button onclick="startAgentSession()">Start Session</button>
      </div>
    </div>`;
  }

  const links = (section.links || []).filter(link => link.url && !/^(?!https?:\/\/)[\w+.-]+:/i.test(link.url)).map(link =>
    `<a class="link" href="${link.url}" target="_blank">
      <span class="link-icon">${escHtml(link.icon)}</span>
      <span class="link-name">${escHtml(link.name)}</span>
      <span class="link-arrow">↗</span>
    </a>`
  ).join('');

  return `<div id="${section.id}" class="section">
    <div class="label">
      <span class="dot"></span>
      <span class="label-text">${section.label}</span>
    </div>
    <div class="links"${colStyle}>${links}</div>
  </div>`;
}

async function loadConfig() {
  let config;
  try {
    const r = await fetch('dashboard-config.json?t=' + Date.now());
    if (!r.ok) throw new Error(r.status);
    config = await r.json();
  } catch {
    document.getElementById('grid').innerHTML =
      `<div style="grid-column:1/-1;padding:32px;color:var(--muted);font-family:'DM Mono',monospace;font-size:0.82rem;line-height:1.8;">
        <strong style="color:var(--text)">dashboard-config.json not found</strong><br>
        Run <code style="color:var(--text);background:var(--surface2);padding:2px 6px;border-radius:4px;">./install.sh</code> from the repo root to set up.
      </div>`;
    return;
  }

  // Apply user
  if (config.user?.locale) appLocale = config.user.locale;
  if (config.user?.city)   appCity   = config.user.city;
  if (config.user?.name)   appName   = config.user.name;
  tick();

  // Inject accent + glow CSS vars into :root
  const root = document.documentElement;
  if (config.theme?.accents) {
    for (const [key, hex] of Object.entries(config.theme.accents)) {
      root.style.setProperty(`--accent-${key}`, hex);
      root.style.setProperty(`--glow-${key}`, hexToRgba(hex, 0.15));
    }
  }

  // Filter to this page's tab
  const sections = (config.sections || []).filter(s => s.tab === PAGE_TAB);

  // Generate grid placement stylesheet
  const styleEl = document.createElement('style');
  styleEl.id = 'grid-layout';
  styleEl.textContent = buildGridStylesheet(sections);
  document.head.appendChild(styleEl);

  // Render sections
  const grid = document.getElementById('grid');
  grid.innerHTML = sections.map(renderSection).join('');

  // Apply per-section CSS custom properties
  for (const section of sections) {
    const el = document.getElementById(section.id);
    if (!el) continue;
    const accentKey = section.accent || section.id;
    const hex = config.theme?.accents?.[accentKey];
    if (hex) {
      el.style.setProperty('--section-accent',  hex);
      el.style.setProperty('--section-glow',    hexToRgba(hex, 0.15));
      el.style.setProperty('--section-icon-bg', hexToRgba(hex, 0.12));
    }
  }

  // Nav bar
  if (typeof renderNav === 'function') renderNav(PAGE_TAB);

  // Start reports polling now that the reports section exists (no-op if absent on this page)
  pollReports();
  setInterval(pollReports, 30000);

  if (sections.some(s => s.type === 'checklist')) {
    pollChecklist();
    setInterval(pollChecklist, 10000);
  }
  if (sections.some(s => s.type === 'announcements')) {
    pollAnnouncements();
    setInterval(pollAnnouncements, 15000);
  }
  if (sections.some(s => s.type === 'news')) {
    pollNews();
    setInterval(pollNews, 60000);
  }
  if (sections.some(s => s.type === 'music')) {
    pollMusic();
    setInterval(pollMusic, 300000);
  }
  if (sections.some(s => s.type === 'agent-sessions') && typeof pollAgentSessions === 'function') {
    pollAgentSessions();
    setInterval(pollAgentSessions, 30000);
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  tick();
  setInterval(tick, 1000);
  pollSessions();
  setInterval(pollSessions, 5000);
  loadConfig();
});
