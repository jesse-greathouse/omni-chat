import { DEFAULTS } from './defaults.js';

// A single, human-scannable sheet of defaults.
// Other domain files import from here and "spread out" their slice.
export const SHEET = Object.freeze({
  // UI -----------------------------------------------------------------------
  ui: {
    footerGap: '6px',
  },

  // Performance ---------------------------------------------------------------
  perf: {
    TRANSCRIPT_MAX_LINES: 2000,
    TRANSCRIPT_PRUNE_CHUNK: 200,
    TRANSCRIPT_MAX_APPEND_PER_FRAME: 200,
    TRANSCRIPT_BATCH_MS: 16,
    TRANSCRIPT_SNAP_THRESHOLD_PX: 40,

    CHANLIST_RENDER_CAP: 5000,
    CHANLIST_RAF_RENDER: true,
  },

  // Connect ------------------------------------------------------------------
  connect: {
    globals: {
      nick: 'guest',
      realname: 'Guest',
      authType: 'none',
      authUsername: null,
      authPassword: null,
    },
    servers: {
      'irc.libera.chat': {
        host: 'irc.libera.chat',
        port: DEFAULTS.IRC.PORT_TLS,
        tls: true,
        nick: null,
        realname: null,
        authType: null,
        authUsername: null,
        authPassword: null,
      },
    },
  },
});
