import {
  store,
  ensureChannel,
  appendToConsole,
  getNetworkBySessionId
} from '../state/store.js';
import { api } from '../lib/adapter.js';

function stripIrcCodes(s) {
  // mIRC color \x03([0-9]{1,2})(,[0-9]{1,2})?
  return String(s)
    .replace(/\x03(\d{1,2})(,\d{1,2})?/g, '')
    .replace(/[\x00-\x1F\x7F]/g, ''); // bold(\x02), italic(\x1D), underline(\x1F), reset(\x0F), etc.
}

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
        const marker = ' • '; // or ' (NOTICE) '
        chan.pane.appendLine(`${from}${kind === 'NOTICE' ? marker : ''}: ${msg}`);
        return;
      }

      // PRIVMSG/NOTICE to *us* (DM) → open/append DM window (separate BrowserWindow)
      // Be permissive: prefix may or may not include !ident@host.
      //   :NickServ NOTICE you :text
      //   :NickServ!NickServ@services PRIVMSG you :text
      const cleaned = stripIrcCodes(line)
      const dmMsg =
        /^:([^ ]+)\s+(PRIVMSG|NOTICE)\s+([^\s#&][^\s]*)\s+:(.*)$/.exec(cleaned);
      if (dmMsg) {
        const fromFull = dmMsg[1];                 // may be "nick" or "nick!ident@host"
        const kind     = dmMsg[2];
        const target   = dmMsg[3];                 // intended to be our nick
        const msg      = dmMsg[4];

        // Normalize sender nick from prefix
        const fromNick = String(fromFull.split('!')[0] || '').replace(/^[~&@%+]/, '');
        const isTargetUs = !net.selfNick
          ? true
          : String(target).localeCompare(net.selfNick, undefined, { sensitivity: 'accent' }) === 0;

        if (isTargetUs) {
          // NickServ: never open a DM window, regardless of message content.
          const isNickServ = fromNick.localeCompare('NickServ', undefined, { sensitivity: 'accent' }) === 0;
          if (isNickServ) {
            const hasPass = !!net.authPassword;
            const wantsNickServ = (net.authType === 'nickserv');
            // For NickServ we use NICK + PASSWORD (username is ignored)
            if (wantsNickServ && hasPass && !net._nickservTried) {
              net._nickservTried = true;
              try {
                const acct = (net.authUsername && String(net.authUsername).trim()) || null;
                const cmd = acct
                  ? `/msg NickServ IDENTIFY ${acct} ${net.authPassword}`
                  : `/msg NickServ IDENTIFY ${net.authPassword}`;
                api.sessions.send(net.sessionId, cmd);
              } catch {}
            }
            // Swallow *all* NickServ DMs/NOTICES (no DM window).
            return;
          }
          // Otherwise, open DM window as usual, then notify it (attention/nudge)
          api.dm
            .open(net.sessionId, fromNick, { from: fromNick, kind, text: msg })
            .then(() => { try { api.dm.notify(net.sessionId, fromNick); } catch {} });
          return;
        }
      }

      // everything else → this network’s console
      appendToConsole(net, line);

    } catch (e) {
      onError?.(`[ingest] ${e.message || e}`);
    }
  };
}

// helpers

function publishChanlistSnapshot(net) {
  const items = Array.from(net.chanListTable.values())
    .map(({ name, users, topic }) => ({ name, users: Number(users) || 0, topic: topic || '' }));
  api.events.emit('ui:chanlist', { sessionId: net.sessionId, items });
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
      // Accept: {type:'user', user:{...}}  OR  {type:'user', ...topLevelFields}  OR  {type:'user', users:[...]}
      const candidate =
        msg.user ?? msg.payload ?? msg.data ?? msg; // fall back to root if needed

      // Normalize to an array of user objects
      const list = Array.isArray(candidate)
        ? candidate
        : (Array.isArray(msg.users) ? msg.users : [candidate]);

      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;

        // Some backends echo "type"/"op" at the top level - strip obvious non-user metadata
        const { type: _t, op: _op, ...u0 } = raw;

        const key =
          u0.nick || u0.nickname || u0.name || u0.user || u0.username;
        if (!key) continue;

        // Merge onto any existing record to preserve previously learned fields
        const prev = net.userMap.get(key) || {};
        const u = { ...prev, ...u0, nick: u0.nick || prev.nick || key };

        net.userMap.set(u.nick, u);

        // Let the DM window know (main caches & fans this out per session/peer)
        try { api.dm.pushUser?.(net.sessionId, u); } catch {}
      }
      break;
    }
    case 'client_user': {
      if (msg.user && msg.user.nick) {
        net.userMap.set(msg.user.nick, msg.user);
        net.selfNick = msg.user.nick;
        try { api.dm.pushUser?.(net.sessionId, msg.user); } catch {}

        // opportunistic auto-identify on connect
        if (net.authType === 'nickserv' && net.authPassword && !net._nickservTried) {
          net._nickservTried = true;
          const acct = (net.authUsername && String(net.authUsername).trim()) || null;
          const cmd = acct
            ? `/msg NickServ IDENTIFY ${acct} ${net.authPassword}`
            : `/msg NickServ IDENTIFY ${net.authPassword}`;
          try { api.sessions.send(net.sessionId, cmd); } catch {}
        }
      }
      break;
    }
    case 'nick_change': {
      const { old_nick, new_nick } = msg;
      if (old_nick && new_nick) {
        const u = net.userMap.get(old_nick);
        if (u) {
          const nu = { ...u, nick: new_nick };
          net.userMap.delete(old_nick);
          net.userMap.set(new_nick, nu);
          try { api.dm.pushUser?.(net.sessionId, nu); } catch {}
        }
        if (net.selfNick && old_nick === net.selfNick) net.selfNick = new_nick;
      }
      break;
    }
    default: {
      if (msg?.type) appendToConsole(net, `CLIENT(${msg.type}) ${JSON.stringify(msg).slice(0, 400)}…`);
    }
  }
}
