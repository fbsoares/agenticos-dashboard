function renderNav(activeTab) {
  const tabs = [
    { id: 'work',     label: 'Work',     accent: '#4a9eff', href: 'dashboard-work.html' },
    { id: 'personal', label: 'Personal', accent: '#f59e0b', href: 'dashboard-personal.html' },
    { id: 'agents',   label: 'Agents',   accent: '#a78bfa', href: 'dashboard-agents.html' },
  ];

  const style = document.createElement('style');
  style.id = 'nav-style';
  style.textContent = `
    #top-nav {
      display: flex; gap: 4px;
      padding: 8px 40px 0;
      max-width: 1280px; margin: 0 auto;
    }
    .nav-tab {
      font-family: 'DM Mono', monospace;
      font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--muted, #5a6070);
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 8px 8px 0 0;
      border: 1px solid transparent;
      border-bottom: none;
      transition: color 0.15s, background 0.15s;
    }
    .nav-tab:hover { color: var(--text, #e8eaf0); }
    .nav-tab.on {
      color: var(--tab-accent);
      background: var(--surface, #13161b);
      border-color: var(--border, rgba(255,255,255,0.06));
    }
  `;
  document.head.appendChild(style);

  const nav = document.createElement('nav');
  nav.id = 'top-nav';
  nav.innerHTML = tabs.map(t =>
    `<a href="${t.href}" class="nav-tab${t.id === activeTab ? ' on' : ''}" style="--tab-accent:${t.accent}">${t.label}</a>`
  ).join('');
  document.body.insertBefore(nav, document.body.firstChild);
}
