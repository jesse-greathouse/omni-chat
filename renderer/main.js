import { store, ensureNetwork, activateNetwork, uiRefs } from './state/store.js';
import { setupIngest } from './irc/ingest.js';
import { ErrorDock } from './ui/ErrorDock.js';
import { createProfilesPanel } from './ui/connectionForm.js';

uiRefs.viewsEl      = document.getElementById('views');
uiRefs.errorDockEl  = document.getElementById('errorDock');
uiRefs.toggleErrBtn = document.getElementById('toggleErrors');

const tabbarEl   = document.getElementById('tabbar');
const errors     = new ErrorDock(uiRefs.errorDockEl, uiRefs.toggleErrBtn);
window.addEventListener('error',  e => errors.append(`[renderer] ${e.message}`));
window.addEventListener('unhandledrejection', e => errors.append(`[promise] ${e.reason?.message || e.reason}`));

let activeSessionId = null;
const tabs = new Map(); // id -> { id, title, layerEl, netId? }

function renderTabs() {
  tabbarEl.innerHTML = '';
  for (const { id, title } of tabs.values()) {
    const el = document.createElement('div');
    el.className = 'tab' + (id === activeSessionId ? ' active' : '');
    el.innerHTML = `<span class="title">${title}</span><span class="close" title="Close">×</span>`;
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.close')) {
        closeTab(id);
        ev.stopPropagation();
        return;
      }
      activateTab(id);
    });
    tabbarEl.appendChild(el);
  }
  const plus = document.createElement('button');
  plus.id = 'newTabBtn';
  plus.textContent = '+';
  plus.title = 'Open new connection tab';
  plus.addEventListener('click', openNewTab);
  tabbarEl.appendChild(plus);
}

function openNewTab() {
  const id = crypto.randomUUID();
  const layer = document.createElement('div');
  layer.className = 'view-layer hidden';
  uiRefs.viewsEl.appendChild(layer);

  tabs.set(id, { id, title: 'New', layerEl: layer, netId: null });
  activateTab(id);
  mountProfilesPanel(layer);
}

function activateTab(id) {
  activeSessionId = id;
  // toggle layers
  for (const t of tabs.values()) {
    t.layerEl.classList.toggle('hidden', t.id !== id);
  }
  // tell auxiliary windows
  window.omni.publishUI('active-session', { id });

  const t = tabs.get(id);
  if (t?.netId) activateNetwork(t.netId);
  renderTabs();
}

function closeTab(id) {
  const t = tabs.get(id);
  if (t) {
    try { window.sessions.stop(id); } catch {}
    try { t.layerEl.remove(); } catch {}
    tabs.delete(id);
  }
  const next = tabs.values().next().value;
  if (next) {
    activateTab(next.id);
  } else {
    openNewTab();
  }
  renderTabs();
}

function mountProfilesPanel(layerEl) {
  layerEl.innerHTML = '';
  const panel = createProfilesPanel({
    onConnect: async (opts) => {
      // If this form is an overlay on an *existing* connection tab, remove it
      // right away so it can't block inputs underneath. In a brand-new tab,
      // keep it visible until we know the connection succeeded.
      const t0 = tabs.get(activeSessionId);
      const hadExistingNet = !!t0?.netId;
      if (hadExistingNet) {
        try { panel.remove(); } catch {}
      }

      // 1) create network view FIRST (prevents race)
      const t = tabs.get(activeSessionId);
      const net = ensureNetwork(opts, activeSessionId, layerEl);
      t.netId = net.id;
      t.title = opts.server;
      renderTabs();
      activateNetwork(net.id);

      // 2) start this tab’s session
      try {
        await window.sessions.start(activeSessionId, opts);
        // Success → remove the form in *all* cases so it doesn't overlay chat input.
        try { panel.remove(); } catch {}
      } catch (e) {
        errors.append(`start[${activeSessionId}]: ${e?.message || e}`);
        // If we hid the overlay for an existing connection, put it back so the
        // user can retry. (In a new tab, the form was never removed.)
        if (hadExistingNet) {
          try { layerEl.prepend(panel); } catch {}
        }
      }
    }
  });
  layerEl.appendChild(panel);
}

// ingest wiring
setupIngest({ onError: (s) => errors.append(s) });

window.sessions.onStatus(({ id, status }) => {
  // no-op for header; keep if you later want per-session status handling
});

window.sessions.onError(({ id, message }) => {
  if (tabs.has(id)) errors.append(`[${id}] ${message}`);
});

// Feed ALL sessions’ lines into the ingester (per-session routing happens inside)
window.sessions.onData(({ id, line }) => {
  try {
    store.ingest(line, id);
  } catch {}
});

openNewTab();
renderTabs();
