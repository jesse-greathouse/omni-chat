import { el } from '../../lib/dom.js';

export class TranscriptView {
  /**
   * @param {{withTopic?:boolean}} [opts]
   */
  constructor(opts = {}) {
    // The OUTER element is the grid child and carries the `.transcript` class
    // so all the existing CSS (background, overflow, padding) applies to the full area.
    this.root = document.createElement('div');
    this.root.className = 'transcript with-footer-gap';
    this.root.classList.add('pane-root');
    this.withTopic = !!opts.withTopic;

    if (this.withTopic) {
      this.topicEl = el('div', { className: 'topic', text: '' });
      this.root.appendChild(this.topicEl);
    }

    // Append text directly to the root (which scrolls)
    // Single textNode strategy = fast append & cheap layout
    this._lines = [];
    this._textNode = document.createTextNode('');
    this.root.appendChild(this._textNode);
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
    this._lines.push(String(s));
    this._textNode.nodeValue = this._lines.join('\n') + '\n';
    requestAnimationFrame(() => {
      this.root.scrollTop = this.root.scrollHeight;
    });
  }

  get element() { return this.root; }
}
