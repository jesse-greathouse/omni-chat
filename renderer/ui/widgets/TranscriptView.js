import { PERF } from '../../config/perf.js';
import { el } from '../../lib/dom.js';

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
        const take = this._pending.splice(0, PERF.TRANSCRIPT_MAX_APPEND_PER_FRAME);
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
      const take = this._pending.splice(0, PERF.TRANSCRIPT_MAX_APPEND_PER_FRAME);
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
