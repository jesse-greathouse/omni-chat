import { createDisposables } from '../../lib/disposables.js';

export class Pane {
  /** @param {{id?:string}} [opts] */
  constructor(opts = {}) {
    this.id = opts.id || null;
    this.root = document.createElement('div');
    // Hidden by default; callers explicitly show() via activation.
    this.root.classList.add('pane-root', 'min-h-0', 'hidden');
    this._mounted = false;
    this._visible = false;
    this.disposables = createDisposables();
  }

  mount(hostEl) {
    if (this._mounted) return;
    hostEl.appendChild(this.root);
    this._mounted = true;
    this.layout();
  }

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
    try {
      this.disposables?.dispose?.();
    } catch (e) {
      console.error('[Pane] disposables.dispose failed', e);
    }

    try {
      this.root.remove();
    } catch (e) {
      console.error('[Pane] root.remove failed', e);
    }

    this._mounted = false;
  }
}
