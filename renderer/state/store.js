import { createNetworkView } from '../ui/NetworkView.js';
import { ChannelPane } from '../ui/ChannelPane.js';
import { ConsolePane } from '../ui/ConsolePane.js';
import { ChannelListPane } from '../ui/ChannelListPane.js';

export const uiRefs = {
  statusEl: null,
  viewsEl: null,
  errorDockEl: null,
  toggleErrBtn: null,
};

export const store = {
  networks: new Map(), // netId -> { id, sessionId, viewEl, chanListEl, chanHost, channels:Map, activeChan, console, chanListTab, chanMap, userMap, chanListTable }
  activeNetId: null,

  // set by setupIngest
  ingest: (_line, _sessionId) => {},
};

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
    viewEl: view,
    chanListEl: chanList,
    chanHost,
    channels: new Map(),
    activeChan: null,
    console: null,
    // per-network state
    chanMap: new Map(),        // "#chan" -> { topic, users:Set }
    userMap: new Map(),        // nick -> info
    chanListTable: new Map(),  // name -> { users:number, topic:string }
  };
  store.networks.set(id, net);

  ensureConsole(net);
  ensureChannelList(net);
  activateNetwork(id);
  return net;
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
