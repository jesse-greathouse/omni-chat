import { Pane } from './base/Pane.js';
import { Composer } from './widgets/Composer.js';
import { TranscriptView } from './widgets/TranscriptView.js';
import { PERF } from '../config/perf.js';
import { el } from '../lib/dom.js';
import { api } from '../lib/adapter.js';

export class ChannelPane extends Pane {
  constructor(net, name) {
    super({ id: `chan:${net.id}:${name}` });
    this.net = net;
    this.name = name;

    this.root.classList.add('chan-pane', 'pane--with-composer');

    this.view = new TranscriptView({
      withTopic: true,
      maxLines: PERF.TRANSCRIPT_MAX_LINES,
      pruneChunk: PERF.TRANSCRIPT_PRUNE_CHUNK,
    });

    this.view.element.classList.add('transcript--with-divider');

    this.usersEl = el('div', { className: 'users' });
    this.usersTitleEl = el('h4', { text: 'Users' });
    this.usersListEl = el('div', { className: 'users-list' });
    this.usersEl.append(this.usersTitleEl, this.usersListEl);

    this.composer = new Composer({
      placeholder: `Message ${this.name}`,
      onSubmit: (text) => {
        try { api.sessions.send(this.net.sessionId, `/msg ${this.name} ${text}`); }
        catch (e) { console.error('[ChannelPane] send /msg failed', e); }
        this.appendLine(`> ${text}`);
      }
    });

    this.root.append(this.view.element, this.usersEl, this.composer.el);

    // Click: open DM
    this.disposables.on(this.usersListEl, 'click', (ev) => {
      const pill = ev.target.closest?.('.user');
      if (!pill) return;
      const nick = pill.dataset.nick || pill.textContent || '';
      if (!nick) return;
      try {
        api.dm.open(this.net.sessionId, nick);
        api.dm.requestUser?.(this.net.sessionId, nick);
      } catch (e) {
        console.error('[ChannelPane open DM]', e);
      }
    });

    // Hover WHOIS (illustrative timer that must be cleaned on destroy)
    let hoverTimer = null;
    const clearHoverTimer = () => { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } };
    this.disposables.add(clearHoverTimer);

    this.disposables.on(this.usersListEl, 'mouseenter', (ev) => {
      const pill = ev.target.closest?.('.user');
      if (!pill) return;
      const nick = pill.dataset.nick || pill.textContent || '';
      clearHoverTimer();
      // Delay to avoid spamming on quick passes
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        if (!this.net?.sessionId || !nick) return;
        try { api.sessions.send(this.net.sessionId, `/whois ${nick} ${nick}`); } catch (e) { console.error('[ChannelPane whois]', e); }
      }, 350);
    }, true);

    this.disposables.on(this.usersListEl, 'mouseleave', () => {
      clearHoverTimer();
    }, true);
  }

  setTopic(topic) { this.view.setTopic(topic); }

  setUsers(users) {
    if (this.usersListEl.replaceChildren) this.usersListEl.replaceChildren();
    else this.usersListEl.textContent = '';
    if (!Array.isArray(users) || users.length === 0) return;

    const frag = document.createDocumentFragment();
    for (const u of users) {
      const nick = String(u?.nick ?? u?.nickname ?? u?.user ?? u ?? '').trim();
      if (!nick) continue;
      // store nick in dataset for delegated handlers
      const pill = el('span', { className: 'user', text: nick, title: nick });
      pill.dataset.nick = nick;
      frag.appendChild(pill);
    }
    this.usersListEl.appendChild(frag);
  }

  appendLine(s) { this.view.appendLine(s); }
}
