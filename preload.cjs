const { contextBridge, ipcRenderer } = require('electron');

/*--------------------------------------------------
  Tiny in-memory event bus (matches adapter.js semantics)
---------------------------------------------------*/
class Bus {
  constructor() { this._m = new Map(); }
  on(topic, fn) {
    const t = String(topic);
    const arr = this._m.get(t) || [];
    arr.push(fn);
    this._m.set(t, arr);
    return () => this.off(t, fn);
  }
  off(topic, fn) {
    const t = String(topic);
    const arr = this._m.get(t);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
    if (arr.length === 0) this._m.delete(t);
  }
  emit(topic, payload) {
    const arr = this._m.get(String(topic));
    if (!arr) return;
    for (const fn of arr.slice()) { try { fn(payload); } catch {} }
  }
}
const bus = new Bus();

/*--------------------------------------------------
  Canonical topics (mirror of renderer/lib/adapter.js TOPICS)
---------------------------------------------------- */
const EVT = {
  CONN_STATUS:   'conn:status',
  CONN_ERROR:    'conn:error',
  CONN_LINE:     'conn:line',
  CHAN_SNAPSHOT: 'chan:snapshot',
  CHAN_UPDATE:   'chan:update',
  DM_LINE:       'dm:line',
  DM_USER:       'dm:user',
  DM_NOTIFY:     'dm:notify',
  UI_ACTIVE:     'ui:active-session',
  ERROR:         'error',
};

/*--------------------------------------------------
  Helpers
--------------------------------------------------- */
const once = (ch, fn) => {
  const h = (_e, payload) => { try { fn(payload); } finally { ipcRenderer.removeListener(ch, h); } };
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};
const on = (ch, fn) => {
  const h = (_e, payload) => { try { fn(payload); } catch {} };
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

/*--------------------------------------------------
  Wire main -> renderer notifications into our local Bus
  (main sends these via sendToAll(...) in main.js)
---------------------------------------------------- */
// Session lifecycle & stream
ipcRenderer.on('session:status', (_e, p) =>
  bus.emit(EVT.CONN_STATUS, { sessionId: p.id, status: p.status })
);
ipcRenderer.on('session:error', (_e, p) =>
  bus.emit(EVT.CONN_ERROR, { sessionId: p.id, message: p.message })
);
ipcRenderer.on('session:data', (_e, p) =>
  bus.emit(EVT.CONN_LINE, { sessionId: p.id, line: p.line })
);

// Bootstrap streaming log/status
ipcRenderer.on('bootstrap:log',   (_e, line) => bootstrapEmit('log', line));
ipcRenderer.on('bootstrap:done',  () => bootstrapEmit('done'));
ipcRenderer.on('bootstrap:error', (_e, code) => bootstrapEmit('error', code));

// DM windows: main emits these directly to the target BrowserWindow
ipcRenderer.on('dm:line', (_e, p) => bus.emit(EVT.DM_LINE, p));
ipcRenderer.on('dm:user', (_e, p) => bus.emit(EVT.DM_USER, p));

// Main will send this when a DM arrives; forward to the in-page bus
ipcRenderer.on('dm:notify', (_e, p) => bus.emit(EVT.DM_NOTIFY, p || {}));

// UI pub/sub bridge (renderer -> main -> all renderers)
// Preload exposes a local bus; .emit publishes to main, and we subscribe to ui-sub:* back.
ipcRenderer.on('ui-sub:*', (_e, payload) => {
  // Optional wildcard catch—kept for future extensions
  if (payload && payload.event) bus.emit(String(payload.event), payload.payload);
});
// Generic "ui-sub:<event>" fan-in:
ipcRenderer.onAny?.((ch, payload) => {
  // Electron doesn't have onAny; this branch is a no-op. We rely on targeted handlers below.
});

// Instead, register a generic handler that matches our main.js pattern:
const UI_SUB_PREFIX = 'ui-sub:';
ipcRenderer.on(UI_SUB_PREFIX + EVT.UI_ACTIVE, (_e, payload) => bus.emit(EVT.UI_ACTIVE, payload));
// (Add more mapped topics here if you expand UI pub/sub usage in the future)

/*--------------------------------------------------
  DM window bootstrap: remember current sessionId/peer set by main via 'dm:init'
---------------------------------------------------- */
const dmState = { sessionId: null, peer: null };
ipcRenderer.on('dm:init', (_e, { sessionId, peer, bootLines } = {}) => {
  if (sessionId) dmState.sessionId = sessionId;
  if (peer)      dmState.peer = peer;

  // Fan any bootLines into our standard DM_LINE stream so the renderer code sees them consistently.
  if (Array.isArray(bootLines)) {
    for (const l of bootLines) {
      bus.emit(EVT.DM_LINE, { sessionId, ...l });
    }
  }
});

/*--------------------------------------------------
  Bootstrap listeners registry (scoped, light abstraction)
---------------------------------------------------- */
const bootstrapListeners = {
  log: new Set(),
  done: new Set(),
  error: new Set()
};
function bootstrapOn(kind, fn) {
  const set = bootstrapListeners[kind];
  if (!set) return () => {};
  set.add(fn);
  return () => set.delete(fn);
}
function bootstrapEmit(kind, payload) {
  const set = bootstrapListeners[kind];
  if (!set) return;
  for (const fn of Array.from(set)) { try { fn(payload); } catch {} }
}

/*--------------------------------------------------
  Exposed API
---------------------------------------------------- */
contextBridge.exposeInMainWorld('api', {
  // Shared event bus for renderer code
  events: {
    on: (topic, fn) => bus.on(topic, fn),
    off: (topic, fn) => bus.off(topic, fn),
    emit: (topic, payload) => {
      // publish to other windows via main if caller wants a cross-window event
      if (String(topic).startsWith('ui:')) {
        ipcRenderer.send('ui-pub', { event: String(topic), payload });
      }
      // also loopback locally so the calling renderer gets it immediately
      bus.emit(String(topic), payload);
    }
  },

  /* Sessions */
  sessions: {
    start: (id, opts) => ipcRenderer.invoke('session:start', id, opts),
    stop:  (id)       => ipcRenderer.invoke('session:stop', id),
    restart: (id, opts) => ipcRenderer.invoke('session:restart', id, opts),
    send:  (id, line) => ipcRenderer.send('session:send', { id, line }),

    // Optional direct subscriptions (most code uses events bus)
    onStatus: (fn) => on('session:status', (_p) => fn?.(_p)),
    onError:  (fn) => on('session:error',  (_p) => fn?.(_p)),
    onData:   (fn) => on('session:data',   (_p) => fn?.(_p)),
  },

  /* DMs */
  dm: {
    open: async (sessionId, peer, bootLine) =>
      ipcRenderer.invoke('dm:open', { sessionId, peer, bootLine }),

    notify: (sessionId, peer) =>
      ipcRenderer.send('dm:notify', { sessionId, peer }),

    requestUser: (sessionId, nick) =>
      ipcRenderer.send('dm:request-user', { sessionId, nick }),

    pushUser: (sessionId, user) =>
      ipcRenderer.send('dm:push-user', { sessionId, user }),

    // Make current DM session/peer accessible to renderer/dm.js at startup
    current: dmState
  },

  /* Settings */
  settings: {
    get: (key, fallback) => ipcRenderer.invoke('settings:get', key, fallback),
    set: (key, value)    => ipcRenderer.invoke('settings:set', key, value),
    getAll:              () => ipcRenderer.invoke('settings:all'),
    path:                () => ipcRenderer.invoke('settings:path'),
  },

  /* Profiles */
  profiles: {
    list:    ()               => ipcRenderer.invoke('profiles:list'),
    upsert:  (host, profile)  => ipcRenderer.invoke('profiles:upsert', host, profile),
    del:     (host)           => ipcRenderer.invoke('profiles:delete', host),
    resolve: (host)           => ipcRenderer.invoke('profiles:resolve', host),
  },

  /* Bootstrap */
  bootstrap: {
    runInTerminal:   () => ipcRenderer.invoke('bootstrap:runTerminal'),
    openLogsDir:     () => ipcRenderer.invoke('bootstrap:openLogs'),
    proceedIfReady:  () => ipcRenderer.send('bootstrap:proceed-if-ready'),

    onLog:   (fn) => bootstrapOn('log', fn),
    onDone:  (fn) => bootstrapOn('done', fn),
    onError: (fn) => bootstrapOn('error', fn),
  },
});
