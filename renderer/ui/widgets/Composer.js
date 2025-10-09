import { el } from '../../lib/dom.js';

export class Composer {
  /**
   * @param {{placeholder?:string, onSubmit:(text:string)=>void}} cfg
   */
  constructor(cfg) {
    this.cfg = cfg || {};
    this.el = el('div', { className: 'input-row' });
    this.btn = el('button', { className: 'send-btn', text: 'Send', title: 'Send (Enter)' });
    this.input = el('input', { className: 'msg-input', type: 'text', placeholder: cfg?.placeholder || '' });

    this.el.append(this.btn, this.input);

    const submit = () => {
      const t = this.input.value.trim();
      if (!t) return;
      try { this.cfg.onSubmit?.(t); } finally {
        this.input.value = '';
      }
    };
    this.btn.addEventListener('click', submit);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }

  setPlaceholder(s) { this.input.placeholder = String(s || ''); }
  focus() {
    try {
      this.input.focus();
    } catch (e) {
      console.warn('[Composer.focus] Failed to gain focus', e);
    }
  }
  disable(v = true) {
    this.input.disabled = !!v;
    this.btn.disabled = !!v;
  }
}
