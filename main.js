// main.js
import Store from 'electron-store';
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';
import { spawn, execFile } from 'node:child_process';

const sessions = new Map();
let mainWin = null;

function assetPath(...p) {
  // In production, resources live under process.resourcesPath
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(base, ...p);
}

// ---------- Settings layout ----------
//  omnic-chat.json:
//  {
//    ui: {...},
//    globals: { nick: 'guest', realname: 'Guest' },
//    servers: {
//      "irc.libera.chat": { host:"irc.libera.chat", port: 6697, tls: true, nick: null, realname: null },
//      "irc.oftc.net": { ... }
//    }
//  }
const settings = new Store({
  name: 'omni-chat',
  defaults: {
    ui: { footerGap: 6 },
    globals: { nick: 'guest', realname: 'Guest' },
    servers: {
      'irc.libera.chat': { host: 'irc.libera.chat', port: 6697, tls: true, nick: null, realname: null }
    }
  }
});

// IPC: generic settings passthrough
ipcMain.handle('settings:get', (_e, key, fallback) => settings.get(key, fallback));
ipcMain.handle('settings:set', (_e, key, value) => { settings.set(key, value); return true; });
ipcMain.handle('settings:all', () => settings.store);
ipcMain.handle('settings:path', () => settings.path);

// Server profiles helpers
function getServers() {
  const s = settings.get('servers', {});
  return (s && typeof s === 'object') ? s : {};
}
function setServers(next) {
  settings.set('servers', next || {});
}
function getGlobals() {
  const g = settings.get('globals', {});
  return {
    nick: (g?.nick ?? 'guest'),
    realname: (g?.realname ?? 'Guest')
  };
}
// layer null/undefined keys over globals
function resolveServerProfile(host) {
  const servers = getServers();
  const g = getGlobals();
  const p = servers[host] || { host, port: 6697, tls: true, nick: null, realname: null };
  return {
    host: p.host ?? host,
    port: Number(p.port ?? 6697),
    tls:  Boolean(p.tls !== false),
    nick: (p.nick == null || p.nick === '') ? g.nick : p.nick,
    realname: (p.realname == null || p.realname === '') ? g.realname : p.realname
  };
}
ipcMain.handle('profiles:list', () => {
  const servers = getServers();
  const out = {};
  for (const [host, p] of Object.entries(servers)) {
    out[host] = { ...p }; // shallow copy
  }
  return out;
});
ipcMain.handle('profiles:upsert', (_e, host, profile) => {
  host = String(host || '').trim();
  if (!host) throw new Error('host required');
  const servers = getServers();
  const existing = servers[host] || { host, port: 6697, tls: true, nick: null, realname: null };
  // allow null to mean "use global"
  servers[host] = {
    host,
    port: Number(profile?.port ?? existing.port ?? 6697),
    tls:  Boolean(profile?.tls ?? existing.tls ?? true),
    nick: (profile?.nick === undefined ? existing.nick : profile.nick ?? null),
    realname: (profile?.realname === undefined ? existing.realname : profile.realname ?? null),
  };
  setServers(servers);
  return true;
});
ipcMain.handle('profiles:delete', (_e, host) => {
  host = String(host || '').trim();
  if (!host) return false;
  const servers = getServers();
  if (servers[host]) {
    delete servers[host];
    setServers(servers);
    return true;
  }
  return false;
});
ipcMain.handle('profiles:resolve', (_e, host) => resolveServerProfile(String(host || '').trim()));

// ---------- Utility ----------
function genId() { return randomBytes(8).toString('hex'); }

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });
}
function pipeChildLogs(child) {
  child.stdout?.on('data', (d) => BrowserWindow.getAllWindows()
    .forEach(w => w.webContents.send('backend-log', d.toString())));
  child.stderr?.on('data', (d) => BrowserWindow.getAllWindows()
    .forEach(w => w.webContents.send('backend-log', d.toString())));
}
function killChild(child) {
  if (!child) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch {}
}
async function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}
async function resolveOpamEnv(switchName = 'omni-irc-dev') {
  const base = { ...process.env };
  const forWin = process.platform === 'win32';
  const shellArg = forWin ? 'cmd' : 'sh';
  const { stdout } = await execFileP(
    'opam',
    ['env', `--switch=${switchName}`, '--set-switch', `--shell=${shellArg}`],
    { windowsHide: true }
  );
  const envFromOpam = { ...base };
  if (forWin) {
    stdout.split(/\r?\n/).forEach((line) => {
      const m = /^set\s+([^=]+)=(.*)$/i.exec(line);
      if (m) envFromOpam[m[1]] = m[2];
    });
  } else {
    stdout.split(/\r?\n/).forEach((line) => {
      const m = /^\s*export\s+([^=]+)=(["']?)(.*)\2\s*;?\s*$/.exec(line);
      if (m) envFromOpam[m[1]] = m[3];
    });
  }
  return envFromOpam;
}
async function resolveOmniIrcClientPath(env) {
  const exeName = process.platform === 'win32' ? 'omni-irc-client.exe' : 'omni-irc-client';
  if (process.env.OMNI_IRC_CLIENT) return process.env.OMNI_IRC_CLIENT;
  try {
    const guess = path.resolve(app.getAppPath(), '..', 'omni-irc', '_build', 'install', 'default', 'bin', exeName);
    if (fs.existsSync(guess)) return guess;
  } catch {}
  try {
    const { stdout } = await execFileP('opam', ['var', 'bin'], { env, windowsHide: true });
    const binDir = stdout.trim();
    const p = path.join(binDir, exeName);
    if (fs.existsSync(p)) return p;
  } catch {}
  return exeName; // delegate to PATH
}
async function ensureClientBinary() {
  const env = await resolveOpamEnv('omni-irc-dev');
  const exe = await resolveOmniIrcClientPath(env);
  return { env, exe };
}

// ---------- Sessions ----------
async function startSession(sessionId, opts) {
  const { env, exe } = await ensureClientBinary();
  const port = await getFreePort();

  const args = [
    '--server', opts.server,
    '--port', String(opts.ircPort),
    '--nick', opts.nick,
    '--realname', opts.realname
  ];
  if (opts.tls) args.push('--tls');

  if (opts.tls && String(opts.ircPort) === '6667') {
    args[args.indexOf('--port') + 1] = '6697';
  }
  if (!opts.tls && String(opts.ircPort) === '6697') {
    args.push('--tls');
  }

  args.push('--ui', 'loopback', '--socket', String(port));
  env.OMNI_IRC_PORT = String(port);

  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send('backend-log', `[spawn][${sessionId}] ${exe} ${args.join(' ')}`));

  const child = spawn(exe, args, { env, windowsHide: true });
  pipeChildLogs(child);

  let sock, rl;
  try {
    const { sock: s } = await new Promise((resolve, reject) => {
      const deadline = Date.now() + 15000;
      const tryConnect = () => {
        const c = net.createConnection({ host: '127.0.0.1', port });
        c.once('connect', () => resolve({ sock: c }));
        c.once('error', () => {
          c.destroy();
          if (Date.now() > deadline) return reject(new Error('loopback connect timeout'));
          setTimeout(tryConnect, 200);
        });
      };
      tryConnect();
    });
    sock = s;
  } catch (e) {
    killChild(child);
    throw e;
  }

  sock.setEncoding('utf8');
  sock.setKeepAlive(true, 10_000);
  sock.setNoDelay(true);

  rl = readline.createInterface({ input: sock, crlfDelay: Infinity });
  rl.on('line', (line) => {
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('session:data', { id: sessionId, line })
    );
  });
  sock.on('error', (err) => {
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('session:error', { id: sessionId, message: err.message })
    );
  });
  child.on('close', (code) => {
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('session:status', { id: sessionId, status: 'stopped', code })
    );
    try { rl?.close(); } catch {}
    try { sock?.destroy(); } catch {}
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, { child, env, exe, port, sock, rl, opts });
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send('session:status', { id: sessionId, status: 'running' })
  );
  return { id: sessionId, port };
}
async function stopSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  try { s.sock?.write('/quit\r\n'); } catch {}
  try { s.rl?.close(); } catch {}
  try { s.sock?.destroy(); } catch {}
  killChild(s.child);
  sessions.delete(sessionId);
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send('session:status', { id: sessionId, status: 'stopped' })
  );
}
async function restartSession(sessionId, opts) {
  await stopSession(sessionId);
  return startSession(sessionId, opts);
}

// Windows / menu
function createWindow() {
  const iconWinLinux = process.platform === 'win32'
    ? assetPath('build', 'icons', 'icon.ico')
    : assetPath('build', 'icons', 'png', 'icon.png'); // Linux prefers PNG

  mainWin = new BrowserWindow({
    width: 1480,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    icon: process.platform === 'darwin' ? undefined : iconWinLinux,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false
    }
  });

  if (process.platform === 'darwin') {
    const icns = assetPath('build', 'icons', 'icon.icns');
    const nimg = nativeImage.createFromPath(icns);
    if (!nimg.isEmpty()) app.dock.setIcon(nimg);
  }

  mainWin.loadFile('index.html');
}
function buildMenu() {
  const tpl = [
    { label: 'Window', submenu: [
        { role: 'minimize' }, { role: 'close' }
    ]},
    { role: 'help', submenu: [] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

let tray;

app.whenReady().then(() => {
  createWindow();
  buildMenu();

  // Sessions IPC only (no legacy backend)
  ipcMain.handle('session:start', async (_e, id, opts) => startSession(id || genId(), opts));
  ipcMain.handle('session:stop',  async (_e, id)       => stopSession(id));
  ipcMain.handle('session:restart', async (_e, id, opts) => restartSession(id, opts));
  ipcMain.on('session:send', (_e, { id, line }) => {
    const s = sessions.get(id);
    if (s && s.sock && !s.sock.destroyed) {
      s.sock.write(line.endsWith('\n') || line.endsWith('\r') ? line : (line + '\r\n'));
    }
  });

  // UI pub/sub fanout
  ipcMain.on('ui-pub', (_e, { event, payload }) => {
    if (!event) return;
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send(`ui-sub:${event}`, payload));
  });

  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('Omni Chat');
});

app.on('before-quit', async () => {
  // stop all sessions
  await Promise.all([...sessions.keys()].map(id => stopSession(id).catch(()=>{})));
});
app.on('window-all-closed', () => app.quit());
