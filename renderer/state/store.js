import { createNetworkView } from '../ui/NetworkView.js';
import { ChannelPane } from '../ui/ChannelPane.js';
import { ConsolePane } from '../ui/ConsolePane.js';
import { ChannelListPane } from '../ui/ChannelListPane.js';
import { PrivmsgPane } from '../ui/PrivmsgPane.js';
import { isChannel } from '../protocol/index.js';

export const A = Object.freeze({
  NET_UPSERT: 'NET_UPSERT',
  NET_ACTIVATE: 'NET_ACTIVATE',
  CHANLIST_SNAPSHOT: 'CHANLIST_SNAPSHOT',
  CHANNEL_UPDATE: 'CHANNEL_UPDATE',
  ROSTER_SET: 'ROSTER_SET',
  DM_LINE: 'DM_LINE',
  DM_USER: 'DM_USER',
  SELF_NICK: 'SELF_NICK',
  NICK_CHANGE: 'NICK_CHANGE'
});

export const uiRefs = {
  statusEl: null,
  viewsEl: null,
  errorDockEl: null,
  toggleErrBtn: null,
};

export const store = {
  networks: new Map(), // netId -> { id, sessionId, viewEl, chanListEl, chanHost, channels:Map, activeChan, console, chanListTab, chanMap, userMap, chanListTable }
  activeNetId: null,
};

export function dispatch(action) {
  if (!action || !action.type) return;
  switch (action.type) {
    case A.NET_UPSERT: {
      // ensures a network (wraps ensureNetwork)
      const { opts, sessionId, mountEl } = action;
      ensureNetwork(opts, sessionId, mountEl);
      break;
    }
    case A.NET_ACTIVATE: {
      activateNetwork(action.netId);
      break;
    }
    case A.CHANLIST_SNAPSHOT: {
      const n = getNetworkBySessionId(action.sessionId);
      if (!n) break;
      n.chanListTable.clear();
      for (const it of action.items) n.chanListTable.set(it.name, it);
      // UI panes will read from chanListTable as before
      break;
    }
    case A.CHANNEL_UPDATE: {
      const n = getNetworkBySessionId(action.sessionId);
      if (!n) break;
      const { name, topic, users } = action.channel;
      const ch = ensureChannel(n, name);
      if (topic !== undefined) ch.pane.setTopic(topic);
      if (Array.isArray(users)) ch.pane.setUsers(users);
      // mirror into n.chanMap for consistency
      const prev = n.chanMap.get(name) || { topic: null, users: new Set() };
      if (topic !== undefined) prev.topic = topic;
      if (Array.isArray(users)) prev.users = new Set(users);
      n.chanMap.set(name, prev);
      break;
    }
    case A.ROSTER_SET: {
      const n = getNetworkBySessionId(action.sessionId);
      if (!n) break;
      // authoritative userMap
      n.userMap.clear();
      for (const u of action.users) {
        const nick = u.nick || u.nickname || u.user || u.username;
        if (nick) n.userMap.set(nick, u);
      }
      break;
    }
    case A.DM_LINE: {
      const n = getNetworkBySessionId(action.sessionId);
      if (!n) break;
      const dm = ensureDMWindow(n, action.peer);
      dm.pane.appendLine(`${action.from}${action.kind === 'NOTICE' ? ' (NOTICE)' : ''}: ${action.text}`);
      break;
    }
    case A.DM_USER: {
      const n = getNetworkBySessionId(action.sessionId);
      if (!n) break;
      // cache latest, render if DM window open; main.js already also caches for dm windows
      n.userMap.set(action.user.nick ?? action.user.user ?? action.user.username, action.user);
      break;
    }
    case A.SELF_NICK: {
      const n = getNetworkBySessionId(action.sessionId);
      if (n) n.selfNick = action.nick;
      break;
    }
    case A.NICK_CHANGE: {
      const n = getNetworkBySessionId(action.sessionId);
      if (!n) break;
      const u = n.userMap.get(action.old_nick);
      if (u) {
        n.userMap.delete(action.old_nick);
        n.userMap.set(action.new_nick, { ...u, nick: action.new_nick });
      }
      if (n.selfNick === action.old_nick) n.selfNick = action.new_nick;
      break;
    }
  }
}

// Lightweight action creators (call-site sugar)
export const reducers = {
  applyChannelUpdate: (sessionId, channel) =>
    dispatch({ type: A.CHANNEL_UPDATE, sessionId, channel }),
  applyChanlistSnapshot: (sessionId, items) =>
    dispatch({ type: A.CHANLIST_SNAPSHOT, sessionId, items }),
  applyRoster: (sessionId, users) =>
    dispatch({ type: A.ROSTER_SET, sessionId, users }),
  applyDMLine: (sessionId, payload) =>
    dispatch({ type: A.DM_LINE, sessionId, ...payload }),
  applyDMUser: (sessionId, user) =>
    dispatch({ type: A.DM_USER, sessionId, user }),
};

export function destroyNetwork(netId) {
  const net = store.networks.get(netId);
  if (!net) return;

  // Destroy embedded DM panes
  for (const [, rec] of net.dmWindows) {
    try { rec.pane.destroy(); } catch {}
  }
  net.dmWindows.clear();

  // Destroy channel panes
  for (const [, ch] of net.channels) {
    try { ch.pane.destroy(); } catch {}
    try { ch.itemEl.remove(); } catch {}
  }
  net.channels.clear();

  // Destroy console pane
  if (net.console) {
    try { net.console.pane.destroy(); } catch {}
    try { net.console.itemEl.remove(); } catch {}
    net.console = null;
  }

  // Destroy channel-list pane
  if (net.chanListTab) {
    try { net.chanListTab.pane.destroy(); } catch {}
    try { net.chanListTab.itemEl.remove(); } catch {}
    net.chanListTab = null;
  }

  // Remove the network view
  try { net.viewEl.remove(); } catch {}

  // Clear data maps
  net.chanMap.clear();
  net.userMap.clear();
  net.chanListTable.clear();

  store.networks.delete(netId);

  // If this was active, clear activeNetId
  if (store.activeNetId === netId) store.activeNetId = null;
}

export function networkId(opts, sessionId) {
  const host = opts?.server || 'session';
  const port = (opts?.ircPort ?? 0);
  const proto = opts?.tls ? 'tls' : 'tcp';
  return `${host}:${port}:${proto}:${sessionId || 'default'}`;
}

export function getNetworkBySessionId(sessionId) {
  for (const n of store.networks.values()) {
    if (n.sessionId === sessionId) return n;
  }
  return null;
}

export function activateNetwork(id) {
  store.activeNetId = id;
  for (const n of store.networks.values()) {
    const active = n.id === id;
    n.viewEl.classList.toggle('hidden', !active);
  }
}

export function ensureNetwork(opts, sessionId, mountEl) {
  const id = networkId(opts, sessionId);
  if (store.networks.has(id)) {
    const net = store.networks.get(id);
    activateNetwork(id);
    return net;
  }

  const { view, chanList, chanHost } = createNetworkView();
  (mountEl || uiRefs.viewsEl).appendChild(view);

  const net = {
    id,
    sessionId,
    host: opts?.server || 'session',
    port: opts?.ircPort ?? 0,
    tls: !!opts?.tls,
    nick: opts?.nick || null,
    authType: (opts?.authType || 'none').toLowerCase(),
    authUsername: opts?.authUsername || null,
    authPassword: opts?.authPassword || null,
    viewEl: view,
    chanListEl: chanList,
    chanHost,
    channels: new Map(),
    activeChan: null,
    console: null,
    dmWindows: new Map(),   // nick -> { pane: PrivmsgPane }
    selfNick: null,         // learned from CLIENT {type:"client_user"}
    chanMap: new Map(),        // "#chan" -> { topic, users:Set }
    userMap: new Map(),        // nick -> info
    chanListTable: new Map(),  // name -> { users:number, topic:string }
    _nickservTried: false,     // internal guard for auto-identify
  };
  store.networks.set(id, net);

  ensureConsole(net);
  ensureChannelList(net);
  activateNetwork(id);
  return net;
}

export function ensureDMWindow(net, peerNick) {
  const key = String(peerNick);
  if (net.dmWindows.has(key)) return net.dmWindows.get(key);
  const pane = new PrivmsgPane(net, key, () => closeDMWindow(net, key));
  pane.mount(net.viewEl); // float within this network view
  pane.show();           // DM panes should be visible immediately
  const rec = { pane, peer: key };
  net.dmWindows.set(key, rec);
  return rec;
}

export function closeDMWindow(net, peerNick) {
  const rec = net.dmWindows.get(peerNick);
  if (rec) { try { rec.pane.destroy(); } catch {} }
  net.dmWindows.delete(peerNick);
}

export function ensureChannelList(net) {
  if (net.chanListTab) return net.chanListTab;

  const item = document.createElement('div');
  item.className = 'chan-item';
  item.textContent = 'Channel List';
  item.addEventListener('click', () => activateChannel(net, '__chanlist__'));
  net.chanListEl.appendChild(item);

  const pane = new ChannelListPane(net);
  pane.mount(net.chanHost);

  net.chanListTab = { name: '__chanlist__', type: 'chanlist', itemEl: item, pane };
  // Console stays default; don't auto-activate channel list.
  return net.chanListTab;
}

export function ensureConsole(net) {
  if (net.console) return net.console;

  const citem = document.createElement('div');
  citem.className = 'chan-item';
  citem.textContent = 'Console';
  citem.addEventListener('click', () => activateChannel(net, '__console__'));
  net.chanListEl.appendChild(citem);

  const pane = new ConsolePane(net);
  pane.mount(net.chanHost);

  net.console = { name: '__console__', type: 'console', itemEl: citem, pane };
  if (!net.activeChan) activateChannel(net, '__console__');
  return net.console;
}

export function ensureChannel(net, name) {
  if (name === '__console__') return ensureConsole(net);
  if (name === '__chanlist__') return ensureChannelList(net);

  if (!isChannel(name)) {
    return ensureConsole(net);
  }

  if (net.channels.has(name)) return net.channels.get(name);

  const citem = document.createElement('div');
  citem.className = 'chan-item';
  citem.textContent = name;
  citem.title = name;
  citem.addEventListener('click', () => activateChannel(net, name));
  net.chanListEl.appendChild(citem);

  const pane = new ChannelPane(net, name);
  pane.mount(net.chanHost);

  const chan = { name, type: 'channel', itemEl: citem, pane };
  net.channels.set(name, chan);

  if (!net.activeChan) activateChannel(net, name);
  return chan;
}

export function activateChannel(net, name) {
  net.activeChan = name;

  if (net.console) {
    const active = name === '__console__';
    net.console.itemEl.classList.toggle('active', active);
    active ? net.console.pane.show() : net.console.pane.hide();
  }
  if (net.chanListTab) {
    const active = name === '__chanlist__';
    net.chanListTab.itemEl.classList.toggle('active', active);
    active ? net.chanListTab.pane.show() : net.chanListTab.pane.hide();
  }
  for (const [n, ch] of net.channels) {
    const active = n === name;
    ch.itemEl.classList.toggle('active', active);
    active ? ch.pane.show() : ch.pane.hide();
  }
}

export function appendToConsole(net, line) {
  if (!net) return;
  if (!net.console) ensureConsole(net);
  net.console?.pane.appendLine(line);
}
