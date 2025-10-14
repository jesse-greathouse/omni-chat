import { SHEET } from './baseline.js';

// Reference-stable object; keep it live by mutating, not replacing.
export const UI = { ...SHEET.ui };

// seed
try {
  Object.assign(UI, (globalThis.api?.__settingsCache?.ui || {}));
} catch (e) { console.warn('[settings:ui config seed] failed', e); }

// live updates (full + granular)
try {
  globalThis.api?.events?.on?.('settings:changed', (msg) => {
    if (msg?.full?.ui) {
      Object.assign(UI, { ...SHEET.ui, ...msg.full.ui });
      return;
    }
    if (msg?.domain === 'ui' && msg.path) {
      const next = { ...UI };
      const parts = msg.path.split('.');
      let t = next;
      for (let i = 0; i < parts.length - 1; i++) t = (t[parts[i]] ||= {});
      t[parts.at(-1)] = msg.value;
      Object.assign(UI, { ...SHEET.ui, ...next });
    }
  });
} catch (e) { console.warn('[settings:ui config live update] failed', e); }
