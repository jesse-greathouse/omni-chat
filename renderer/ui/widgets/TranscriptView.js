import { PERF } from '../../config/perf.js';
import { el } from '../../lib/dom.js';
import { UI } from '../../config/ui.js';
import { SHEET } from '../../config/baseline.js';
import { api } from '../../lib/adapter.js';

// Coerce various inputs into a canonical "<int>px" string.
// Accepts: 6, "6", "6px". Falls back if unrecognized.
function normalizePx(val, fallback = '6px') {
  if (val == null) return fallback;
  if (typeof val === 'number' && Number.isFinite(val)) {
    return `${Math.trunc(val)}px`;
  }
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    // Match "123" or "123px"
    const m = /^(\d+)(?:px)?$/.exec(s);
    if (m) return `${Number(m[1])}px`;
  }
  return fallback;
}

export class TranscriptView {
  /**
   * @param {{withTopic?:boolean,maxLines?:number,pruneChunk?:number}} [opts]
   */
  constructor(opts = {}) {
    // The OUTER element is the grid child and carries the `.transcript` class
    // so all the existing CSS (background, overflow, padding) applies to the full area.
    this.root = document.createElement('div');
    this.root.className = 'transcript with-footer-gap';
    this.root.classList.add('pane-root');
    this.withTopic = !!opts.withTopic;
    this.root.style.contain = 'content';

    if (this.withTopic) {
      this.topicEl = el('div', { className: 'topic', text: '' });
      this.root.appendChild(this.topicEl);
    }

    // Append text directly to the root (which scrolls)
    // Single textNode strategy = fast append & cheap layout
    this._lines = [];
    this._pending = [];      // staged lines to flush in batch
    this._pendingRaf = false;
    this._textNode = document.createTextNode('');
    this.root.appendChild(this._textNode);
    this.maxLines   = opts.maxLines   ?? PERF.TRANSCRIPT_MAX_LINES;
    this.pruneChunk = opts.pruneChunk ?? PERF.TRANSCRIPT_PRUNE_CHUNK;
    this._snapPx    = PERF.TRANSCRIPT_SNAP_THRESHOLD_PX;
    this._maxAppend = PERF.TRANSCRIPT_MAX_APPEND_PER_FRAME;

    const toInt = (v, fallback) => {
      if (v == null) return fallback;
      if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
      const n = Number(String(v).trim());
      return Number.isFinite(n) ? Math.trunc(n) : fallback;
    };

    // Bind footer gap to live UI config via CSS var
    const applyGap = () => {
      try {
        const gap = normalizePx(UI.footerGap, SHEET.ui.footerGap);
        this.root.style.setProperty('--footer-gap', gap);
      }
      catch {}
    };

    applyGap();

    try {
      api?.events?.on?.('settings:changed', (msg) => {
        if (!msg) return;

        // UI footer gap live update
        {
          const ui = msg.full?.ui ?? (msg.domain === 'ui' ? msg.value : null);
          if (ui && (msg.full?.ui || msg.path === 'footerGap' || msg.path?.startsWith('footerGap'))) {
            applyGap();
          }
        }

        // PERF live updates relevant to TranscriptView
        {
          const perf = msg.full?.perf ?? (msg.domain === 'perf' ? msg.value : null);
          if (!perf) return;
          // fallbacks to SHEET.perf keep us magic-string free
          if (Object.prototype.hasOwnProperty.call(perf, 'TRANSCRIPT_MAX_LINES') || msg.path === 'TRANSCRIPT_MAX_LINES') {
            this.maxLines = toInt(perf.TRANSCRIPT_MAX_LINES, SHEET.perf.TRANSCRIPT_MAX_LINES);
          }
          if (Object.prototype.hasOwnProperty.call(perf, 'TRANSCRIPT_PRUNE_CHUNK') || msg.path === 'TRANSCRIPT_PRUNE_CHUNK') {
            this.pruneChunk = toInt(perf.TRANSCRIPT_PRUNE_CHUNK, SHEET.perf.TRANSCRIPT_PRUNE_CHUNK);
          }
          if (Object.prototype.hasOwnProperty.call(perf, 'TRANSCRIPT_SNAP_THRESHOLD_PX') || msg.path === 'TRANSCRIPT_SNAP_THRESHOLD_PX') {
            this._snapPx = toInt(perf.TRANSCRIPT_SNAP_THRESHOLD_PX, SHEET.perf.TRANSCRIPT_SNAP_THRESHOLD_PX);
          }
          if (Object.prototype.hasOwnProperty.call(perf, 'TRANSCRIPT_MAX_APPEND_PER_FRAME') || msg.path === 'TRANSCRIPT_MAX_APPEND_PER_FRAME') {
            this._maxAppend = toInt(perf.TRANSCRIPT_MAX_APPEND_PER_FRAME, SHEET.perf.TRANSCRIPT_MAX_APPEND_PER_FRAME);
          }
          // TRANSCRIPT_BATCH_MS exists but isn't used here; no-op unless you wire batching-by-time.
        }
      });
    } catch (e) {
      console.warn('[TranscriptView] ui.footerGap binding failed (non-fatal)', e);
    } 
}

  setTopic(t) {
    if (!this.withTopic) return;
    const s = (t == null) ? '' : String(t);
    this.topicEl.textContent = s;
  }

  clear() {
    this._lines = [];
    this._textNode.nodeValue = '';
  }

  appendLine(s) {
    // stage and coalesce; enforce per-frame caps
    this._pending.push(String(s));
    if (!this._pendingRaf) {
      this._pendingRaf = true;
      requestAnimationFrame(() => {
        this._pendingRaf = false;
        if (this._pending.length === 0) return;
        // Apply a frame cap to avoid pathological bursts
        const take = this._pending.splice(0, this._maxAppend);
        // move staged into main buffer
        Array.prototype.push.apply(this._lines, take);
        const over = this._lines.length - this.maxLines;
        if (over > 0) this._lines.splice(0, Math.max(over, this.pruneChunk));
        this._textNode.nodeValue = this._lines.join('\n') + '\n';
        // snap only if close to bottom to preserve reader position
        const nearBottom = (this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight) <= this._snapPx;
        if (nearBottom) this.root.scrollTop = this.root.scrollHeight;
        // If backlog remains, schedule another frame (keeps UI responsive)
        if (this._pending.length) this._queueFollowUp();
      });
    }
  }

  _queueFollowUp() {
    requestAnimationFrame(() => {
      if (this._pending.length === 0) return;
      const take = this._pending.splice(0, this._maxAppend);
      Array.prototype.push.apply(this._lines, take);
      const over = this._lines.length - this.maxLines;
      if (over > 0) this._lines.splice(0, Math.max(over, this.pruneChunk));
      this._textNode.nodeValue = this._lines.join('\n') + '\n';
      const nearBottom = (this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight) <= this._snapPx;
      if (nearBottom) this.root.scrollTop = this.root.scrollHeight;
      if (this._pending.length) this._queueFollowUp();
    });
  }

  get element() { return this.root; }
}
