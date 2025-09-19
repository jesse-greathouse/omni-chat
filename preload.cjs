const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bootstrap', {
  // run bootstrap.ps1 in a real PowerShell terminal window
  runInTerminal: () => ipcRenderer.invoke('bootstrap:runTerminal'),

  // start a bootstrap run (invokes PowerShell script)
  start: () => ipcRenderer.invoke('bootstrap:start'),

  // ask main to open the logs folder (userData path)
  openLogsDir: () => ipcRenderer.invoke('bootstrap:openLogs'),

  // after success, ask main to verify and launch the main window
  proceedIfReady: () => ipcRenderer.send('bootstrap:proceed-if-ready'),

  // stream logs / completion / error
  onLog: (cb) => {
    const fn = (_e, line) => { try { cb(String(line)); } catch {} };
    ipcRenderer.on('bootstrap:log', fn);
    return () => ipcRenderer.off('bootstrap:log', fn);
  },
  onDone: (cb) => {
    const fn = () => { try { cb(); } catch {} };
    ipcRenderer.on('bootstrap:done', fn);
    return () => ipcRenderer.off('bootstrap:done', fn);
  },
  onError: (cb) => {
    const fn = (_e, code) => { try { cb(code); } catch {} };
    ipcRenderer.on('bootstrap:error', fn);
    return () => ipcRenderer.off('bootstrap:error', fn);
  }
});

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
  onData:   (cb) => {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on('session:data', fn);
    return () => ipcRenderer.off('session:data', fn);
  },
  onStatus: (cb) => {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on('session:status', fn);
    return () => ipcRenderer.off('session:status', fn);
  },
  onError:  (cb) => {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on('session:error', fn);
    return () => ipcRenderer.off('session:error', fn);
  },
});
