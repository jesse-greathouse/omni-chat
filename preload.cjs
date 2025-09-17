const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omni', {
  // Settings / config access
  getSetting:     (key, fallback) => ipcRenderer.invoke('settings:get', key, fallback),
  setSetting:     (key, value)    => ipcRenderer.invoke('settings:set', key, value),
  getAllSettings: ()              => ipcRenderer.invoke('settings:all'),
  getSettingsPath:()              => ipcRenderer.invoke('settings:path'),

  // Server profiles (global + per-server)
  profilesList:    ()                        => ipcRenderer.invoke('profiles:list'),
  profilesUpsert:  (host, profile)           => ipcRenderer.invoke('profiles:upsert', host, profile),
  profilesDelete:  (host)                    => ipcRenderer.invoke('profiles:delete', host),
  profilesResolve: (host)                    => ipcRenderer.invoke('profiles:resolve', host), // merged w/ globals

  // UI pub/sub (used e.g. by Channel List window to track active session)
  publishUI: (event, payload) => ipcRenderer.send('ui-pub', { event, payload }),
  onUI: (event, cb) => ipcRenderer.on(`ui-sub:${event}`, (_e, payload) => cb(payload)),
});

contextBridge.exposeInMainWorld('sessions', {
  // lifecycle
  start:   (id, opts) => ipcRenderer.invoke('session:start', id, opts),
  stop:    (id)       => ipcRenderer.invoke('session:stop', id),
  restart: (id, opts) => ipcRenderer.invoke('session:restart', id, opts),

  // IO
  send: (id, line) => ipcRenderer.send('session:send', { id, line }),

  // events (all carry { id, ... })
  onData:   (cb) => ipcRenderer.on('session:data',   (_e, payload) => cb(payload)),
  onStatus: (cb) => ipcRenderer.on('session:status', (_e, payload) => cb(payload)),
  onError:  (cb) => ipcRenderer.on('session:error',  (_e, payload) => cb(payload)),
});
