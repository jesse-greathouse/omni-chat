import { TranscriptBuffer } from './TranscriptBuffer.js';

export class ConsolePane {
  constructor(net) {
    this.net = net;
    this.name = 'Console';

    this.root = document.createElement('div');
    this.root.className = 'console-pane';

    this.transcriptEl = document.createElement('div');
    this.transcriptEl.className = 'transcript';
    this.buffer = new TranscriptBuffer(this.transcriptEl, {
      maxLines: 2000,
      pruneChunk: 240,
      scrollEl: this.transcriptEl,
      snapThreshold: 56
    });

    this.inputRow = document.createElement('div');
    this.inputRow.className = 'input-row';
    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'send-btn';
    this.sendBtn.textContent = 'Send';
    this.msgInput = document.createElement('input');
    this.msgInput.className = 'msg-input';
    this.msgInput.placeholder = `Type IRC commands or messages (e.g., /join #foo)`;

    this.inputRow.appendChild(this.sendBtn);
    this.inputRow.appendChild(this.msgInput);

    this.root.appendChild(this.transcriptEl);
    this.root.appendChild(this.inputRow);

    this.sendBtn.addEventListener('click', () => this.sendCurrent());
    this.msgInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') this.sendCurrent(); });
  }

  mount(container) { container.appendChild(this.root); }
  show() { this.root.classList.remove('hidden'); this.buffer.onShow(); }
  hide() { this.root.classList.add('hidden'); }

  appendLine(text) {
    this.buffer.append(text);
  }

  clear() { this.buffer.clear(); }

  sendCurrent() {
    const text = this.msgInput.value.trim();
    if (!text) return;
    if (this.net?.sessionId) {
      window.sessions.send(this.net.sessionId, text);
      this.appendLine(`> ${text}`);
      this.msgInput.value = '';
    }
  }
}
