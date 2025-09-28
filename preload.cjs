// preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

// Tiny in-page bus
const bus = (() => {
  const m = new Map();
  return {
    on(topic, fn) {
      const t = String(topic);
      const arr = m.get(t) || [];
      arr.push(fn);
      m.set(t, arr);
      return () => {
        const cur = m.get(t) || [];
        const i = cur.indexOf(fn);
        if (i >= 0) cur.splice(i, 1);
        if (cur.length === 0) m.delete(t);
      };
    },
    emit(topic, payload) {
      const arr = m.get(String(topic));
      if (!arr) return;
      for (const fn of arr.slice()) { try { fn(payload); } catch {} }
    }
  };
})();

// Canonical topic names (renderer imports its own constants, but strings match)
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

// Helper: forward under both legacy and canonical names
const dual = (legacyTopic, canonicalTopic, payload) => {
  if (legacyTopic) bus.emit(legacyTopic, payload);
  if (canonicalTopic) bus.emit(canonicalTopic, payload);
};

// Still support multiplex 'evt' from main
ipcRenderer.on('evt', (_e, { topic, payload }) => { if (topic) bus.emit(topic, payload); });

/**
 * Session bridges
 * Maintain legacy 'sessions:*' while emitting canon 'conn:*'
 */
ipcRenderer.on('session:status', (_e, p) => {
  bus.emit('conn:status', { sessionId: p.id, status: p.status });
});

ipcRenderer.on('session:error', (_e, p) => {
  bus.emit('conn:error', { sessionId: p.id, message: p.message });
});

ipcRenderer.on('session:data', (_e, p) => {
  bus.emit('conn:line', { sessionId: p.id, line: p.line });
});

/**
 * DM bridges
 * Keep legacy topics AND emit canonical:
 *   - dm:init   → emits dm:user (peer stub), dm:line (boot lines), dm:notify
 *   - dm:user   → dm:user
 *   - dm:line   → dm:line
 *   - dm:play-sound → dm:notify
 */
ipcRenderer.on('dm:init', (_e, p) => {
  // legacy fire for old listeners (if any still exist)
  bus.emit('dm:init', p);

  const { sessionId, peer, bootLines } = p || {};
  if (peer) {
    // Minimal user object so DM header can render immediately
    bus.emit(EVT.DM_USER, { sessionId, user: { nick: peer } });
  }
  if (Array.isArray(bootLines)) {
    for (const l of bootLines) {
      bus.emit(EVT.DM_LINE, {
        sessionId,
        from:  l.from,
        to:    peer || l.to || '',
        kind:  l.kind || 'PRIVMSG',
        text:  l.text,
        peer:  peer || l.peer || l.from
      });
    }
  }
  // Attention nudge (sound/badge)
  bus.emit(EVT.DM_NOTIFY, { sessionId, peer: peer || null });
});

ipcRenderer.on('dm:user', (_e, p) => {
  dual('dm:user', EVT.DM_USER, p);
});

ipcRenderer.on('dm:line', (_e, p) => {
  dual('dm:line', EVT.DM_LINE, p);
});

ipcRenderer.on('dm:play-sound', () => {
  // legacy one had no payload; canonical one carries optional {sessionId, peer}
  bus.emit('dm:play-sound');
  bus.emit(EVT.DM_NOTIFY, {});
});

/**
 * Optional channel list snapshot from main (if ever sent)
 * (Renderer also builds snapshots locally; keeping this allows main to push.)
 */
ipcRenderer.on('chan:snapshot', (_e, p) => {
  bus.emit(EVT.CHAN_SNAPSHOT, p);
});

/**
 * Bootstrap bridges
 */
ipcRenderer.on('bootstrap:log',   (_e, p) => bus.emit('bootstrap:log',   p));
ipcRenderer.on('bootstrap:done',  ()      => bus.emit('bootstrap:done'));
ipcRenderer.on('bootstrap:error', (_e, p) => bus.emit('bootstrap:error', p));

const onTopic = (topic) => (fn) => bus.on(topic, fn);

const api = {
  events: {
    on:   (topic, fn) => bus.on(topic, fn),
    off:  (_topic, _fn) => { /* on() returns a disposer; keep as-is */ },
    emit: (topic, payload) => bus.emit(topic, payload),
  },

  sessions: {
    start:   (id, opts) => ipcRenderer.invoke('session:start',   id, opts),
    stop:    (id)       => ipcRenderer.invoke('session:stop',    id),
    restart: (id, opts) => ipcRenderer.invoke('session:restart', id, opts),
    send:    (id, line) => ipcRenderer.send('session:send', { id, line }),
    onStatus: onTopic('sessions:status'), // legacy — ok to keep for now
    onError:  onTopic('sessions:error'),
    onData:   onTopic('sessions:data'),
  },

  dm: {
    open:        (sessionId, peer, bootLine) => ipcRenderer.invoke('dm:open', { sessionId, peer, bootLine }),
    notify:      (sessionId, peer)           => ipcRenderer.send('dm:notify', { sessionId, peer }),
    requestUser: (sessionId, nick)           => ipcRenderer.send('dm:request-user', { sessionId, nick }),
    pushUser:    () => {}, // main -> renderer only
  },

  settings: {
    getAll: ()               => ipcRenderer.invoke('settings:all'),
    set:    (key, value)     => ipcRenderer.invoke('settings:set', key, value),
  },

  profiles: {
    list:    ()                      => ipcRenderer.invoke('profiles:list'),
    resolve: (host)                  => ipcRenderer.invoke('profiles:resolve', host),
    upsert:  (host, payload)         => ipcRenderer.invoke('profiles:upsert', host, payload),
    del:     (host)                  => ipcRenderer.invoke('profiles:delete', host),
  },

  bootstrap: {
    runInTerminal:     () => ipcRenderer.invoke('bootstrap:runTerminal'),
    startInBackground: () => ipcRenderer.invoke('bootstrap:start'),
    openLogsDir:       () => ipcRenderer.invoke('bootstrap:openLogs'),
    proceedIfReady:    () => ipcRenderer.send('bootstrap:proceed-if-ready'),

    onLog:   onTopic('bootstrap:log'),
    onDone:  onTopic('bootstrap:done'),
    onError: onTopic('bootstrap:error'),
  },
};

contextBridge.exposeInMainWorld('api', api);
