// preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

/* helpers */
function safeOn(channel, cb) {
  // wrap to avoid unhandled exceptions crossing the bridge
  const fn = (_e, payload) => { try { cb(payload); } catch {} };
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.off(channel, fn);
}
function safeInvoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}
function safeSend(channel, payload) {
  ipcRenderer.send(channel, payload);
}

/* bootstrap */
contextBridge.exposeInMainWorld('bootstrap', {
  runInTerminal: () => safeInvoke('bootstrap:runTerminal'),
  start:         () => safeInvoke('bootstrap:start'),
  openLogsDir:   () => safeInvoke('bootstrap:openLogs'),
  proceedIfReady:() => safeSend('bootstrap:proceed-if-ready'),

  onLog:   (cb) => safeOn('bootstrap:log',   (line) => cb(String(line))),
  onDone:  (cb) => safeOn('bootstrap:done',  () => cb()),
  onError: (cb) => safeOn('bootstrap:error', (code) => cb(code)),
});

/*-- omni--- */
contextBridge.exposeInMainWorld('omni', {
  // Settings
  getSetting:      (key, fallback) => safeInvoke('settings:get', key, fallback),
  setSetting:      (key, value)    => safeInvoke('settings:set', key, value),
  getAllSettings:  ()              => safeInvoke('settings:all'),
  getSettingsPath: ()              => safeInvoke('settings:path'),

  // Server profiles
  profilesList:    ()                          => safeInvoke('profiles:list'),
  profilesUpsert:  (host, profile)             => safeInvoke('profiles:upsert', host, profile),
  profilesDelete:  (host)                      => safeInvoke('profiles:delete', host),
  profilesResolve: (host)                      => safeInvoke('profiles:resolve', host),

  // UI pub/sub
  publishUI: (event, payload) => {
    // don’t let arbitrary objects be used as channel suffixes
    const name = String(event || '');
    if (!name) return;
    safeSend('ui-pub', { event: name, payload });
  },
  onUI: (event, cb) => {
    const name = String(event || '');
    if (!name) return () => {};
    return safeOn(`ui-sub:${name}`, (payload) => cb(payload));
  },
});

/* sessions- */
contextBridge.exposeInMainWorld('sessions', {
  start:   (id, opts) => safeInvoke('session:start', id, opts),
  stop:    (id)       => safeInvoke('session:stop', id),
  restart: (id, opts) => safeInvoke('session:restart', id, opts),

  send: (id, line) => safeSend('session:send', { id, line }),

  onData:   (cb) => safeOn('session:data',   (payload) => cb(payload)),
  onStatus: (cb) => safeOn('session:status', (payload) => cb(payload)),
  onError:  (cb) => safeOn('session:error',  (payload) => cb(payload)),
});

/* dm */
/*
  These are the important bits that let ingest.js push user info and
  the DM window subscribe to it. This is what fixes the “User null/unknown not found”
  symptom when WHOIS/user snapshots arrive.
*/
contextBridge.exposeInMainWorld('dm', {
  onPlaySound: (cb) => safeOn('dm:play-sound', () => cb?.()),

  // Ask main to open (or focus) a DM window; main should respond with 'dm:init'
  open: (sessionId, peer, bootLine) =>
    safeInvoke('dm:open', { sessionId, peer, bootLine }),

  // Ask main to gently notify the specific DM window:
  //  - if minimized  → attention()
  //  - else if not focused → nudge()
  //  - else do nothing
  notify: (sessionId, peer) =>
    safeSend('dm:notify', { sessionId, peer }),

  // DM window init payload from main
  onInit: (cb) => safeOn('dm:init', (payload) => cb(payload)),

  // New DM line routed from main (ingest → main → dm window)
  onLine: (cb) => safeOn('dm:line', (payload) => cb(payload)),

  // Renderer → main: push a fresh/updated user object for the DM window
  pushUser: (sessionId, user) =>
    safeSend('dm:push-user', { sessionId, user }),

  // DM window subscribes to user updates (WHOIS, account, away, etc.)
  onUser: (cb) => safeOn('dm:user', (payload) => cb(payload)),

  // DM window can request user info on first paint / when peer becomes known
  requestUser: (sessionId, nick) =>
    safeSend('dm:request-user', { sessionId, nick }),
});
