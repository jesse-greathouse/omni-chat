import { UI }       from './config/ui.js';
import { PERF }     from './config/perf.js';
import { CONNECT }  from './config/connect.js';
import { createProfilesListController } from './ui/partials/serverProfiles.js';

const api = window.api;
if (!api?.settings) console.error('[settings] preload api missing');

// Surface window-level problems for this renderer too
window.addEventListener('error',  (e) => console.error('[settings renderer error]', e.message, e.error ?? ''));
window.addEventListener('unhandledrejection', (e) => console.error('[settings renderer unhandledrejection]', e.reason ?? ''));

const dom = {
  pathPill: document.getElementById('settingsPath'),
  btnReload: document.getElementById('btnReload'),
  btnReset:  document.getElementById('btnReset'),
  tabs: document.getElementById('tabs'),

  // Connect: globals
  gAuth: document.getElementById('gAuth'),
  gNick: document.getElementById('gNick'),
  gAuthUser: document.getElementById('gAuthUser'),
  gAuthPass: document.getElementById('gAuthPass'),
  gReal: document.getElementById('gReal'),
  gAuthUserRow: document.getElementById('gAuthUserRow'),
  gAuthPassRow: document.getElementById('gAuthPassRow'),
  saveGlobals: document.getElementById('saveGlobals'),

  // Connect: servers
  serversList: document.getElementById('serversList'),
  addServerTop: document.getElementById('addServerTop'),
  addServerBottom: document.getElementById('addServerBottom'),

  // UI
  uiBody: document.getElementById('uiBody'),

  // PERF
  perfBody: document.getElementById('perfBody'),
};

let snapshot = {};
let profilesCtl = null;

// ---------- helpers ----------
const coerce = (raw) => {
  if (/^(true|false)$/i.test(raw)) return /^true$/i.test(raw);
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  if (/^null$/i.test(raw)) return null;
  return raw;
};

const readPath = (root, dotted, fallback = undefined) => {
  const parts = String(dotted || '').split('.').filter(Boolean);
  let t = root;
  for (const p of parts) {
    if (!t || typeof t !== 'object') return fallback;
    t = t[p];
  }
  return t === undefined ? fallback : t;
};

const applyPath = (obj, dotted, val) => {
  const parts = String(dotted || '').split('.').filter(Boolean);
  if (!parts.length) return;
  let t = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    t[k] = (t[k] && typeof t[k] === 'object') ? t[k] : {};
    t = t[k];
  }
  t[parts[parts.length - 1]] = val;
};

async function refreshPathPill() {
  try { dom.pathPill.textContent = await api.settings.path(); } catch {}
}

// ---------- tiny two-way binder ----------
/**
 * Bind a form element to settings.{domain}.{path}
 */
function bindPath(el, domain, path, { toIn, toOut, onChange } = {}) {
  const _toIn = toIn  || ((v) => (v == null ? '' : String(v)));
  const _toOut = toOut || ((v) => v);

  // Initial populate from current snapshot (merged with BUILT_IN if desired)
  const cur = readPath(snapshot[domain] || {}, path, undefined);
  if (cur !== undefined) {
    if (el.type === 'checkbox') el.checked = !!cur;
    else el.value = _toIn(cur);
  }

  // Push edits live into the singleton
  const push = () => {
    const raw = (el.type === 'checkbox') ? el.checked : el.value;
    const v = _toOut(raw);
    api.settings.setPath(domain, path, v).catch(console.error);
    onChange?.(v);
  };
  el.addEventListener('input', push);
  el.addEventListener('change', push);
  el.addEventListener('blur', push);

  // Reflect external changes
  api.events.on('settings:changed', (msg) => {
    if (!msg) return;
    
    // If an entire domain was set (msg.path === ''), re-pull from msg.full or skip.
    if (msg.domain === domain && !msg.path && !msg.full) return;

    // If a full snapshot was broadcast, prefer that. Otherwise, check exact path.
    if (msg.full) {
      const v = readPath(msg.full?.[domain] || {}, path, undefined);
      if (v === undefined) return;
      const next = (el.type === 'checkbox') ? !!v : _toIn(v);
      const focused = (document.activeElement === el);
      if (!focused) {
        if (el.type === 'checkbox') el.checked = next;
        else el.value = next;
        onChange?.(v);
      }
      return;
    }
    if (msg.domain === domain && msg.path === path) {
      const v = msg.value;
      const next = (el.type === 'checkbox') ? !!v : _toIn(v);
      const focused = (document.activeElement === el);
      if (!focused) {
        if (el.type === 'checkbox') el.checked = next;
        else el.value = next;
        onChange?.(v);
      }
    }
  });
}

// ---------- Tabs ----------
dom.tabs.addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  for (const el of dom.tabs.querySelectorAll('.tab')) el.classList.toggle('active', el === t);
  const key = t.dataset.view;
  for (const v of document.querySelectorAll('.view')) v.classList.remove('active');
  document.getElementById(`view-${key}`).classList.add('active');
});

// ---------- CONNECT: Globals (two-way bound) ----------
function updateGlobalsAuthVisibility() {
  const t = (dom.gAuth.value || 'none').toLowerCase();
  const showUser = t === 'sasl';
  const showPass = t === 'sasl' || t === 'nickserv';
  dom.gAuthUserRow.style.display = showUser ? '' : 'none';
  dom.gAuthPassRow.style.display = showPass ? '' : 'none';
}

function bindGlobals() {
  // Prefer the fresh snapshot (merged), fallback to CONNECT defaults
  const g = (snapshot && snapshot.globals) ? snapshot.globals : CONNECT.globals;

  // Seed current UI fields from merged state
  dom.gAuth.value     = (g.authType || 'none').toLowerCase();
  dom.gNick.value     = g.nick || '';
  dom.gAuthUser.value = g.authUsername || '';
  dom.gAuthPass.value = g.authPassword || '';
  dom.gReal.value     = g.realname || '';
  updateGlobalsAuthVisibility();

  // Live bindings to singleton (two-way)
  bindPath(dom.gAuth,     'globals', 'authType', {
    toOut: (raw) => String(raw || 'none').toLowerCase(),
    onChange: () => updateGlobalsAuthVisibility()
  });
  bindPath(dom.gNick,     'globals', 'nick',         { toOut: (raw) => (String(raw).trim() || 'guest') });
  bindPath(dom.gAuthUser, 'globals', 'authUsername', { toOut: (raw) => (String(raw).trim() || null) });
  bindPath(dom.gAuthPass, 'globals', 'authPassword', { toOut: (raw) => (String(raw) || null) });
  bindPath(dom.gReal,     'globals', 'realname',     { toOut: (raw) => (String(raw).trim() || 'Guest') });

  // Button: save everything currently in memory to disk
  dom.saveGlobals?.addEventListener('click', async () => {
    try { await api.settings.saveAll(); alert('Settings saved.'); }
    catch (e) { console.error('[globals saveAll]', e); alert('Failed to save settings (see console).'); }
  });
}

// ---------- CONNECT: Servers (reuse shared partial; Connect hidden) ----------
async function hydrateConnect() {
  // Globals → (re)bind using current snapshot
  bindGlobals();

  // Initialize controller once, then hydrate whenever needed
  if (!profilesCtl) {
    profilesCtl = createProfilesListController(dom.serversList, {
      includeConnect: false, // hide "Connect" in Settings
    });
  }
  await profilesCtl.hydrate();
}

dom.addServerTop.addEventListener('click', () => profilesCtl?.openEditor(null));
dom.addServerBottom.addEventListener('click', () => profilesCtl?.openEditor(null));

// ---------- Generic KV editors (auto-built from singleton) ----------
const flatten = (obj, prefix = '') => {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    const kk = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, kk));
    else out.push([kk, v]);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
};

function renderKVTable(body, domain, rootObj) {
  body.textContent = '';
  const rows = flatten(rootObj);
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.className = 'muted';
    td.textContent = 'No keys.';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  for (const [fullKey, value] of rows) {
    const tr = document.createElement('tr');

    const tdKey = document.createElement('td');
    tdKey.className = 'k';
    tdKey.textContent = fullKey;

    const tdVal = document.createElement('td');
    const input = document.createElement('input');
    input.className = 'kv-input';
    input.value = value == null ? '' : String(value);

    // two-way bind each path
    const path = fullKey; // within domain
    input.addEventListener('change', () => api.settings.setPath(domain, path, coerce(input.value)));
    input.addEventListener('blur',   () => api.settings.setPath(domain, path, coerce(input.value)));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); api.settings.setPath(domain, path, coerce(input.value)); input.blur(); }
    });

    // reflect external changes
    api.events.on('settings:changed', (msg) => {
      if (!msg) return;
      if (msg.domain === domain && msg.path === path && document.activeElement !== input) {
        input.value = msg.value == null ? '' : String(msg.value);
      }
      if (msg.full && document.activeElement !== input) {
        const v = readPath(msg.full?.[domain] || {}, path, undefined);
        if (v !== undefined) input.value = v == null ? '' : String(v);
      }
    });

    tdVal.appendChild(input);
    tr.append(tdKey, tdVal);
    body.appendChild(tr);
  }
}

function renderUI() {
  const src = (snapshot && snapshot.ui && typeof snapshot.ui === 'object') ? snapshot.ui : UI;
  renderKVTable(dom.uiBody, 'ui', src);
}

function renderPerf() {
  const src = (snapshot && snapshot.perf && typeof snapshot.perf === 'object') ? snapshot.perf : PERF;// fallback to defaults if snapshot is absent
  renderKVTable(dom.perfBody, 'perf', src);
}
// ---------- Hydration ----------
async function hydrate() {
  await refreshPathPill();
  snapshot = await api.settings.getAll();
  try { api?.events?.emit?.('settings:changed', { full: snapshot }); } catch {}
  await hydrateConnect();
  renderUI();
  renderPerf();
}

dom.btnReload?.addEventListener('click', hydrate);

// Hard reset → clear persisted file + in-memory cache, then rebuild the UI
dom.btnReset?.addEventListener('click', async () => {
  if (!confirm('Reset ALL settings to defaults? This cannot be undone.')) return;
  dom.btnReset.disabled = true;
  try {
    // Clears persisted store and memory cache; emits a settings:changed event.
    await api.settings.resetAll();
    alert('Settings reset. Defaults are now active.');
  } catch (e) {
    console.error('[settings resetAll]', e);
    alert('Failed to reset settings (check console).');
  }
  // Refresh our local snapshot and re-render the active panels
  await hydrate();
  dom.btnReset.disabled = false;
});

// Live updates: when main updates the singleton, reflect without manual reload
try { api?.events?.on?.('settings:changed', (payload) => {
    if (!payload?.full) return;
    snapshot = payload.full;

    // Update only the visible panel for snappy UX
    const active = document.querySelector('.view.active')?.id || '';

    if (active === 'view-connect') {
      hydrateConnect();
    } else if (active === 'view-ui') {
      renderUI();
    } else if (active === 'view-perf') {
      renderPerf();
    }

    refreshPathPill();
  });
} catch (e) { console.warn('[settings] live update wiring failed (non-fatal)', e); }

hydrate();
