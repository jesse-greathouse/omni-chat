import { ensureNetwork, activateNetwork, uiRefs, destroyNetwork } from './state/store.js';
import { Ingestor } from './irc/ingest.js';
import { createProfilesPanel } from './ui/connectionForm.js';
import { api, events, EVT } from './lib/adapter.js';
import { el } from './lib/dom.js';
import { canonicalizeConnOptions } from './config/defaults.js';

uiRefs.viewsEl = document.getElementById('views');

const tabbarEl   = document.getElementById('tabbar');
// Surface all window-level errors to DevTools console
window.addEventListener('error',  (e) => console.error('[renderer error]', e.message, e.error ?? ''));
window.addEventListener('unhandledrejection', (e) => console.error('[renderer unhandledrejection]', e.reason ?? ''));

let activeSessionId = null;
const ingestor = new Ingestor({ onError: (s) => console.error('[ingest error]', s) });
const tabs = new Map();

function renderTabs() {
  tabbarEl.textContent = '';
  for (const { id, title } of tabs.values()) {
    const tab = el('div', { className: 'tab' + (id === activeSessionId ? ' active' : '') });
    const titleSpan = el('span', { className: 'title', text: String(title ?? '') });
    const closeSpan = el('span', { className: 'close', title: 'Close', text: 'x' });
    tab.append(titleSpan, closeSpan);
    tab.addEventListener('click', (ev) => {
      if (ev.target === closeSpan) {
        closeTab(id);
        ev.stopPropagation();
        return;
      }
      activateTab(id);
    });
    tabbarEl.appendChild(tab);
  }
  const plus = el('button', { id: 'newTabBtn', title: 'Open new connection tab', text: '+' });
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
  
  // canonical UI topic
  events.emit(EVT.UI_ACTIVE, { id });

  const t = tabs.get(id);
  if (t?.netId) activateNetwork(t.netId);
  renderTabs();
}

function closeTab(id) {
  const t = tabs.get(id);
  if (t) {
    // Stop backend (safe if not running)
    try { api.sessions.stop(id); } catch { console.error('[closeTab] stop error', e); }

    // Destroy the associated network UI/panes/timers/listeners if present
    if (t.netId) {
      try { destroyNetwork(t.netId); } catch (e) { console.error('[closeTab] destroyNetwork', e); }
    }

    // Remove the layer from the DOM
    try { t.layerEl.remove(); } catch (e) { console.error('[closeTab] remove layer', e); }

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
    onConnect: async (_opts) => {
      const opts = canonicalizeConnOptions(_opts);

      // If this form is an overlay on an *existing* connection tab, remove it
      // right away so it can't block inputs underneath. In a brand-new tab,
      // keep it visible until we know the connection succeeded.
      const t0 = tabs.get(activeSessionId);
      const hadExistingNet = !!t0?.netId;
      if (hadExistingNet) { try { panel.remove(); } catch (e) { console.error('[connect] remove overlay', e); } }

      // 1) create network view FIRST (prevents race)
      const t = tabs.get(activeSessionId);
      const net = ensureNetwork(opts, activeSessionId, layerEl);
      t.netId = net.id;
      t.title = opts.server;
      renderTabs();
      activateNetwork(net.id);

      // 2) start this tab’s session
      try {
        await api.sessions.start(activeSessionId, opts);
        // Success → remove the form in *all* cases so it doesn't overlay chat input.
        try { panel.remove(); } catch (e) { console.error('[connect] remove overlay after success', e); }
      } catch (e) {
        console.error(`[session start failed][${activeSessionId}]`, e);
        // If we hid the overlay for an existing connection, put it back so the
        // user can retry. (In a new tab, the form was never removed.)
        if (hadExistingNet) { try { layerEl.prepend(panel); } catch (err) { console.error('[connect] restore overlay', err); } }
      }
    }
  });
  layerEl.appendChild(panel);
}

events.on(EVT.CONN_STATUS, ({ sessionId, status }) => {
  // optional: UI header, etc.
});

// Canonical bus: errors
events.on(EVT.CONN_ERROR, ({ sessionId, message }) => {
  if (tabs.has(sessionId)) console.error('[conn:error]', sessionId, message);
});

// Canonical bus: raw line stream → Ingestor
events.on(EVT.CONN_LINE, ({ sessionId, line }) => {
  try { ingestor.ingest(line, sessionId); } catch (e) { console.error('[ingest exception]', e); }
});


// central UI error topic → console
events.on(EVT.ERROR, ({ scope, message }) => {
  console.error('[ui:error]', scope, message);
});

openNewTab();
renderTabs();
