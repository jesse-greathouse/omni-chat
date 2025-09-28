const { contextBridge, ipcRenderer } = require('electron');

// Tiny bus
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

// Still support the 'evt' multiplex channel if main sends it
ipcRenderer.on('evt', (_e, { topic, payload }) => { if (topic) bus.emit(topic, payload); });

// NEW: forward main's direct channels into the bus under the names the renderer uses
ipcRenderer.on('session:status', (_e, p) => bus.emit('sessions:status', p));
ipcRenderer.on('session:error',  (_e, p) => bus.emit('sessions:error',  p));
ipcRenderer.on('session:data',   (_e, p) => bus.emit('sessions:data',   p));

ipcRenderer.on('dm:init',        (_e, p) => bus.emit('dm:init',        p));
ipcRenderer.on('dm:user',        (_e, p) => bus.emit('dm:user',        p));
ipcRenderer.on('dm:line',        (_e, p) => bus.emit('dm:line',        p));
ipcRenderer.on('dm:play-sound',  ()      => bus.emit('dm:play-sound'));

ipcRenderer.on('bootstrap:log',  (_e, p) => bus.emit('bootstrap:log',  p));
ipcRenderer.on('bootstrap:done', ()      => bus.emit('bootstrap:done'));
ipcRenderer.on('bootstrap:error',(_e, p) => bus.emit('bootstrap:error',p));

const onTopic = (topic) => (fn) => bus.on(topic, fn);

const api = {
  events: {
    on:   (topic, fn) => bus.on(topic, fn),
    off:  (_topic, _fn) => { /* on() returns a disposer; keep as-is */ },
    emit: (topic, payload) => bus.emit(topic, payload),
  },

  // Use main's existing singular channel names
  sessions: {
    start: (id, opts) => ipcRenderer.invoke('session:start', id, opts),
    stop:  (id)       => ipcRenderer.invoke('session:stop',  id),
    // optional, you have restart; expose if you need it:
    restart:(id, opts)=> ipcRenderer.invoke('session:restart', id, opts),
    send:  (id, line) => ipcRenderer.send('session:send', { id, line }),
    onStatus: onTopic('sessions:status'),
    onError:  onTopic('sessions:error'),
    onData:   onTopic('sessions:data'),
  },

  dm: {
    open:        (sessionId, peer, bootLine) => ipcRenderer.invoke('dm:open', { sessionId, peer, bootLine }),
    notify:      (sessionId, peer)           => ipcRenderer.send('dm:notify', { sessionId, peer }),
    requestUser: (sessionId, nick)           => ipcRenderer.send('dm:request-user', { sessionId, nick }),
    // pushUser is main->renderer; not called from renderer
    pushUser:    () => {},
  },

  // Match main's settings API (use 'settings:all' instead of the missing 'settings:getAll')
  settings: {
    getAll: ()                 => ipcRenderer.invoke('settings:all'),
    set:    (key, value)       => ipcRenderer.invoke('settings:set', key, value),
  },

  profiles: {
    list:    ()                      => ipcRenderer.invoke('profiles:list'),
    resolve: (host)                  => ipcRenderer.invoke('profiles:resolve', host),
    upsert:  (host, payload)         => ipcRenderer.invoke('profiles:upsert', host, payload),
    del:     (host)                  => ipcRenderer.invoke('profiles:delete', host),
  },

  // Match main's bootstrap channels
  bootstrap: {
    runInTerminal:  () => ipcRenderer.invoke('bootstrap:runTerminal'),
    // if you ever need background mode from renderer:
    startInBackground: () => ipcRenderer.invoke('bootstrap:start'),
    openLogsDir:    () => ipcRenderer.invoke('bootstrap:openLogs'),
    proceedIfReady: () => ipcRenderer.send('bootstrap:proceed-if-ready'),

    onLog:   onTopic('bootstrap:log'),
    onDone:  onTopic('bootstrap:done'),
    onError: onTopic('bootstrap:error'),
  },
};

contextBridge.exposeInMainWorld('api', api);
