const tbody      = document.getElementById('tbody');
const emptyEl    = document.getElementById('empty');
const refreshBtn = document.getElementById('refresh');
const closeBtn   = document.getElementById('closeBtn');
const loadingEl  = document.getElementById('loading');
const infoEl     = document.getElementById('info');

let items = [];
let isLoading = false;
let loadingTimeout = null;
let activeSessionId = null;

function setLoading(on) {
  isLoading = !!on;
  loadingEl.hidden = !isLoading;
  refreshBtn.disabled = isLoading;
  if (infoEl) infoEl.textContent = isLoading ? 'Refreshing…' : 'Sorted by users (desc)';
  if (isLoading) {
    clearTimeout(loadingTimeout);
    loadingTimeout = setTimeout(() => setLoading(false), 12000);
  } else {
    clearTimeout(loadingTimeout);
  }
}

function render() {
  const rows = items.slice().sort((a, b) => (b.users - a.users) || a.name.localeCompare(b.name));

  tbody.innerHTML = '';
  if (rows.length === 0) {
    emptyEl.hidden = isLoading ? true : false;
    return;
  }
  emptyEl.hidden = true;

  const frag = document.createDocumentFragment();
  for (const { name, users, topic } of rows) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'chan-btn';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      if (!activeSessionId) return;
      const chan = name.startsWith('#') || name.startsWith('&') ? name : `#${name}`;
      window.sessions.send(activeSessionId, `/join ${chan}`);
    });
    tdName.appendChild(btn);

    const tdUsers = document.createElement('td');
    tdUsers.textContent = String(users);

    const tdTopic = document.createElement('td');
    const t = document.createElement('div');
    t.className = 'topic';
    t.textContent = topic || '';
    tdTopic.appendChild(t);

    tr.appendChild(tdName);
    tr.appendChild(tdUsers);
    tr.appendChild(tdTopic);
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

window.omni.onUI('chanlist', (payload) => {
  if (!payload || payload.sessionId !== activeSessionId) return; // ← filter by session
  const arr = payload.items;
  items = Array.isArray(arr) ? arr : [];
  render();
  if (isLoading && items.length > 0) setLoading(false);
});

window.omni.onUI('active-session', (p) => {
  activeSessionId = p?.id || null;
  if (activeSessionId) {
    setLoading(true);
    window.sessions.send(activeSessionId, '/list * 30');
  }
});

refreshBtn.addEventListener('click', () => {
  if (!activeSessionId) return;
  setLoading(true);
  window.sessions.send(activeSessionId, '/list * 30');
});

closeBtn.addEventListener('click', () => window.close());
