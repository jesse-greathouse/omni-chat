import { SHEET } from './baseline.js';

// Live, reference-stable object.
// Do NOT freeze; we mutate inner objects so imports stay live.
export const CONNECT = {
  globals: { ...SHEET.connect.globals },
  servers: { ...SHEET.connect.servers },
};

function patchObject(target, next) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, next);
}

function mergeFromCache() {
  const cache = globalThis.api?.__settingsCache || {};
  const cg = cache.globals || {};
  const cs = cache.servers || {};
  return {
    globals: { ...SHEET.connect.globals, ...cg },
    servers: { ...SHEET.connect.servers, ...cs },
  };
}

// initial seed
try {
  const m = mergeFromCache();
  patchObject(CONNECT.globals, m.globals);
  patchObject(CONNECT.servers, m.servers);
} catch (e) { console.warn('[settings:connect config seed] failed', e); }

// live updates
try {
  globalThis.api?.events?.on?.('settings:changed', (msg) => {
    if (msg?.full) {
      const m = {
        globals: { ...SHEET.connect.globals, ...(msg.full.globals || {}) },
        servers: { ...SHEET.connect.servers, ...(msg.full.servers || {}) },
      };
      patchObject(CONNECT.globals, m.globals);
      patchObject(CONNECT.servers, m.servers);
      return;
    }


    if (msg?.domain === 'globals') {
      // Domain-level set (replace/merge whole globals)
      if (!msg.path) {
        const next = { ...SHEET.connect.globals, ...(msg.value || {}) };
        patchObject(CONNECT.globals, next);
        return;
      }
      // Granular path update
      const next = { ...CONNECT.globals };
      const parts = String(msg.path).split('.').filter(Boolean);
      let t = next;
      for (let i = 0; i < parts.length - 1; i++) t = (t[parts[i]] ||= {});
      t[parts[parts.length - 1]] = msg.value;
      patchObject(CONNECT.globals, { ...SHEET.connect.globals, ...next });
    }

    if (msg?.domain === 'servers') {
      // msg.path is the host key for full row upsert/delete
      const cur = { ...CONNECT.servers };
      const host = String(msg.path || '');
      if (msg.value == null) delete cur[host];
      else cur[host] = { ...(cur[host] || {}), ...(msg.value || {}) };
      patchObject(CONNECT.servers, { ...SHEET.connect.servers, ...cur });
    }
  });
} catch (e) { console.warn('[settings:connect config live update] failed', e); }
