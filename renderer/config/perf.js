import { SHEET } from './baseline.js';

// Reference-stable, live object.
export const PERF = { ...SHEET.perf };

// seed
try {
  Object.assign(PERF, (globalThis.api?.__settingsCache?.perf || {}));
} catch (e) { console.warn('[settings:perf config seed] failed', e); }

// live updates
try {
  globalThis.api?.events?.on?.('settings:changed', (msg) => {
    if (msg?.full?.perf) {
      Object.assign(PERF, { ...SHEET.perf, ...msg.full.perf });
      return;
    }
    if (msg?.domain === 'perf' && msg.path) {
      const next = { ...PERF };
      const parts = msg.path.split('.');
      let t = next; for (let i = 0; i < parts.length - 1; i++) t = (t[parts[i]] ||= {});
      t[parts.at(-1)] = msg.value;
      Object.assign(PERF, { ...SHEET.perf, ...next });
    }
  });
} catch (e) { console.warn('[settings:perf config live update] failed', e); }
