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

// Use the injected API from preload; fall back to a no-op in dev
const injected = globalThis.window?.api;
if (!injected) {
  console.warn('[adapter] window.api not injected; using inert shim for dev.');
}

const inert = {
  events: new Bus(),
  sessions: { start: async()=>{}, stop:()=>{}, send:()=>{}, onStatus:()=>{}, onError:()=>{}, onData:()=>{} },
  dm: { open: async()=>{}, notify:()=>{}, requestUser:()=>{}, pushUser:()=>{} },
  settings: { getAll: async()=>({}), set: async()=>{} },
  profiles: { list: async()=>({}), resolve: async(h)=>({ host:h }), upsert: async()=>{}, del: async()=>{} },
  bootstrap: { runInTerminal:()=>{}, openLogsDir:()=>{}, proceedIfReady:()=>{}, onLog:()=>()=>{}, onDone:()=>()=>{}, onError:()=>()=>{} },
};

export const api = injected || inert;
