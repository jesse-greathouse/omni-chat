import { Pane } from './base/Pane.js';
import { Composer } from './widgets/Composer.js';
import { TranscriptView } from './widgets/TranscriptView.js';
import { el } from '../lib/dom.js';
import { api } from '../lib/adapter.js';

export class ChannelPane extends Pane {
  constructor(net, name) {
    super({ id: `chan:${net.id}:${name}` });
    this.net = net;
    this.name = name;

    // Grid: [Transcript | Users]
    this.root.className = 'chan-pane pane--with-composer';

    this.view = new TranscriptView({ withTopic: true });
    this.view.element.classList.add('transcript--with-divider');
    this.usersEl = el('div', { className: 'users' });
    this.usersTitleEl = el('h4', { text: 'Users' });
    this.usersListEl = el('div');
    this.usersEl.append(this.usersTitleEl, this.usersListEl);

    this.composer = new Composer({
      placeholder: `Message ${this.name}`,
      onSubmit: (text) => {
        try { api.sessions.send(this.net.sessionId, `/msg ${this.name} ${text}`); } catch {}
        this.appendLine(`> ${text}`);
      }
    });

    this.root.append(this.view.element, this.usersEl, this.composer.el);
  }

  setTopic(topic) { this.view.setTopic(topic); }

  setUsers(users) {
    // replace children safely
    if (this.usersListEl.replaceChildren) this.usersListEl.replaceChildren();
    else this.usersListEl.textContent = '';
    if (!Array.isArray(users) || users.length === 0) return;

    for (const u of users) {
      const nick = String(u?.nick ?? u?.nickname ?? u?.user ?? u ?? '').trim();
      if (!nick) continue;
      const pill = el('span', { className: 'user', text: nick, title: nick });
      // Open a DM window on click (existing behavior)
      pill.addEventListener('click', () => {
        try {
          api.dm.open(this.net.sessionId, nick);
          // proactively fetch profile snapshot so the DM header fills quickly
          api.dm.requestUser?.(this.net.sessionId, nick);
        } catch {}
      });
      this.usersListEl.appendChild(pill);
    }
  }

  appendLine(s) { this.view.appendLine(s); }
}
