import Store from 'electron-store';
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import readline from 'node:readline';
import { spawn, execFile, spawnSync } from 'node:child_process';

/* =============================================================================
   Globals
============================================================================= */
const sessions = new Map();
const dmWindows = new Map();
const userCache = new Map();
let mainWin = null;
let installerWin = null;
let tray = null;
let bootstrapChild = null;
let bootstrapLogPath = null;

/* =============================================================================
   Paths & Small Utilities
============================================================================= */
const isWin = process.platform === 'win32';

function assetPath(...p) {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(base, ...p);
}
function quote(s) { return `"${String(s).replace(/"/g, '\\"')}"`; }
function genId() { return randomBytes(8).toString('hex'); }

function sendToAll(ch, payload) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(ch, payload);
}
function pipeChildLogs(child) {
  child.stdout?.on('data', (d) => sendToAll('backend-log', d.toString()));
  child.stderr?.on('data', (d) => sendToAll('backend-log', d.toString()));
}
function killChild(child) {
  if (!child) return;
  try {
    if (isWin) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGTERM');
  } catch {}
}
function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });
}
function seedUnixPath(env) {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const seed = [
      '/opt/homebrew/bin','/opt/homebrew/sbin', // Apple Silicon Homebrew
      '/usr/local/bin','/usr/local/sbin',       // Intel mac / common Linux
      '/opt/local/bin','/opt/local/sbin'        // MacPorts
    ];
    const cur = env.PATH || '';
    const add = seed.filter(p => !cur.split(':').includes(p));
    if (add.length) env.PATH = add.join(':') + (cur ? (':' + cur) : '');
  }
  return env;
}
function resolveTool(name, extraDirs = []) {
  // 1) explicit overrides
  const k = [`${name.toUpperCase()}_EXE`, `OMNI_${name.toUpperCase()}_EXE`];
  for (const key of k) {
    const v = process.env[key];
    if (v && fs.existsSync(v)) return v;
  }
  // 2) PATH search (portable)
  const PATH = (process.env.PATH || '').split(path.delimiter);
  for (const d of [...extraDirs, ...PATH]) {
    if (!d) continue;
    const p = path.join(d, name);
    if (fs.existsSync(p)) return p;
    if (isWin) {
      const pexe = p.endsWith('.exe') ? p : p + '.exe';
      if (fs.existsSync(pexe)) return pexe;
    }
  }
  return null;
}

function dmKey(sessionId, peer) {
  return `${sessionId}:${String(peer || '').toLowerCase()}`;
}

function createDMWindow(sessionId, peer, bootLine ) {
  const key = dmKey(sessionId, peer);
  const existing = dmWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    // Keep minimized / background state intact; just deliver the line.
    if (bootLine) {
      try {
        existing.webContents.send('dm:line', { sessionId, peer, ...bootLine });
        // optional nudge without raising the window:
        // existing.flashFrame?.(true);
      } catch {}
    }
    return existing;
  } else if (existing?.isDestroyed()) {
    dmWindows.delete(key);
  }

  const w = new BrowserWindow({
    width: 520,
    height: 420,
    minWidth: 420,
    minHeight: 320,
    title: String(peer), // native title = peer
    // use same preload so sessions/omni APIs exist
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  w.loadFile(path.join(app.getAppPath(), 'renderer', 'dm.html'));
  w.on('closed', () => dmWindows.delete(key));
  const bootBuffer = [];
  if (bootLine) bootBuffer.push({ sessionId, peer, ...bootLine });
  w.webContents.on('did-finish-load', () => {
    try {
      w.setTitle(String(peer));
      // Send init (unblocks dm.js -> sets state.sessionId and peer)
      w.webContents.send('dm:init', {
        sessionId,
        peer,
        bootLines: bootBuffer
      });

      // If we already know WHOIS/user info for this peer, deliver it now
      const cached = userCache.get(dmKey(sessionId, peer));
      if (cached) {
        w.webContents.send('dm:user', { sessionId, user: cached });
      }
    } catch {}
  });
  dmWindows.set(key, w);
  return w;
}

/* =============================================================================
   Settings & Profiles
============================================================================= */
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

ipcMain.handle('settings:get', (_e, key, fallback) => settings.get(key, fallback));
ipcMain.handle('settings:set', (_e, key, value) => { settings.set(key, value); return true; });
ipcMain.handle('settings:all', () => settings.store);
ipcMain.handle('settings:path', () => settings.path);

function getServers() {
  const s = settings.get('servers', {});
  return (s && typeof s === 'object') ? s : {};
}
function setServers(next) { settings.set('servers', next || {}); }
function getGlobals() {
  const g = settings.get('globals', {});
  return { nick: (g?.nick ?? 'guest'), realname: (g?.realname ?? 'Guest') };
}
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
  for (const [host, p] of Object.entries(servers)) out[host] = { ...p };
  return out;
});
ipcMain.handle('profiles:upsert', (_e, host, profile) => {
  host = String(host || '').trim();
  if (!host) throw new Error('host required');
  const servers = getServers();
  const existing = servers[host] || { host, port: 6697, tls: true, nick: null, realname: null };
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
  if (servers[host]) { delete servers[host]; setServers(servers); return true; }
  return false;
});
ipcMain.handle('profiles:resolve', (_e, host) => resolveServerProfile(String(host || '').trim()));

/* =============================================================================
   Backend Discovery (opam env + omni client)
============================================================================= */
function canonicalSessionKey(opts) {
  const nick = String(opts.nick || '').trim().toLowerCase();
  const host = String(opts.server || '').trim().toLowerCase();
  const port = String(opts.ircPort || '');
  const proto = opts.tls ? 'tls' : 'tcp';
  return `${nick}@${host}:${port}/${proto}`;
}
function deriveUnixSocketPath(sessionKey) {
  const base = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  const dir = path.join(base, 'omni-chat');
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}
  const hash = createHash('sha1').update(sessionKey).digest('hex').slice(0, 16);
  return path.join(dir, `oi-${hash}.sock`);
}
async function ensureUnixSocketFree(sockPath) {
  if (!fs.existsSync(sockPath)) return;
  const ok = await new Promise((resolve) => {
    const c = net.createConnection({ path: sockPath });
    let settled = false;
    c.once('connect', () => { settled = true; c.destroy(); resolve(true); });
    c.once('error',  () => { if (!settled) resolve(false); });
    setTimeout(() => { if (!settled) { try { c.destroy(); } catch {} resolve(false); } }, 250);
  });
  if (ok) throw new Error(`A session for this nick/server is already active (socket: ${sockPath}).`);
  try { fs.unlinkSync(sockPath); } catch {}
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
  const shellArg = isWin ? 'cmd' : 'sh';
  const { stdout } = await execFileP('opam', ['env', `--switch=${switchName}`, '--set-switch', `--shell=${shellArg}`], { windowsHide: true });
  const envFromOpam = { ...base };
  if (isWin) {
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
  const exeName = isWin ? 'omni-irc-client.exe' : 'omni-irc-client';
  if (process.env.OMNI_IRC_CLIENT) return process.env.OMNI_IRC_CLIENT;

  // 1) dev build guess
  try {
    const guess = path.resolve(app.getAppPath(), '..', 'omni-irc', '_build', 'install', 'default', 'bin', exeName);
    if (fs.existsSync(guess)) return guess;
  } catch {}

  // 2) direct switch bin: $OPAMROOT/$OPAMSWITCH/bin
  const root = env.OPAMROOT || path.join(os.homedir(), '.opam');
  const sw   = env.OPAMSWITCH || 'omni-irc-dev';
  const fromSwitch = path.join(root, sw, 'bin', exeName);
  if (fs.existsSync(fromSwitch)) return fromSwitch;

  // 3) opam var bin (if opam is callable)
  try {
    const opamExe = resolveTool(isWin ? 'opam.exe' : 'opam',
      ['/opt/homebrew/bin','/usr/local/bin','/opt/local/bin']);
    if (opamExe) {
      const { stdout } = await execFileP(opamExe, ['var', 'bin'], { env, windowsHide: true });
      const p = path.join(stdout.trim(), exeName);
      if (fs.existsSync(p)) return p;
    }
  } catch {}

  // 4) fall back to PATH (spawn will succeed if PATH is seeded)
  return exeName;
}

async function ensureClientBinary() {
  // Start from a PATH that works on macOS/Linux GUI launches
  const base = seedUnixPath({ ...process.env });

  // Try to get real opam env; if that fails, still return a usable env
  let env = base;
  try {
    const shellArg = isWin ? 'cmd' : 'sh';
    const { stdout } = await execFileP('opam', ['env', '--switch=omni-irc-dev', '--set-switch', `--shell=${shellArg}`], { windowsHide: true });
    const next = { ...base };
    if (isWin) {
      stdout.split(/\r?\n/).forEach(line => { const m = /^set\s+([^=]+)=(.*)$/i.exec(line); if (m) next[m[1]] = m[2]; });
    } else {
      stdout.split(/\r?\n/).forEach(line => { const m = /^\s*export\s+([^=]+)=(["']?)(.*)\2\s*;?\s*$/.exec(line); if (m) next[m[1]] = m[3]; });
    }
    env = next;
  } catch {
    // Make sure the switch bin is on PATH even without opam
    const root = env.OPAMROOT || path.join(os.homedir(), '.opam');
    const sw   = 'omni-irc-dev';
    const bin  = path.join(root, sw, 'bin');
    if (fs.existsSync(bin)) env.PATH = `${bin}${path.delimiter}${env.PATH || ''}`;
    env.OPAMROOT = env.OPAMROOT || root;
    env.OPAMSWITCH = env.OPAMSWITCH || sw;
  }

  const exe = await resolveOmniIrcClientPath(env);
  return { env, exe };
}
async function backendReady() {
  try {
    const { env, exe } = await ensureClientBinary();
    const res = spawnSync(exe, ['--version'], { env, windowsHide: true, encoding: 'utf8' });
    if (res.status === 0) return true;
    const s = (res.stdout || '') + (res.stderr || '');
    return /omni-irc/i.test(s); // some builds only print on stderr
  } catch {
    return false;
  }
}

/* =============================================================================
   Bootstrap (Unified: terminal | background)
============================================================================= */
function pickPwsh() {
  const tryWhere = (cmd) => {
    try {
      const out = spawnSync('where', [cmd], { windowsHide: true, encoding: 'utf8' });
      if (out.status === 0) {
        const first = String(out.stdout || '').split(/\r?\n/).find(Boolean);
        if (first && fs.existsSync(first.trim())) return first.trim();
      }
    } catch {}
    return null;
  };
  return tryWhere('pwsh.exe') || tryWhere('powershell.exe') || 'powershell.exe';
}
function findTerminalOnLinux(cwd, script) {
  const has = (c) => spawnSync('which', [c], { encoding: 'utf8' }).status === 0;
  const runCmd = `bash -lc 'cd ${quote(cwd)} && ${quote(script)} ; echo; echo "Press Enter to close..." ; read -r _'`;
  const choices = [
    { cmd: 'x-terminal-emulator', args: ['-e', runCmd] },
    { cmd: 'gnome-terminal',      args: ['--', 'bash','-lc', runCmd] },
    { cmd: 'konsole',             args: ['-e', 'bash','-lc', runCmd] },
    { cmd: 'xfce4-terminal',      args: ['-e', 'bash','-lc', runCmd] },
    { cmd: 'xterm',               args: ['-e', 'bash','-lc', runCmd] },
    { cmd: 'alacritty',           args: ['-e', 'bash','-lc', runCmd] },
    { cmd: 'kitty',               args: ['bash','-lc', runCmd] }
  ];
  return choices.find(c => has(c.cmd)) || null;
}
function sendBootstrapLog(line) {
  const text = typeof line === 'string' ? line : String(line);
  try { if (bootstrapLogPath) fs.appendFileSync(bootstrapLogPath, text); } catch {}
  sendToAll('bootstrap:log', text);
}

async function runBootstrap({ mode = 'terminal' } = {}) {
  const isWin = process.platform === 'win32'; // ← make sure this exists
  const cwd   = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const env   = { ...process.env, OPAMYES: '1' };
  // Make Homebrew/MacPorts visible when the app is launched from Finder
  if (process.platform === 'darwin') {
    const seed = [
      '/opt/homebrew/bin','/opt/homebrew/sbin',
      '/usr/local/bin','/usr/local/sbin',
      '/opt/local/bin','/opt/local/sbin'
    ];
    const cur = env.PATH || '';
    const add = seed.filter(p => !cur.includes(p)).join(':');
    env.PATH = add ? `${add}:${cur}` : cur;
  }
  const script = isWin ? assetPath('bin', 'bootstrap.ps1') : assetPath('bin', 'bootstrap');

  if (!fs.existsSync(script)) {
    const name = path.basename(script);
    sendBootstrapLog(`✘ ${name} not found at ${script}\n`);
    throw new Error(`${name} missing`);
  }
  if (!isWin) { try { fs.chmodSync(script, 0o755); } catch {} }

  if (mode === 'terminal') {
    if (isWin) {
      const pwsh = pickPwsh();
      const cmdExe = process.env.Comspec || 'cmd.exe';
      const line = [
        'start', '"Omni-IRC Setup"',
        `"${pwsh}"`, '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-NoExit',
        '-File', `"${script}"`
      ].join(' ');
      const child = spawn(cmdExe, ['/d','/s','/c', line], {
        cwd, env, windowsHide: false, detached: true, stdio: 'ignore', windowsVerbatimArguments: true
      });
      child.unref();
      return true;
    }

    if (process.platform === 'darwin') {
      // 1) Ensure a fresh log file and start the bootstrap in BACKGROUND (it will write to this log).
      //    (Background mode below truncates bootstrap.log each run.)
      await runBootstrap({ mode: 'background' });

      // 2) Create a small .command that tails the log and exits when the bootstrap finishes.
      const logPath = path.join(app.getPath('userData'), 'bootstrap.log');
      const tmpCmd  = path.join(app.getPath('userData'), `tail-bootstrap-${Date.now()}.command`);
      const tailScript = `#!/bin/sh
LOG="${logPath}"
clear
echo "Following install log:"
echo "  $LOG"
echo
# Tail from the beginning (-n +1) and *exit* when the background run logs a success or error sentinel.
/usr/bin/tail -n +1 -F "$LOG" | /usr/bin/awk '{ print; fflush(); if ($0 ~ /^✔ bootstrap completed successfully$/ || $0 ~ /^✘ bootstrap exited with code /) exit }'
echo
echo "*** Omni-IRC bootstrap finished. Press Return to close... ***"
read -r _
`;
      try { fs.writeFileSync(tmpCmd, tailScript, { mode: 0o755 }); } catch {}
      const child = spawn('open', ['-a', 'Terminal', tmpCmd], { detached: true, stdio: 'ignore' });
      child.unref();
      // Best-effort cleanup
      setTimeout(() => { try { fs.unlinkSync(tmpCmd); } catch {} }, 10 * 60 * 1000);
      return true;
    }

    // Linux
    const t = findTerminalOnLinux(cwd, script);
    if (!t) throw new Error('No terminal emulator found (x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, xterm, alacritty, kitty).');
    const child = spawn(t.cmd, t.args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }

  // --- background mode (unchanged) ---
  if (bootstrapChild && !bootstrapChild.killed) { try { bootstrapChild.kill(); } catch {} bootstrapChild = null; }
  // Fresh log every run
  bootstrapLogPath = path.join(app.getPath('userData'), 'bootstrap.log');
  try {
    fs.mkdirSync(path.dirname(bootstrapLogPath), { recursive: true });
    // Truncate + header
    fs.writeFileSync(bootstrapLogPath, `# Omni-IRC bootstrap log — ${new Date().toISOString()}\n`);
  } catch {}

  if (isWin) {
    const pwsh = pickPwsh();
    const args = ['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File', script];
    sendBootstrapLog(`[bootstrap] pwsh: ${pwsh}\n[bootstrap] cwd: ${cwd}\n[bootstrap] args: ${args.join(' ')}\n`);
    bootstrapChild = spawn(pwsh, args, { cwd, env, windowsHide: true });
  } else {
    // Unix: run script, capture both stdout/stderr
    const cmd = `exec ${quote(script)} 2>&1`;
    bootstrapChild = spawn('sh', ['-c', cmd], { cwd, env });
  }

  sendBootstrapLog('[bootstrap] spawned\n');
  // Pipe all output to the log file and to the UI stream.
  const logStream = (() => {
    try { return fs.createWriteStream(bootstrapLogPath, { flags: 'a' }); } catch { return null; }
  })();
  const pipeChunk = (buf) => {
    const s = String(buf);
    if (logStream) { try { logStream.write(s); } catch {} }
    sendToAll('bootstrap:log', s);
  };
  bootstrapChild.stdout?.setEncoding('utf8');
  bootstrapChild.stderr?.setEncoding('utf8');
  bootstrapChild.stdout?.on('data', pipeChunk);
  bootstrapChild.stderr?.on('data', pipeChunk);
  bootstrapChild.on('error', (err) => { sendBootstrapLog(`\n✘ Failed to start bootstrap: ${err.message}\n`); sendToAll('bootstrap:error', -1); });
  bootstrapChild.on('close', (code) => {
    if (code === 0) { sendBootstrapLog('\n✔ bootstrap completed successfully\n'); sendToAll('bootstrap:done'); }
    else { sendBootstrapLog(`\n✘ bootstrap exited with code ${code}\n`); sendToAll('bootstrap:error', code ?? 1); }
    bootstrapChild = null;
    try { logStream?.end(); } catch {}
  });

  return true;
}


/* =============================================================================
   Session Manager
============================================================================= */
async function startSession(sessionId, opts) {
  const { env, exe } = await ensureClientBinary();
  const sessionKey = canonicalSessionKey(opts);

  // Only prevent duplicates on Unix (Windows loopback allows multiple)
  if (!isWin) {
    for (const s of sessions.values()) {
      if (s.sessionKey === sessionKey) throw new Error(`Already connected as ${sessionKey}`);
    }
  }

  // Base CLI args
  const args = ['--server', opts.server, '--port', String(opts.ircPort), '--nick', opts.nick, '--realname', opts.realname];
  if (opts.tls) args.push('--tls');
  if (opts.tls && String(opts.ircPort) === '6667') args[args.indexOf('--port') + 1] = '6697';
  if (!opts.tls && String(opts.ircPort) === '6697') args.push('--tls');

  // UI transport
  let connectSpec = null;
  let unixSockPath = null;

  if (isWin) {
    const port = await getFreePort();
    args.push('--ui', 'loopback', '--socket', String(port));
    env.OMNI_IRC_PORT = String(port);
    connectSpec = { host: '127.0.0.1', port };
  } else {
    unixSockPath = deriveUnixSocketPath(sessionKey);
    await ensureUnixSocketFree(unixSockPath);
    args.push('--ui', 'headless', '--socket', unixSockPath);
    env.OMNI_IRC_SOCKET = unixSockPath;
    connectSpec = { path: unixSockPath };
  }

  sendToAll('backend-log', `[spawn][${sessionId}] ${exe} ${args.join(' ')}`);
  const child = spawn(exe, args, { env, windowsHide: true });
  pipeChildLogs(child);

  // Connect to UI pipe
  let sock, rl;
  try {
    sock = await new Promise((resolve, reject) => {
      const deadline = Date.now() + 15000;
      const tryConnect = () => {
        const c = net.createConnection(connectSpec);
        c.once('connect', () => resolve(c));
        c.once('error', () => {
          c.destroy();
          if (Date.now() > deadline) return reject(new Error('loopback connect timeout'));
          setTimeout(tryConnect, 200);
        });
      };
      tryConnect();
    });
  } catch (e) {
    killChild(child);
    throw e;
  }

  sock.setEncoding('utf8');
  sock.setKeepAlive(true, 10_000);
  sock.setNoDelay(true);

  rl = readline.createInterface({ input: sock, crlfDelay: Infinity });
  rl.on('line', (line) => sendToAll('session:data', { id: sessionId, line }));
  sock.on('error', (err) => sendToAll('session:error', { id: sessionId, message: err.message }));
  child.on('close', (code) => {
    sendToAll('session:status', { id: sessionId, status: 'stopped', code });
    try { rl?.close(); } catch {}
    try { sock?.destroy(); } catch {}
    if (unixSockPath) { try { fs.unlinkSync(unixSockPath); } catch {} }
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, { child, env, exe, sock, rl, opts, unixSockPath, sessionKey });
  sendToAll('session:status', { id: sessionId, status: 'running' });

  return { id: sessionId, socket: unixSockPath || `${connectSpec.host}:${connectSpec.port}` };
}
async function stopSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  try { s.sock?.write('/quit\r\n'); } catch {}
  try { s.rl?.close(); } catch {}
  try { s.sock?.destroy(); } catch {}
  killChild(s.child);
  if (s.unixSockPath) { try { fs.unlinkSync(s.unixSockPath); } catch {} }
  sessions.delete(sessionId);
  sendToAll('session:status', { id: sessionId, status: 'stopped' });
}
async function restartSession(sessionId, opts) {
  await stopSession(sessionId);
  return startSession(sessionId, opts);
}

/* =============================================================================
   Windows / Menu / Tray
============================================================================= */
function createWindow() {
  const iconWinLinux = isWin
    ? assetPath('build', 'icons', 'icon.ico')
    : assetPath('build', 'icons', 'png', 'icon.png'); // used on Linux; mac ignores window icon
  mainWin = new BrowserWindow({
    width: 1480,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    icon: process.platform === 'darwin' ? undefined : iconWinLinux,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWin.loadFile('index.html');
}

function buildMenu() {
  const tpl = [
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }]},
    { role: 'help', submenu: [] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function setupTray() {
  // Use resourcesPath when packaged; dev path otherwise
  const trayIconPath = (() => {
    if (process.platform === 'darwin') {
      // we shipped PNGs under Resources/icons/png via extraResources
      return assetPath('icons', 'png', 'omnichat_32.png');
    }
    if (isWin) return assetPath('build', 'icons', 'icon.ico');
    return assetPath('build', 'icons', 'png', 'icon.png');
  })();
  try {
    tray = new Tray(trayIconPath);
    tray.setToolTip('Omni Chat');
  } catch {}
}

/* =============================================================================
   IPC Wiring
============================================================================= */
function setupIPC() {
  // Sessions
  ipcMain.handle('session:start', async (_e, id, opts) => startSession(id || genId(), opts));
  ipcMain.handle('session:stop',  async (_e, id)       => stopSession(id));
  ipcMain.handle('session:restart', async (_e, id, opts) => restartSession(id, opts));
  
  ipcMain.on('session:send', (_e, { id, line }) => {
    const s = sessions.get(id);
    if (s && s.sock && !s.sock.destroyed) {
      s.sock.write(line.endsWith('\n') || line.endsWith('\r') ? line : (line + '\r\n'));
    }
  });

  // UI pub/sub
  ipcMain.on('ui-pub', (_e, { event, payload }) => {
    if (!event) return;
    sendToAll(`ui-sub:${event}`, payload);
  });

  // Bootstrap
  ipcMain.handle('bootstrap:runTerminal', async () => runBootstrap({ mode: 'terminal' }));
  ipcMain.handle('bootstrap:start',       async () => runBootstrap({ mode: 'background' }));
  ipcMain.handle('bootstrap:openLogs',    async () => { await shell.openPath(app.getPath('userData')); return true; });
  ipcMain.on('bootstrap:proceed-if-ready', async () => {
    if (await backendReady()) {
      try { installerWin?.close(); } catch {}
      createWindow(); buildMenu(); setupTray();
    } else {
      sendToAll('bootstrap:log', 'Backend still not ready.\n');
    }
  });

  ipcMain.handle('dm:open', async (_e, { sessionId, peer, bootLine }) => {
    createDMWindow(sessionId, peer, bootLine);
    return true;
  });

  ipcMain.on('dm:push-user', (_e, { sessionId, user }) => {
    if (!user) return;
    const nick =
      user.nick || user.nickname || user.name || user.user || user.username;
    if (!nick) return;

    // cache latest user for quick replies
    userCache.set(dmKey(sessionId, nick), { ...user });

    // deliver to any DM window whose peer matches this nick (case-insensitive) in this session
    for (const [key, win] of dmWindows.entries()) {
      if (!win || win.isDestroyed()) continue;
      const [sess, peerLower] = key.split(':');
      if (sess === String(sessionId) && peerLower === String(nick).toLowerCase()) {
        try { win.webContents.send('dm:user', { sessionId, user }); } catch {}
      }
    }
  });

  ipcMain.on('dm:request-user', (evt, { sessionId, nick }) => {
    if (!nick) return;
    const cached = userCache.get(dmKey(sessionId, nick));
    if (cached) {
      // reply only to the requesting DM window
      try { evt.sender.send('dm:user', { sessionId, user: cached }); } catch {}
    }
  });
}

/* =============================================================================
   Installer Window (first-run)
============================================================================= */
function createInstallerWindow() {
  installerWin = new BrowserWindow({
    width: 880,
    height: 620,
    title: 'Omni Chat – First-time Setup',
    resizable: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  installerWin.loadFile(path.join(app.getAppPath(), 'renderer', 'installer.html'));
}

/* =============================================================================
   Boot
============================================================================= */
async function ensureBackendReadyAtStartup() {
  const ok = await backendReady();
  if (ok) return true;
  // show installer; bootstrap IPC already wired in setupIPC()
  createInstallerWindow();
  return false;
}

app.whenReady().then(async () => {
  // Make brew/macports visible when launched from Finder
  seedUnixPath(process.env);
  setupIPC();
  const ok = await ensureBackendReadyAtStartup();
  if (ok) { createWindow(); buildMenu(); setupTray(); }
});

app.on('before-quit', async () => {
  await Promise.all([...sessions.keys()].map(id => stopSession(id).catch(()=>{})));
});
app.on('window-all-closed', () => app.quit());
