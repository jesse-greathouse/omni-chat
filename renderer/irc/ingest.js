import {
  store,
  ensureNetwork,
  ensureChannel,
  activateNetwork,
  appendToConsole,
  getNetworkBySessionId,
} from '../state/store.js';

export function setupIngest({ onError }) {
  // IMPORTANT: now ingests **per session**
  store.ingest = (line, sessionId) => {
    try {
      const net = getNetworkBySessionId(sessionId);
      if (!net) return; // session’s network not mounted yet

      // CLIENT JSON
      if (line.startsWith('CLIENT ')) {
        const jsonStr = line.slice(7).trim();
        reconcileClientMessage(JSON.parse(jsonStr), net);
        return;
      }

      // Raw JSON (some backends emit this)
      if (line.startsWith('{') || line.startsWith('[')) {
        try { reconcileClientMessage(JSON.parse(line), net); return; } catch {}
      }

      // IRC raws
      // LIST numerics (suppress to keep UI snappy)
      const m = /^:?[^ ]*\s+(\d{3})\b/.exec(line);
      if (m && (m[1] === '321' || m[1] === '322' || m[1] === '323')) return;

      // PRIVMSG/NOTICE to a channel → channel pane
      const chMsg = /^:([^!]+)!([^\s]+)\s+(PRIVMSG|NOTICE)\s+([#&][^\s,]+)\s+:(.*)$/.exec(line);
      if (chMsg) {
        const from   = chMsg[1];
        const kind   = chMsg[3];
        const target = chMsg[4];
        const msg    = chMsg[5];
        const chan = ensureChannel(net, target);
        chan.pane.appendLine(`${from}${kind === 'NOTICE' ? ' ▷' : ''}: ${msg}`);
        return;
      }

      // everything else → this network’s console
      appendToConsole(net, line);

    } catch (e) {
      onError?.(`[ingest] ${e.message || e}`);
    }
  };
}

// ——— helpers ———

function publishChanlistSnapshot(net) {
  const items = Array.from(net.chanListTable.values())
    .map(({ name, users, topic }) => ({ name, users: Number(users) || 0, topic: topic || '' }));
  window.omni.publishUI('chanlist', { sessionId: net.sessionId, items });
}

function normalizedChanlistItems(msg) {
  const out = [];
  const src = msg?.payload || msg?.data || msg?.chanlist || msg || {};
  const push = (o, k) => {
    const name = o?.name || o?.channel || o?.key || k;
    if (!name) return;
    const users = Number(
      o?.users ?? o?.user_count ?? o?.members ?? o?.num_users ?? 0
    ) || 0;
    const topic = typeof o?.topic === 'string' ? o.topic : '';
    out.push({ name, users, topic });
  };
  if (Array.isArray(src.items)) src.items.forEach(push);
  else if (Array.isArray(src.entries)) src.entries.forEach(push);
  else if (Array.isArray(src.channels)) src.channels.forEach((o) => push(o));
  else if (src.channels && typeof src.channels === 'object') {
    for (const [k, v] of Object.entries(src.channels)) push(v, k);
  }
  return out;
}

function reconcileClientMessage(msg, net) {
  const type = String(msg?.type || '').toLowerCase();

  const applyChannelBlob = (chObj) => {
    const name = chObj.name || chObj.key || chObj.channel;
    if (!name) return;
    const prev = net.chanMap.get(name) || { topic: null, users: new Set() };
    if (Array.isArray(chObj.users)) prev.users = new Set(chObj.users);
    if (typeof chObj.topic === 'string' || chObj.topic === null) prev.topic = chObj.topic;
    net.chanMap.set(name, prev);

    const chan = ensureChannel(net, name);
    chan.pane.setTopic(prev.topic);
    chan.pane.setUsers(Array.from(prev.users));
    publishChanlistSnapshot(net);
  };

  switch (type) {
    case 'channels': {
      const op = msg.op || 'upsert';
      if (op === 'snapshot' || op === 'upsert') {
        const assoc = msg.channels || {};
        const arr = Array.isArray(assoc) ? assoc : Object.values(assoc);
        for (const ch of arr) applyChannelBlob(ch);
        publishChanlistSnapshot(net);
      } else if (op === 'remove' && Array.isArray(msg.names)) {
        for (const n of msg.names) {
          net.chanMap.delete(n);
          const ch = net.channels.get(n);
          if (ch) {
            ch.itemEl.remove();
            ch.pane.root.remove();
            net.channels.delete(n);
          }
        }
        publishChanlistSnapshot(net);
      }
      break;
    }
    case 'channel': {
      const ch = msg.channel || msg.payload || msg.data;
      if (ch) applyChannelBlob(ch);
      publishChanlistSnapshot(net);
      break;
    }
    case 'chanlist': {
      const src = msg?.payload || msg?.data || msg?.chanlist || msg || {};
      const op = String(src?.op || 'snapshot').toLowerCase();
      if (op === 'snapshot') {
        net.chanListTable.clear();
      }
      for (const it of normalizedChanlistItems(msg)) {
        net.chanListTable.set(it.name, it);
      }
      const removals = Array.isArray(src.remove) ? src.remove
                    : (op === 'remove' && Array.isArray(src.names) ? src.names : []);
      for (const n of removals) {
        const key = typeof n === 'string' ? n : (n?.name || n?.channel || n?.key);
        if (key) net.chanListTable.delete(key);
      }
      publishChanlistSnapshot(net);
      break;
    }
    case 'user': {
      const u = msg.user || msg.payload || msg.data;
      if (u && u.nick) net.userMap.set(u.nick, u);
      break;
    }
    case 'client_user': {
      if (msg.user && msg.user.nick) net.userMap.set(msg.user.nick, msg.user);
      break;
    }
    case 'nick_change': {
      const { old_nick, new_nick } = msg;
      if (old_nick && new_nick) {
        const u = net.userMap.get(old_nick);
        if (u) { net.userMap.delete(old_nick); net.userMap.set(new_nick, { ...u, nick: new_nick }); }
      }
      break;
    }
    default: {
      appendToConsole(net, `CLIENT ${JSON.stringify(msg).slice(0, 400)}…`);
    }
  }
}
