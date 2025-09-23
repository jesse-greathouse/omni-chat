import { TranscriptBuffer } from './TranscriptBuffer.js';

export class ChannelPane {
  constructor(net, name) {
    this.net = net;
    this.name = name;
    this.users = new Set();
    this.topic = '';

    this.root = document.createElement('div');
    this.root.className = 'chan-pane';

    this.transcriptEl = document.createElement('div');
    this.transcriptEl.className = 'transcript';

    this.topicEl = document.createElement('div');
    this.topicEl.className = 'topic';
    this.transcriptEl.appendChild(this.topicEl);
    this.linesHost = document.createElement('div');
    this.transcriptEl.appendChild(this.linesHost);
    this.buffer = new TranscriptBuffer(this.linesHost, {
      maxLines: 2000,
      pruneChunk: 240,
      scrollEl: this.transcriptEl,
      snapThreshold: 56
    });

    this.usersEl = document.createElement('div');
    this.usersEl.className = 'users';
    this.usersEl.innerHTML = `<h4>Users</h4><div class="user-list"></div>`;
    this.userListEl = this.usersEl.querySelector('.user-list');

    this.inputRow = document.createElement('div');
    this.inputRow.className = 'input-row';
    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'send-btn';
    this.sendBtn.textContent = 'Send';
    this.msgInput = document.createElement('input');
    this.msgInput.className = 'msg-input';
    this.msgInput.placeholder = `Message ${this.name}`;
    this.inputRow.appendChild(this.sendBtn);
    this.inputRow.appendChild(this.msgInput);

    this.root.appendChild(this.transcriptEl);
    this.root.appendChild(this.usersEl);
    this.root.appendChild(this.inputRow);

    this.sendBtn.addEventListener('click', () => this.sendCurrent());
    this.msgInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') this.sendCurrent(); });
  }

  mount(container) { container.appendChild(this.root); }
  show() { this.root.classList.remove('hidden'); this.buffer.onShow(); }
  hide() { this.root.classList.add('hidden'); }

  setTopic(s) {
    this.topic = s ?? '';
    this.topicEl.textContent = this.topic ? `Topic: ${this.topic}` : '';
  }

  setUsers(arr) {
    this.users = new Set(arr || []);
    this.renderUsers();
  }

  upsertUsersFromNames(arr) {
    if (!Array.isArray(arr)) return;
    for (const u of arr) this.users.add(u);
    this.renderUsers();
  }

  renderUsers() {
    this.userListEl.innerHTML = '';
    for (const nick of Array.from(this.users).sort((a, b) => a.localeCompare(b))) {
      const chip = document.createElement('div');
      chip.className = 'user';
      chip.textContent = nick;
      chip.title = `Open DM with ${nick}`;
      chip.addEventListener('dblclick', () => {
        const { ensureDMWindow } = require('../state/store.js'); // dynamic to avoid cycles in bundlers
        const rec = ensureDMWindow(this.net, nick);
        rec.pane.appendLine(`(opened DM with ${nick})`);
      });
      this.userListEl.appendChild(chip);
    }
  }

  appendLine(text) {
    this.buffer.append(text);
  }

  clear() { this.buffer.clear(); }

  sendCurrent() {
    const text = this.msgInput.value.trim();
    if (!text) return;
    if (this.net?.sessionId) {
      window.sessions.send(this.net.sessionId, `/msg ${this.name} ${text}`);
      this.appendLine(`> ${text}`);
      this.msgInput.value = '';
    }
  }
}
