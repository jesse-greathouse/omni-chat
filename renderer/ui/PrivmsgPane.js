// renderer/ui/PrivmsgPane.js
import { Pane } from './base/Pane.js';
import { Composer } from './widgets/Composer.js';
import { TranscriptView } from './widgets/TranscriptView.js';
import { api } from '../lib/adapter.js';

export class PrivmsgPane extends Pane {
  /**
   * @param {*} net
   * @param {string} peerNick
   * @param {()=>void} onClose
   */
  constructor(net, peerNick, onClose) {
    super({ id: `dm:${net.id}:${peerNick}` });
    this.net = net;
    this.peer = peerNick;
    this.onClose = onClose;

    this.root.className = 'console-pane'; // same layout as console (no users grid)

    this.view = new TranscriptView({ withTopic: false });
    this.composer = new Composer({
      placeholder: `Message ${this.peer}`,
      onSubmit: (text) => {
        try { api.sessions.send(this.net.sessionId, `/msg ${this.peer} ${text}`); } catch {}
        this.appendLine(`> ${text}`);
      }
    });

    this.root.append(this.view.element, this.composer.el);
  }

  appendLine(s) { this.view.appendLine(s); }
  setTopic(_t){}   // no topic band in embedded DM
  setUsers(_u){}   // no users list in embedded DM
}
