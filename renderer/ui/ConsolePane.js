import { Pane } from './base/Pane.js';
import { Composer } from './widgets/Composer.js';
import { TranscriptView } from './widgets/TranscriptView.js';
import { api } from '../lib/adapter.js';

export class ConsolePane extends Pane {
  constructor(net) {
    super({ id: `console:${net.id}` });
    this.net = net;

    // Structure: [Transcript] + [Composer]
    this.view = new TranscriptView({ withTopic: false });
    this.composer = new Composer({
      placeholder: 'Type a command or message...',
      onSubmit: (text) => {
        // Console sends verbatim to the backend
        try { api.sessions.send(this.net.sessionId, text); } catch {}
        this.appendLine(`> ${text}`);
      }
    });

    this.root.classList.add('console-pane', 'pane--with-composer');
    this.root.append(this.view.element, this.composer.el);
  }

  appendLine(s) { this.view.appendLine(s); }
  setTopic(_t){}          // noop: console has no topic
  setUsers(_arr){}        // noop: console has no users

  layout() {
    // nothing special; CSS handles it
  }
}
