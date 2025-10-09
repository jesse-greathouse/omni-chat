export class TranscriptBuffer {
  constructor(hostEl, { maxLines = 2000, pruneChunk = 200, scrollEl = null, snapThreshold = 40 } = {}) {
    this.hostEl = hostEl;
    this.maxLines = maxLines;
    this.pruneChunk = pruneChunk;
    this.scrollEl = scrollEl || hostEl;
    this.snapThreshold = snapThreshold;

    this.lines = [];                // ring buffer storage
    this._textNode = document.createTextNode('');
    this.hostEl.textContent = '';   // clear any children
    this.hostEl.appendChild(this._textNode);

    this._pendingFrame = false;
    this._pendingPrune = false;
    this._atBottom = true;
    this._follow = true;
    this._ignoreScroll = false;

    // cheap layout containment (prevents tab-show jank)
    this.hostEl.style.contain = 'content';

    // Keep auto-scroll state in sync with user scrolling.
    // If close enough to the bottom, snap and keep following.
    this._onScroll = () => {
      if (this._ignoreScroll) return; // programmatic scroll; don't flip intent
      const dist = this._distanceFromBottom();
      const near = dist <= this.snapThreshold;
      this._atBottom = near;
      this._follow = near ? true : false; // scroll up => leave follow; near bottom => re-enter
    };
    this.scrollEl.addEventListener('scroll', this._onScroll, { passive: true });
}

  append(text) {
    // capture scroll state before we mutate text (measure scroll container)
    this._atBottom = this._distanceFromBottom() < this.snapThreshold || this._follow;

    this.lines.push(text);
    this._scheduleFrame();
    this._schedulePrune();
  }

  clear() {
    this.lines.length = 0;
    this._textNode.nodeValue = '';
  }

  // Call this when a previously hidden pane becomes visible again.
  onShow() {
    if (this._follow) this._snapToBottomNow();
  }

  // private
  _scheduleFrame() {
    if (this._pendingFrame) return;
    this._pendingFrame = true;
    requestAnimationFrame(() => {
      this._pendingFrame = false;
      // Join with single newline; render once
      this._textNode.nodeValue = this.lines.join('\n') + (this.lines.length ? '\n' : '');
      if (this._follow || this._atBottom) this._scrollToBottomSoon();
    });
  }

  _scrollToBottomSoon() {
    // end-of-paint scroll to avoid layout thrash
    requestAnimationFrame(() => {
      this._withIgnoredScroll(() => {
        this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
      });
    });
  }

  _snapToBottomNow() {
    this._withIgnoredScroll(() => {
      this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
    });
  }

  _withIgnoredScroll(fn) {
    this._ignoreScroll = true;
    try { fn(); } finally {
      // clear on the next two frames to outlive the browser’s scroll dispatch
      requestAnimationFrame(() => requestAnimationFrame(() => { this._ignoreScroll = false; }));
    }
  }

  _distanceFromBottom() {
    const el = this.scrollEl;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
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
      if (scheduler?.yield) {
        try { await scheduler.yield(); }
        catch (e) { console.error('[TranscriptBuffer] scheduler.yield failed', e); }
      }
    }
    // Apply a lightweight visual refresh
    this._scheduleFrame();
  }

  dispose() {
    try {
      this.scrollEl.removeEventListener('scroll', this._onScroll, { passive: true });
    } catch (e) {
      console.error('[TranscriptBuffer] removeEventListener failed', e);
    }

    try {
      this.clear();
    } catch (e) {
      console.error('[TranscriptBuffer] clear failed', e);
    }
  }
}
