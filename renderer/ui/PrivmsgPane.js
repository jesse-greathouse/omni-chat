import { Pane } from './base/Pane.js';
import { Composer } from './widgets/Composer.js';
import { TranscriptView } from './widgets/TranscriptView.js';
import { PERF } from '../config/perf.js';
import { api } from '../lib/adapter.js';

export class PrivmsgPane extends Pane {
  constructor(net, peerNick, onClose) {
    super({ id: `dm:${net.id}:${peerNick}` });
    this.net = net;
    this.peer = peerNick;
    this.onClose = onClose;

    this.root.classList.add('console-pane');

    this.view = new TranscriptView({
      withTopic: false,
      maxLines: PERF.TRANSCRIPT_MAX_LINES,
      pruneChunk: PERF.TRANSCRIPT_PRUNE_CHUNK,
    });

    this.composer = new Composer({
      placeholder: `Message ${this.peer}`,
      onSubmit: (text) => {
        try { api.sessions.send(this.net.sessionId, `/msg ${this.peer} ${text}`); } catch {}
        this.appendLine(`> ${text}`);
      }
    });

    this.root.append(this.view.element, this.composer.el);

    // Example: if you later add buttons/shortcuts here, bind via this.disposables.on(...)
    // This pane currently has no timers; base.destroy() still guarantees teardown.
  }

  appendLine(s) { this.view.appendLine(s); }
  setTopic(_t){}   // no topic band in embedded DM
  setUsers(_u){}   // no users list in embedded DM
}
