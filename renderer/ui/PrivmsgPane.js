import { api } from '../lib/adapter.js';
export class PrivmsgPane {
  constructor(net, peerNick, onClose) {
    this.net = net;
    this.peer = peerNick;

    this.root = document.createElement('div');
    this.root.style.cssText = `
      position:absolute; right:16px; bottom:16px; width: 460px; height: 380px;
      display:grid; grid-template-rows: auto 1fr auto;
      border:1px solid var(--border); background: var(--panel); border-radius:10px;
      box-shadow: 0 10px 28px rgba(0,0,0,.45); overflow:hidden; z-index: 20;
    `;

    // title bar
    const title = document.createElement('div');
    title.style.cssText = `
      display:flex; align-items:center; gap:8px; padding:8px 10px;
      border-bottom:1px solid var(--border); background: var(--tab-bg);
      font-weight:600;
    `;
    title.innerHTML = `<span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">DM · ${this.peer}</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.className = 'pill';
    closeBtn.style.padding = '2px 8px';
    closeBtn.addEventListener('click', () => onClose?.());
    title.appendChild(closeBtn);

    // transcript
    this.trans = document.createElement('div');
    this.trans.style.cssText = `
      overflow:auto; white-space:pre-wrap; word-break:break-word;
      background:#0f121a; padding:10px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    `;

    // input row
    const row = document.createElement('div');
    row.style.cssText = `
      display:grid; grid-template-columns: auto 1fr; gap:8px; padding:8px; border-top:1px solid var(--border);
      background: var(--panel);
    `;
    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'send-btn';
    this.sendBtn.textContent = 'Send';
    this.input = document.createElement('input');
    this.input.className = 'msg-input';
    this.input.placeholder = `Message ${this.peer}`;
    row.append(this.sendBtn, this.input);

    this.root.append(title, this.trans, row);

    this.lines = [];
    this._text = document.createTextNode('');
    this.trans.appendChild(this._text);

    const send = () => {
      const text = this.input.value.trim();
      if (!text) return;
      if (this.net?.sessionId) {
        api.sessions.send(this.net.sessionId, `/msg ${this.peer} ${text}`);
        this.appendLine(`> ${text}`);
        this.input.value = '';
      }
    };
    this.sendBtn.addEventListener('click', send);
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  }

  mount(container) { container.appendChild(this.root); this._scrollToEndSoon(); }
  destroy() { try { this.root.remove(); } catch {} }

  appendLine(s) {
    this.lines.push(s);
    this._text.nodeValue = this.lines.join('\n') + '\n';
    this._scrollToEndSoon();
  }

  _scrollToEndSoon() {
    requestAnimationFrame(() => { this.trans.scrollTop = this.trans.scrollHeight; });
  }
}
