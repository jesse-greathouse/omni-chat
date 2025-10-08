import { reducers, dispatch, A, ensureChannel, appendToConsole, getNetworkBySessionId } from '../state/store.js';
import { api, events, EVT } from '../lib/adapter.js';
import { classify, normalizeChanlistItems } from '../protocol/index.js';

const K = Object.freeze({
  TYPE: {
    CHANNELS:    'channels',
    CHANNEL:     'channel',
    CHANLIST:    'chanlist',
    USER:        'user',
    CLIENT_USER: 'client_user',
    NICK_CHANGE: 'nick_change',
  },
  OP: {
    SNAPSHOT: 'snapshot',
    UPSERT:   'upsert',
    REMOVE:   'remove',
  },
  NUM: {
    LIST_START: 321,
    LIST_ITEM:  322,
    LIST_END:   323,
  },
});

function autoIdentifyIfNeeded(net) {
  if (net.authType !== 'nickserv' || !net.authPassword || net._nickservTried) return;
  net._nickservTried = true;
  const acct = (net.authUsername && String(net.authUsername).trim()) || null;
  const cmd  = acct
    ? `/msg NickServ IDENTIFY ${acct} ${net.authPassword}`
    : `/msg NickServ IDENTIFY ${net.authPassword}`;
  try { api.sessions.send(net.sessionId, cmd); } catch {}
}

function publishChanlistSnapshot(net) {
  events.emit(EVT.CHAN_SNAPSHOT, {
    sessionId: net.sessionId,
    items: Array.from(net.chanListTable.values()),
  });
}

function upsertChannelStore(net, chObj) {
  const name  = chObj.name || chObj.key || chObj.channel;
  if (!name) return;

  const topic = (typeof chObj.topic === 'string' || chObj.topic === null) ? chObj.topic : undefined;
  const users = Array.isArray(chObj.users) ? chObj.users : undefined;
  reducers.applyChannelUpdate(net.sessionId, { name, topic, users });

  // keep chanlist table in sync; accept either count or array
  const usersN = Number(chObj.users?.length || chObj.users || 0) || 0;
  const rec = { name, users: usersN, topic: topic || '' };
  net.chanListTable.set(name, rec);
  return rec;
}

export class Ingestor {
  constructor({ onError } = {}) { this.onError = onError; }

  ingest(line, sessionId) {
    try {
      const net = getNetworkBySessionId(sessionId);
      if (!net) return;

      if (line.startsWith('CLIENT ')) {
        this.#reconcile(JSON.parse(line.slice(7).trim()), net);
        return;
      }
      if (line.startsWith('{') || line.startsWith('[')) {
        try { this.#reconcile(JSON.parse(line), net); return; } catch {}
      }

      const c = classify(line, net.selfNick);
      if (c.type === 'other' && (c.numeric === K.NUM.LIST_START || c.numeric === K.NUM.LIST_ITEM || c.numeric === K.NUM.LIST_END)) return;

      if (c.type === 'chan') {
        reducers.applyChannelUpdate(net.sessionId, { name: c.target });
        const ch = ensureChannel(net, c.target);
        ch.pane.appendLine(`${c.from}${c.kind === 'NOTICE' ? ' \u2022 ' : ''}: ${c.text}`);
        return;
      }

      if (c.type === 'dm') {
        // If NickServ pings, attempt IDENTIFY once — but do not swallow the message.
        if (c.isNickServ) autoIdentifyIfNeeded(net);

        const payload = { from: c.from, kind: c.kind, text: c.text };
        api.dm.open(net.sessionId, c.from, payload).catch(() => {});
        try { api.dm.notify(net.sessionId, c.from); } catch {}
        return;
      }

      appendToConsole(net, line);
    } catch (e) {
      this.onError?.(`[ingest] ${e.message || e}`);
    }
  }

  #reconcile(msg, net) {
    const type = String(msg?.type || '').toLowerCase();

    switch (type) {
      // FIX: no inline helper; use upsertChannelStore + publish once
      case K.TYPE.CHANNELS: {
        const op = msg.op || K.OP.UPSERT;
        if (op === K.OP.SNAPSHOT || op === K.OP.UPSERT) {
          const assoc = msg.channels || {};
          const arr = Array.isArray(assoc) ? assoc : Object.values(assoc);
          if (op === K.OP.SNAPSHOT) {
            for (const ch of arr) upsertChannelStore(net, ch);
            publishChanlistSnapshot(net); // full rebuild only on true snapshot
          } else {
            // incremental upserts => per-row updates, no full rebuild
            for (const ch of arr) {
              const rec = upsertChannelStore(net, ch);
              if (rec) events.emit(EVT.CHAN_UPDATE, { sessionId: net.sessionId, channel: rec });
            }
          }
        } else if (op === K.OP.REMOVE && Array.isArray(msg.names)) {
          for (const n of msg.names) {
            net.chanMap.delete(n);
            net.chanListTable.delete(n);
            const ch = net.channels.get(n);
            if (ch) { ch.itemEl.remove(); ch.pane.root.remove(); net.channels.delete(n); }
          }
          publishChanlistSnapshot(net); // FIX: single emission
        }
        break;
      }

      case K.TYPE.CHANNEL: {
        const ch = msg.channel || msg.payload || msg.data;
        if (ch) {
          const rec = upsertChannelStore(net, ch);
          if (rec) events.emit(EVT.CHAN_UPDATE, { sessionId: net.sessionId, channel: rec });
        }
        break;
      }

      case K.TYPE.CHANLIST: {
        const items = normalizeChanlistItems(msg);
        reducers.applyChanlistSnapshot(net.sessionId, items);
        net.chanListTable.clear();
        for (const it of items) net.chanListTable.set(it.name, it);
        publishChanlistSnapshot(net); // FIX: single emission
        break;
      }

      case K.TYPE.USER: {
        const u = msg.user ?? msg.payload ?? msg.data;
        if (!u || typeof u !== 'object') break;
        events.emit(EVT.DM_USER, { sessionId: net.sessionId, user: u });
        try { api.dm.pushUser?.(net.sessionId, u); } catch {}
        reducers.applyDMUser(net.sessionId, u);
        break;
      }

      case K.TYPE.CLIENT_USER: {
        if (msg.user && msg.user.nick) {
          reducers.applyDMUser(net.sessionId, msg.user);
          dispatch({ type: A.SELF_NICK, sessionId: net.sessionId, nick: msg.user.nick });
          events.emit(EVT.DM_USER, { sessionId: net.sessionId, user: msg.user });
          try { api.dm.pushUser?.(net.sessionId, msg.user); } catch {}
          autoIdentifyIfNeeded(net); // FIX: no duplication
        }
        break;
      }

      case K.TYPE.NICK_CHANGE: {
        const { old_nick, new_nick } = msg;
        if (old_nick && new_nick) {
          dispatch({ type: A.NICK_CHANGE, sessionId: net.sessionId, old_nick, new_nick });
          try { api.dm.pushUser?.(net.sessionId, { nick: new_nick }); } catch {}
        }
        break;
      }

      default: {
        appendToConsole(net, `CLIENT(${msg?.type || 'unknown'}) ${JSON.stringify(msg).slice(0, 400)}…`);
      }
    }
  }
}
