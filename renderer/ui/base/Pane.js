export class Pane {
  /** @param {{id?:string}} [opts] */
  constructor(opts = {}) {
    this.id = opts.id || null;
    this.root = document.createElement('div');
    this.root.style.minHeight = '0';
    this._mounted = false;
    this._visible = false;
  }

  /** Mount under a host element once. */
  mount(hostEl) {
    if (this._mounted) return;
    hostEl.appendChild(this.root);
    this._mounted = true;
    this.show(); // default visible when mounted by store.activateChannel
    this.layout();
  }

  /** Called on first mount and when container size changes (no-op by default). */
  layout() {}

  show() {
    this._visible = true;
    this.root.classList.remove('hidden');
  }

  hide() {
    this._visible = false;
    this.root.classList.add('hidden');
  }

  destroy() {
    try { this.root.remove(); } catch {}
    this._mounted = false;
  }
}
