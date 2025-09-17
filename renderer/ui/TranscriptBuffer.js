export class TranscriptBuffer {
  constructor(hostEl, { maxLines = 5000, pruneChunk = 1000 } = {}) {
    this.hostEl = hostEl;
    this.maxLines = maxLines;
    this.pruneChunk = pruneChunk;

    this.lines = [];                // ring buffer storage
    this._textNode = document.createTextNode('');
    this.hostEl.textContent = '';   // clear any children
    this.hostEl.appendChild(this._textNode);

    this._pendingFrame = false;
    this._pendingPrune = false;
    this._atBottom = true;

    // cheap layout containment (prevents tab-show jank)
    this.hostEl.style.contain = 'content';
  }

  append(text) {
    // capture scroll state before we mutate text
    this._atBottom = (this.hostEl.scrollHeight - this.hostEl.scrollTop - this.hostEl.clientHeight) < 40;

    this.lines.push(text);
    this._scheduleFrame();
    this._schedulePrune();
  }

  clear() {
    this.lines.length = 0;
    this._textNode.nodeValue = '';
  }

  // private
  _scheduleFrame() {
    if (this._pendingFrame) return;
    this._pendingFrame = true;
    requestAnimationFrame(() => {
      this._pendingFrame = false;
      // Join with single newline; render once
      this._textNode.nodeValue = this.lines.join('\n') + (this.lines.length ? '\n' : '');
      if (this._atBottom) this._scrollToBottomSoon();
    });
  }

  _scrollToBottomSoon() {
    // end-of-paint scroll to avoid layout thrash
    requestAnimationFrame(() => {
      this.hostEl.scrollTop = this.hostEl.scrollHeight;
    });
  }

  _schedulePrune() {
    if (this.lines.length <= this.maxLines) return;
    if (this._pendingPrune) return;
    this._pendingPrune = true;

    const run = () => this._pruneSlice().finally(() => {
      this._pendingPrune = false;
      if (this.lines.length > this.maxLines) this._schedulePrune(); // continue later
    });

    // Prefer Chromium Task Scheduling API with background priority
    if (globalThis.scheduler?.postTask) {
      scheduler.postTask(run, { priority: 'background' }).catch(()=>{});
      return;
    }
    // Fallback: requestIdleCallback with a timeout so it eventually runs
    const ric = globalThis.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 0 }), 250));
    ric(() => run());
  }

  async _pruneSlice() {
    // Do small, GC-friendly trims
    const over = this.lines.length - this.maxLines;
    if (over <= 0) return;

    const slice = Math.min(over, this.pruneChunk);
    // Remove from the front; avoid huge copies by slicing once
    this.lines = this.lines.slice(slice);

    // Yield if input pending (keep UI snappy)
    if (navigator.scheduling?.isInputPending?.()) {
      if (scheduler?.yield) try { await scheduler.yield(); } catch {}
    }
    // Apply a lightweight visual refresh
    this._scheduleFrame();
  }
}
