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
    for (const fn of arr.slice()) {
      try { fn(payload); }
      catch (e) { console.error('[adapter bus listener]', String(topic), e); }
    }
  }
}

/** Canonical topics (single source of truth for event names). */
export const TOPICS = Object.freeze({
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
});

/**
 * @typedef {{sessionId:string,status:"starting"|"online"|"offline"|"error"}} ConnStatus
 * @typedef {{sessionId:string,message:string}} ConnError
 * @typedef {{sessionId:string,line:string}} ConnLine
 * @typedef {{sessionId:string,items:{name:string,users:number,topic:string}[]}} ChanSnapshot
 * @typedef {{sessionId:string,channel:{name:string,topic?:string,users?:string[]}}} ChanUpdate
 * @typedef {{sessionId:string,from:string,to:string,kind:"PRIVMSG"|"NOTICE",text:string}} DMLine
 * @typedef {{sessionId:string,user:Object}} DMUser
 * @typedef {{sessionId:string,peer:string}} DMNotify
 * @typedef {{id:string}} UIActive
 * @typedef {{scope:string,message:string}} UIError
 */

// Use the injected API from preload; fall back to a no-op in dev
// Helper to read the injected API when available
const getInjected = () => (typeof window !== 'undefined' ? window.api : null);

const inert = {
  __inert: true,
  events: new Bus(),
  sessions: { start: async()=>{}, stop:()=>{}, send:()=>{}, onStatus:()=>{}, onError:()=>{}, onData:()=>{} },
  dm: { open: async()=>{}, notify:()=>{}, requestUser:()=>{}, pushUser:()=>{} },
  settings: {
    getAll: async()=>({}),
    set: async()=>{},
    setPath: async()=>{},
    saveAll: async()=>true,
    path: async()=>'(inert-store.json)',
    resetAll: async()=>{},
  },
  profiles: { list: async()=>({}), resolve: async(h)=>({ host:h }), upsert: async()=>{}, del: async()=>{} },
  bootstrap: { runInTerminal:()=>{}, openLogsDir:()=>{}, proceedIfReady:()=>{}, onLog:()=>()=>{}, onDone:()=>()=>{}, onError:()=>()=>{} },
};

// Track which properties we've already warned about (avoid recursion on the proxy)
const _warnedProps = new Set();

// Lazy proxy: every access re-checks if preload has injected the real API.
export const api = new Proxy({}, {
  get(_t, prop) {
    const inj = getInjected() || inert;
    if (inj.__inert && prop !== 'events' && prop !== '__inert') {
      // Only warn for string props; skip Symbols like util.inspect/toStringTag
      if (typeof prop === 'string' && !_warnedProps.has(prop)) {
        console.warn(`[adapter] inert API in use (preload missing?) when accessing "${prop}"`);
        _warnedProps.add(prop);
      }
    }
    return inj[prop];
  },
  has(_t, prop) {
    const inj = getInjected() || inert;
    return prop in inj;
  }
});

// Keep events dynamic as well (avoid capturing the inert bus too early)
export const events = new Proxy({}, {
  get(_t, prop) {
    const inj = getInjected() || inert;
    return inj.events[prop];
  }
});
export { TOPICS as EVT };
