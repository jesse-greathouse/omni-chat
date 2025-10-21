import Store from 'electron-store';
import { app, session, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import readline from 'node:readline';
import { spawn, execFile, spawnSync } from 'node:child_process';
import { defaultPort, canonicalizeConnOptions } from './renderer/config/defaults.js';

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
let _cachedOverlayPng = null;
let settingsWin = null;
let proceededToMain = false;
let bootstrapSettled = false;
let bootstrapSawCompleteBanner = false;

/* =============================================================================
  Paths & Small Utilities
============================================================================= */
const isWin = process.platform === 'win32';
const MAX_USERS = 3000;

function assetPath(...p) {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(base, ...p);
}
function quote(s) { return `"${String(s).replace(/"/g, '\\"')}"`; }
function genId() { return randomBytes(8).toString('hex'); }

function sendToAll(ch, payload) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(ch, payload);
}

async function proceedIfReadyOnce() {
  if (proceededToMain) return true;
  try {
    if (await backendReady()) {
      proceededToMain = true;
      try { installerWin?.close(); } catch (e) { console.error('[proceedIfReadyOnce] close installer', e); }
      if (!mainWin || mainWin.isDestroyed()) {
        createWindow(); buildMenu(); setupTray();
      }
      return true;
    }
  } catch (e) {
    console.error('[proceedIfReadyOnce]', e);
  }
  return false;
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
  } catch (e) { console.error('[killChild]', e); }
}
function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });
}
function wireEditAccelerators(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.meta || input.control;
    if (!mod) return;
    const k = (input.key || '').toLowerCase();
    if (k === 'c') { win.webContents.copy(); event.preventDefault(); }
    else if (k === 'v') { win.webContents.paste(); event.preventDefault(); }
    else if (k === 'x') { win.webContents.cut(); event.preventDefault(); }
    else if (k === 'a') { win.webContents.selectAll(); event.preventDefault(); }
  });
}
function enableContextMenu(win) {
  win.webContents.on('context-menu', (_e, params) => {
    const menu = Menu.buildFromTemplate([
      { role: 'copy',  enabled: !!params.selectionText },
      { role: 'paste', enabled: params.isEditable },
      { type: 'separator' },
      { role: 'selectAll' }
    ]);
    menu.popup({ window: win });
  });
}
function whereFirst(name) {
  try {
    const out = spawnSync('where', [name], { encoding: 'utf8', windowsHide: true });
    if (out.status === 0) {
      const p = (out.stdout || '').split(/\r?\n/).find(Boolean);
      if (p && fs.existsSync(p.trim())) return p.trim();
    }
  } catch {}
  return null;
}
/** Back-compat shim for old & new console-message signatures. */
function onConsoleMessage(wc, tag) {
  wc.on('console-message', (_e, a2, a3, a4, a5) => {
    let level, message, line, sourceId;
    // New signature: (_e, paramsObject)
    if (a2 && typeof a2 === 'object' && ('level' in a2 || 'message' in a2)) {
      ({ level, message, line, sourceId } = a2);
    } else {
      // Old signature: (_e, level, message, line, sourceId)
      level = a2; message = a3; line = a4; sourceId = a5;
    }
    const lvlName = ['log','warn','error','debug'][level] || String(level);
    console.log(`[renderer][${tag}][${lvlName}] ${sourceId}:${line} ${message}`);
  });
}

// App-wide accelerators (per-window hook) for Control+S and Control+Escape
function wireAppAccelerators(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    // Spec explicitly says "control", not "command"
    const ctrl = input.control === true; // do not treat meta as control
    if (!ctrl) return;
    const key = (input.key || '').toLowerCase();
    if (key === 's') {
      openSettingsWindow();
      event.preventDefault();
    } else if (key === 'escape') {
      app.quit();
      event.preventDefault();
    }
  });
}

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 1200,
    height: 800,
    center: true,
    resizable: true,
    title: 'Omni-Chat Settings',
    icon: process.platform === 'win32'
      ? assetPath('build', 'icons', 'icon.ico')
      : assetPath('build', 'icons', 'png', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  try { settingsWin.setMenu(null); settingsWin.setMenuBarVisibility(false); }
  catch (e) { console.warn('[settingsWin menu clear]', e); }

  settingsWin.loadFile(path.join(app.getAppPath(), 'renderer', 'settings.html'));

  // <<< use shim here
  onConsoleMessage(settingsWin.webContents, 'settings');

  settingsWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[settings did-fail-load]', { code, desc, url });
  });
  settingsWin.on('unresponsive', () => console.error('[settings] UNRESPONSIVE'));
  settingsWin.webContents.on('render-process-gone', (_e, details) => {
    console.error('[settings render-process-gone]', details);
  });

  settingsWin.webContents.on('did-finish-load', () => {
    try { settingsWin.setTitle('Omni-Chat Settings'); } catch {}
  });

  wireEditAccelerators(settingsWin);
  enableContextMenu(settingsWin);
  wireAppAccelerators(settingsWin);

  settingsWin.on('closed', () => { settingsWin = null; });
}

function putUser(key, val) {
  userCache.set(key, val);
  if (userCache.size > MAX_USERS) {
    const first = userCache.keys().next().value;
    userCache.delete(first);
  }
}
function seedUnixPath(env) {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const seed = [
      '/opt/homebrew/bin','/opt/homebrew/sbin',
      '/usr/local/bin','/usr/local/sbin',
      '/opt/local/bin','/opt/local/sbin'
    ];
    const cur = env.PATH || '';
    const add = seed.filter(p => !cur.split(':').includes(p));
    if (add.length) env.PATH = add.join(':') + (cur ? (':' + cur) : '');
  }
  return env;
}
function resolveTool(name, extraDirs = []) {
  const k = [`${name.toUpperCase()}_EXE`, `OMNI_${name.toUpperCase()}_EXE`];
  for (const key of k) {
    const v = process.env[key];
    if (v && fs.existsSync(v)) return v;
  }
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
function notificationBallPng() {
  if (null !== _cachedOverlayPng) return _cachedOverlayPng;
  _cachedOverlayPng = nativeImage.createFromPath(assetPath('build', 'icons', 'png', 'notification_ball_16.png'));
  return _cachedOverlayPng;
}
function dmAppId(sessionId, username) {
  const cleanUser = String(username).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  const cleanSess = String(sessionId).toLowerCase().replace(/[^a-z0-9]+/g, '.');
  const id = `com.omnichat.app.dm.${cleanUser}.${cleanSess}`;
  return id.slice(0, 120);
}
function dmKey(sessionId, peer) {
  return `${sessionId}:${String(peer || '').toLowerCase()}`;
}

function createDMWindow(sessionId, peer, bootLine ) {
  const key = dmKey(sessionId, peer);
  const existing = dmWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    if (bootLine) {
      try { existing.webContents.send('dm:line', { sessionId, peer, ...bootLine }); }
      catch (e) { console.error('[dm existing send boot line]', e); }
    }
    try { existing.webContents.send('settings:changed', { full: settings.store }); }
    catch (e) { console.error('[dm existing seed settings]', e); }
    return existing;
  } else if (existing?.isDestroyed()) {
    dmWindows.delete(key);
  }

  const w = new BrowserWindow({
    width: 640,
    height: 450,
    minWidth: 420,
    minHeight: 320,
    title: String(peer),
    icon: isWin
      ? assetPath('build', 'icons', 'icon.ico')
      : assetPath('build', 'icons', 'png', 'omnichat_16.png'),
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.platform === 'win32') {
    try { w.setAppDetails({ appId: dmAppId(sessionId, peer) }); }
    catch (e) { console.error('[dm setAppDetails]', e); }
  }

  w.loadFile(path.join(app.getAppPath(), 'renderer', 'dm.html'));

  // <<< use shim here
  onConsoleMessage(w.webContents, `dm ${sessionId}/${peer}`);

  w.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[dm did-fail-load]', { code, desc, url, sessionId, peer });
  });
  w.on('unresponsive', () => console.error('[dm] UNRESPONSIVE', { sessionId, peer }));
  w.webContents.on('render-process-gone', (_e, details) => {
    console.error('[dm render-process-gone]', { sessionId, peer, details });
  });

  wireEditAccelerators(w);
  enableContextMenu(w);

  w.on('closed', () => dmWindows.delete(key));
  const bootBuffer = [];
  if (bootLine) bootBuffer.push({ sessionId, peer, ...bootLine });
  w.webContents.on('did-finish-load', () => {
    try {
      w.setTitle(String(peer));
      w.webContents.send('dm:init', { sessionId, peer, bootLines: bootBuffer });
      const cached = userCache.get(dmKey(sessionId, peer));
      if (cached) { w.webContents.send('dm:user', { sessionId, user: cached }); }
      w.webContents.send('settings:changed', { full: settings.store });
    } catch (e) { console.error('[dm did-finish-load init]', e); }
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
    perf: {
      TRANSCRIPT_MAX_LINES: 2000,
      TRANSCRIPT_PRUNE_CHUNK: 200,
      TRANSCRIPT_MAX_APPEND_PER_FRAME: 200,
      TRANSCRIPT_BATCH_MS: 16,
      TRANSCRIPT_SNAP_THRESHOLD_PX: 40,
      CHANLIST_RENDER_CAP: 5000,
      CHANLIST_RAF_RENDER: true,
    },
    globals: { nick: 'guest', realname: 'Guest', authType: 'none', authUsername: null, authPassword: null },
    servers: {
      'irc.libera.chat': {
        host: 'irc.libera.chat',
        port: 6697,
        tls: true,
        nick: null, realname: null, authType: null, authUsername: null, authPassword: null
      }
    }
  }
});

function sendSettingsChanged(partial) {
  const full = settings.store;
  sendToAll('settings:changed', { ...partial, full });
}

ipcMain.handle('settings:get',   (_e, key, fallback) => settings.get(key, fallback));
ipcMain.handle('settings:set',   (_e, key, value)    => { settings.set(key, value); sendSettingsChanged({ domain: key, path: '', value }); return true; });
ipcMain.handle('settings:all',   () => settings.store);
ipcMain.handle('settings:path',  () => settings.path);
ipcMain.handle('settings:saveAll', async () => true);

ipcMain.handle('settings:resetAll', async () => {
  try {
    settings.clear();
    sendSettingsChanged({});
    return true;
  } catch (e) {
    console.error('[settings:resetAll]', e);
    throw e;
  }
});

function setPathInDomain(domain, dotted, value) {
  const cur = settings.get(domain, {}) || {};
  const parts = String(dotted || '').split('.').filter(Boolean);
  if (parts.length === 0) {
    settings.set(domain, value && typeof value === 'object' ? value : {});
    return;
  }
  let t = cur;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    t[k] = (t[k] && typeof t[k] === 'object') ? t[k] : {};
    t = t[k];
  }
  t[parts.at(-1)] = value;
  settings.set(domain, cur);
}

ipcMain.handle('settings:setPath', (_e, domain, path, value) => {
  const dom = String(domain || '');
  if (!['perf','ui','globals','servers'].includes(dom)) {
    throw new Error(`bad domain: ${domain}`);
  }
  setPathInDomain(dom, path, value);
  sendSettingsChanged({ domain: dom, path: String(path || ''), value });
  clearTimeout(ipcMain.__settingsFullTimer);
  ipcMain.__settingsFullTimer = setTimeout(() => {
    sendSettingsChanged({ full: settings.store });
  }, 150);
  return true;
});

function getServers() { const s = settings.get('servers', {}); return (s && typeof s === 'object') ? s : {}; }
function setServers(next) { settings.set('servers', next || {}); sendSettingsChanged({ domain: 'servers', path: '', value: next }); }
function getGlobals() {
  const g = settings.get('globals', {});
  return {
    nick: (g?.nick ?? 'guest'),
    realname: (g?.realname ?? 'Guest'),
    authType: (g?.authType ?? 'none'),
    authUsername: g?.authUsername ?? null,
    authPassword: g?.authPassword ?? null
  };
}
function resolveServerProfile(host) {
  const servers = getServers();
  const g = getGlobals();
  const p = servers[host] || { host, port: defaultPort(true), tls: true, nick: null, realname: null };
  const tls = (p.tls !== false);
  const port = Number(p.port ?? defaultPort(tls));
  return {
    host: p.host ?? host,
    port,
    tls,
    nick: (p.nick == null || p.nick === '') ? g.nick : p.nick,
    realname: (p.realname == null || p.realname === '') ? g.realname : p.realname,
    authType: (p.authType == null || p.authType === '') ? (g.authType || 'none') : p.authType,
    authUsername: (p.authUsername == null || p.authUsername === '') ? (g.authUsername || null) : p.authUsername,
    authPassword: (p.authPassword == null || p.authPassword === '') ? (g.authPassword || null) : p.authPassword
  };
}

ipcMain.handle('profiles:list', () => {
  const servers = getServers();
  const out = {}; for (const [host, p] of Object.entries(servers)) out[host] = { ...p };
  return out;
});
ipcMain.handle('profiles:upsert', (_e, host, profile) => {
  host = String(host || '').trim();
  if (!host) throw new Error('host required');
  const servers = getServers();
  const existing = servers[host] || { host, port: defaultPort(true), tls: true, nick: null, realname: null };

  const nextTls  = (profile?.tls ?? existing.tls ?? true) !== false;
  const nextPort = Number(profile?.port ?? existing.port ?? defaultPort(nextTls));

  servers[host] = {
    host,
    port: nextPort,
    tls: nextTls,
    nick: (profile?.nick === undefined ? existing.nick : (profile.nick ?? null)),
    realname: (profile?.realname === undefined ? existing.realname : (profile.realname ?? null)),
    authType: (profile?.authType === undefined ? existing.authType : (profile.authType ?? null)),
    authUsername: (profile?.authUsername === undefined ? existing.authUsername : (profile.authUsername ?? null)),
    authPassword: (profile?.authPassword === undefined ? existing.authPassword : (profile.authPassword ?? null)),
  };
  setServers(servers);
  sendSettingsChanged({ domain: 'servers', path: host, value: servers[host] });
  return true;
});
ipcMain.handle('profiles:delete', (_e, host) => {
  host = String(host || '').trim();
  if (!host) return false;
  const servers = getServers();
  if (servers[host]) {
    delete servers[host];
    setServers(servers);
    sendSettingsChanged({ domain: 'servers', path: host, value: null });
    return true;
  }
  return false;
});
ipcMain.handle('profiles:resolve', (_e, host) => resolveServerProfile(String(host || '').trim()));

/* =============================================================================
  Backend Discovery (opam env + omni client)
============================================================================= */
function canonicalSessionKey(opts) {
  const o = canonicalizeConnOptions(opts);
  const nick = String(o.nick || '').trim().toLowerCase();
  const host = String(o.server || '').trim().toLowerCase();
  const port = String(o.ircPort || '');
  const proto = o.tls ? 'tls' : 'tcp';
  return `${nick}@${host}:${port}/${proto}`;
}
function deriveUnixSocketPath(sessionKey) {
  const base = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  const dir = path.join(base, 'omni-chat');
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  catch (e) { console.warn('[deriveUnixSocketPath mkdirSync]', e); }
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
    setTimeout(() => {
      if (!settled) {
        try { c.destroy(); }
        catch (e) { console.warn('[ensureUnixSocketFree destroy timeout]', e); }
        resolve(false);
      }
    }, 250);
  });
  if (ok) throw new Error(`A session for this nick/server is already active (socket: ${sockPath}).`);
  try { fs.unlinkSync(sockPath); }
  catch (e) { console.error('[ensureUnixSocketFree unlink]', e); }
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

// Add this helper near resolveTool()
function isExecFile(p) {
  try { return !!(p && fs.existsSync(p) && fs.statSync(p).isFile() && (fs.statSync(p).mode & 0o111)); }
  catch { return false; }
}

// Add this helper near resolveOmniIrcClientPath()
function findLocalPrebuiltClient() {
  const home = os.homedir();
  const root = path.join(home, '.local', 'omni-irc', 'pkg');
  if (!fs.existsSync(root)) return null;

  // Prefer a 'current' pointer if you ever add one; otherwise pick the newest-looking dir
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()            // lexicographic vX.Y.Z sorts OK if prefixed with 'v'; good enough here
    .reverse();

  for (const dir of entries) {
    const bin = path.join(root, dir, 'bin', process.platform === 'win32' ? 'omni-irc-client.exe' : 'omni-irc-client');
    if (isExecFile(bin)) return bin;

    // Fallback: if an app bundle exists under this label, use its inner binary
    const app = path.join(root, dir, 'Omni IRC Client.app');
    const inner = path.join(app, 'Contents', 'MacOS', 'omni');
    if (isExecFile(inner)) return inner;
  }
  return null;
}

async function resolveOmniIrcClientPath(env) {
  const exeName = isWin ? 'omni-irc-client.exe' : 'omni-irc-client';

  // Explicit env
  if (process.env.OMNI_IRC_CLIENT && fs.existsSync(process.env.OMNI_IRC_CLIENT)) return process.env.OMNI_IRC_CLIENT;

  // Prebuilt normalized install under ~/.local/omni-irc/pkg/*
  const localPrebuilt = findLocalPrebuiltClient();
  if (localPrebuilt) return localPrebuilt;

  // Windows where
  if (isWin) {
    const fromWhere = whereFirst(exeName);
    if (fromWhere) return fromWhere;
  }

  // Dev tree guess
  try {
    const guess = path.resolve(app.getAppPath(), '..', 'omni-irc', '_build', 'install', 'default', 'bin', exeName);
    if (fs.existsSync(guess)) return guess;
  } catch {}

  // OPAM switch bin
  const root = env.OPAMROOT || path.join(os.homedir(), '.opam');
  const sw   = env.OPAMSWITCH || 'omni-irc-dev';
  const fromSwitch = path.join(root, sw, 'bin', exeName);
  if (fs.existsSync(fromSwitch)) return fromSwitch;

  // opam var bin
  try {
    const opamExe = resolveTool(isWin ? 'opam.exe' : 'opam', ['/opt/homebrew/bin','/usr/local/bin','/opt/local/bin']);
    if (opamExe) {
      const { stdout } = await execFileP(opamExe, ['var', 'bin'], { env, windowsHide: true });
      const p = path.join(stdout.trim(), exeName);
      if (fs.existsSync(p)) return p;
    }
  } catch (e) {
    console.warn('[resolveOmniIrcClientPath opam var bin]', e);
  }

  return null;
}

async function ensureClientBinary() {
  const base = seedUnixPath({ ...process.env });

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
  } catch (e) {
    console.warn('[ensureClientBinary] opam env failed; falling back', e);
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
    const res = spawnSync(exe, ['--help'], { env, windowsHide: true, encoding: 'utf8' });
    if (res.status === 0) return true;
    const s = (res.stdout || '') + (res.stderr || '');
    return /omni-irc/i.test(s);
  } catch (e) {
    console.error('[backendReady] version probe', e);
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
    } catch (e) { console.warn('[pickPwsh where]', e); }
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
  try { if (bootstrapLogPath) fs.appendFileSync(bootstrapLogPath, text); }
  catch (e) { console.warn('[sendBootstrapLog appendFileSync]', e); }
  sendToAll('bootstrap:log', text);
}

async function runBootstrap({ mode = 'terminal' } = {}) {
  const cwd   = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const env   = { ...process.env, OPAMYES: '1' };
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
  if (!isWin) {
    try { fs.chmodSync(script, 0o755); }
    catch (e) { console.error('[bootstrap chmod]', e); }
  }

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
      await runBootstrap({ mode: 'background' });

      const logPath = path.join(app.getPath('userData'), 'bootstrap.log');
      const tmpCmd  = path.join(app.getPath('userData'), `tail-bootstrap-${Date.now()}.command`);
      const tailScript = `#!/bin/sh
LOG="${logPath}"
clear
echo "Following install log:"
echo "  $LOG"
echo
/usr/bin/tail -n +1 -F "$LOG" | /usr/bin/awk '{ print; fflush(); if ($0 ~ /^✔ bootstrap completed successfully$/ || $0 ~ /^✘ bootstrap exited with code /) exit }'
echo
echo "*** Omni-IRC bootstrap finished. Press Return to close... ***"
read -r _
`;
      try { fs.writeFileSync(tmpCmd, tailScript, { mode: 0o755 }); }
      catch (e) { console.error('[bootstrap tmp write]', e); }
      const child = spawn('open', ['-a', 'Terminal', tmpCmd], { detached: true, stdio: 'ignore' });
      child.unref();
      setTimeout(() => {
        try { fs.unlinkSync(tmpCmd); }
        catch (e) { console.error('[bootstrap tmp cleanup]', e); }
      }, 10 * 60 * 1000);
      return true;
    }

    const t = findTerminalOnLinux(cwd, script);
    if (!t) throw new Error('No terminal emulator found (x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, xterm, alacritty, kitty).');
    const child = spawn(t.cmd, t.args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }

  if (bootstrapChild && !bootstrapChild.killed) {
    try { bootstrapChild.kill(); }
    catch (e) { console.warn('[bootstrap kill previous]', e); }
    bootstrapChild = null;
  }
  bootstrapSettled = false;
  bootstrapSawCompleteBanner = false;
  bootstrapLogPath = path.join(app.getPath('userData'), 'bootstrap.log');
  try {
    fs.mkdirSync(path.dirname(bootstrapLogPath), { recursive: true });
    fs.writeFileSync(bootstrapLogPath, `# Omni-IRC bootstrap log -- ${new Date().toISOString()}\n`);
  } catch (e) { console.error('[bootstrap prepare log]', e); }

  // Hint to the script that we're headless so it must not pause for Enter
  env.OMNI_BOOTSTRAP_MODE = 'background';

  if (isWin) {
    const pwsh = pickPwsh();
    const args = ['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File', script];
    sendBootstrapLog(`[bootstrap] pwsh: ${pwsh}\n[bootstrap] cwd: ${cwd}\n[bootstrap] args: ${args.join(' ')}\n`);
    bootstrapChild = spawn(pwsh, args, { cwd, env, windowsHide: true });
  } else {
    const cmd = `exec ${quote(script)} 2>&1`;
    bootstrapChild = spawn('sh', ['-c', cmd], { cwd, env });
  }

  sendBootstrapLog('[bootstrap] spawned\n');
  const logStream = (() => {
    try { return fs.createWriteStream(bootstrapLogPath, { flags: 'a' }); }
    catch (e) { console.warn('[bootstrap createWriteStream]', e); return null; }
  })();
  const pipeChunk = (buf) => {
    const s = String(buf);
    if (logStream) {
      try { logStream.write(s); }
      catch (e) { console.warn('[bootstrap logStream.write]', e); }
    }
    sendToAll('bootstrap:log', s);

    // Detect the script's success banner even if it doesn't exit promptly.
    if (!bootstrapSettled && /Omni-IRC bootstrap is COMPLETE/i.test(s)) {
      bootstrapSawCompleteBanner = true;
      setTimeout(async () => {
        if (!bootstrapSettled) {
          try { bootstrapChild?.kill?.('SIGTERM'); } catch (_) {}
          bootstrapSettled = true;
          sendToAll('bootstrap:done');
          const okNow = await proceedIfReadyOnce();
          if (!okNow) setTimeout(() => { proceedIfReadyOnce().catch(e => console.error('[proceed retry]', e)); }, 1500);
          try { logStream?.end(); } catch (_) {}
          bootstrapChild = null;
        }
      }, 250);
    }
  };

  bootstrapChild.stdout?.setEncoding('utf8');
  bootstrapChild.stderr?.setEncoding('utf8');
  bootstrapChild.stdout?.on('data', pipeChunk);
  bootstrapChild.stderr?.on('data', pipeChunk);
  bootstrapChild.on('error', (err) => {
    console.error('[bootstrap spawn error]', err);
    sendBootstrapLog(`\n✘ Failed to start bootstrap: ${err.message}\n`);
    sendToAll('bootstrap:error', -1);
  });
  bootstrapChild.on('close', (code) => {
    if (bootstrapSettled) return; // already handled by sentinel path
    bootstrapSettled = true;
    if (code === 0 || bootstrapSawCompleteBanner) {
      sendBootstrapLog('\n✔ bootstrap completed successfully\n');
      sendToAll('bootstrap:done');
      (async () => {
        const okNow = await proceedIfReadyOnce();
        if (!okNow) setTimeout(() => { proceedIfReadyOnce().catch(e => console.error('[post-close proceed retry]', e)); }, 1500);
      })().catch(e => console.error('[post-close proceed]', e));
    } else {
      sendBootstrapLog(`\n✘ bootstrap exited with code ${code}\n`);
      sendToAll('bootstrap:error', code ?? 1);
    }
  });

  return true;
}

/* =============================================================================
  Session Manager
============================================================================= */
async function startSession(sessionId, opts) {
  const { env, exe } = await ensureClientBinary();

  const o = canonicalizeConnOptions(opts);
  const sessionKey = canonicalSessionKey(o);

  if (!isWin) {
    for (const s of sessions.values()) {
      if (s.sessionKey === sessionKey) {
        throw new Error(`Already connected as ${sessionKey}`);
      }
    }
  }

  const args = [
    '--server', String(o.server),
    '--port',   String(o.ircPort),
    '--nick',   String(o.nick ?? ''),
    '--realname', String(o.realname ?? '')
  ];
  if (o.tls) args.push('--tls');

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
    try { rl?.close(); } catch (e) { console.error('[session child close rl]', e); }
    try { sock?.destroy(); } catch (e) { console.error('[session child close sock]', e); }
    if (unixSockPath) {
      try { fs.unlinkSync(unixSockPath); }
      catch (e) { console.error('[session cleanup sock]', e); }
    }
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, { child, env, exe, sock, rl, opts: o, unixSockPath, sessionKey });
  sendToAll('session:status', { id: sessionId, status: 'running' });

  return {
    id: sessionId,
    socket: unixSockPath || `${connectSpec.host}:${connectSpec.port}`
  };
}

async function stopSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  try { s.sock?.write('/quit\r\n'); } catch (e) { console.error('[stopSession write /quit]', e); }
  try { s.rl?.close(); } catch (e) { console.error('[stopSession rl close]', e); }
  try { s.sock?.destroy(); } catch (e) { console.error('[stopSession sock destroy]', e); }
  killChild(s.child);
  if (s.unixSockPath) {
    try { fs.unlinkSync(s.unixSockPath); }
    catch (e) { console.error('[stopSession unlink sock]', e); }
  }
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
    : assetPath('build', 'icons', 'png', 'icon.png');
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

  // <<< use shim here
  onConsoleMessage(mainWin.webContents, 'main');

  mainWin.webContents.on('did-fail-load', (_e, errCode, errDesc, url, isMainFrame) => {
    console.error('[mainWin did-fail-load]', { errCode, errDesc, url, isMainFrame });
  });
  mainWin.on('unresponsive', () => console.error('[mainWin] UNRESPONSIVE'));
  mainWin.webContents.on('render-process-gone', (_e, details) => {
    console.error('[mainWin render-process-gone]', details);
  });
  mainWin.webContents.on('gpu-process-crashed', (_e, killed) => {
    console.error('[GPU crashed]', { killed });
  });

  mainWin.webContents.on('did-finish-load', () => {
    try { sendSettingsChanged({}); } catch (e) { console.error('[mainWin seed full]', e); }
  });

  wireEditAccelerators(mainWin);
  enableContextMenu(mainWin);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const appMenu = {
    label: app.name,
    submenu: [
      ...(isMac ? [
        { role: 'about' },
        { type: 'separator' },
      ] : []),
      {
        label: isMac ? 'Preferences…' : 'Settings',
        role: isMac ? 'preferences' : undefined,
        accelerator: 'Ctrl+S',
        click: () => openSettingsWindow()
      },
      { type: 'separator' },
      ...(isMac ? [
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
      ] : []),
      {
        label: 'Quit',
        accelerator: 'Ctrl+Escape',
        click: () => app.quit()
      }
    ]
  };

  const tpl = [
    appMenu,
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' },
        { role: 'delete' }, { role: 'selectAll' },
        ...(isMac ? [{ type: 'separator' }, { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }] : [])
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (!win) return;
            if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
            else win.webContents.openDevTools({ mode: 'detach' });
          }
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }]},
    { role: 'help', submenu: [] }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function setupTray() {
  const trayIconPath = (() => {
    if (process.platform === 'darwin') {
      return assetPath('icons', 'png', 'omnichat_32.png');
    }
    if (isWin) return assetPath('build', 'icons', 'icon.ico');
    return assetPath('build', 'icons', 'png', 'icon.png');
  })();

  try {
    tray = new Tray(trayIconPath);
    tray.setToolTip('Omni Chat');
  } catch (e) { console.error('[setupTray]', e); }
}

/* =============================================================================
  IPC Wiring
============================================================================= */
function setupIPC() {
  const trace = (name, fn) => ipcMain.handle(name, async (evt, ...args) => {
    const t0 = Date.now();
    try {
      const res = await fn(evt, ...args);
      const dt = Date.now() - t0;
      if (dt > 250) console.warn(`[ipc][${name}] slow: ${dt}ms`, { argsPreview: JSON.stringify(args).slice(0, 200) });
      return res;
    } catch (e) {
      console.error(`[ipc][${name}] error`, e);
      throw e;
    }
  });

  // Sessions
  trace('session:start',   (_e, id, opts) => startSession(id || genId(), opts));
  trace('session:stop',    (_e, id)       => stopSession(id));
  trace('session:restart', (_e, id, opts) => restartSession(id, opts));

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
  trace('bootstrap:runTerminal', () => runBootstrap({ mode: 'terminal' }));
  trace('bootstrap:start',       () => runBootstrap({ mode: 'background' }));
  trace('bootstrap:openLogs',    async () => { await shell.openPath(app.getPath('userData')); return true; });
  ipcMain.on('bootstrap:proceed-if-ready', async () => {
    const ok = await proceedIfReadyOnce();
    if (!ok) sendToAll('bootstrap:log', 'Backend still not ready.\n');
  });

  // DMs
  trace('dm:open', (_e, { sessionId, peer, bootLine }) => { createDMWindow(sessionId, peer, bootLine); return true; });

  ipcMain.on('dm:notify', (_e, { sessionId, peer }) => {
    const w = dmWindows.get(dmKey(sessionId, peer));
    if (!w || w.isDestroyed()) return;

    const cueNotify = () => {
      try { w.webContents.send('dm:notify', { sessionId, peer }); }
      catch (e) { console.error('[dm notify send]', e); }
    };

    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', cueNotify);
    else cueNotify();

    if (process.platform === 'win32') {
      const setOverlay = () => {
        const img = notificationBallPng();
        if (img) {
          try { w.setOverlayIcon(img, ''); }
          catch (e) { console.error('[dm overlay set]', e); }
        }
      };

      if (w.isMinimized() || w.isVisible()) {
        setOverlay();
      } else {
        w.once('ready-to-show', setOverlay);
      }

      const clear = () => {
        try { w.setOverlayIcon(null, ''); }
        catch (e) { console.error('[dm overlay clear]', e); }
      };
      w.once('focus',  clear);
      w.once('closed', clear);
    } else if (process.platform === 'darwin') {
      try { app.dock?.setBadge?.('•'); }
      catch (e) { console.error('[dm dock badge set]', e); }
      const clear = () => {
        try { app.dock?.setBadge?.(''); }
        catch (err) { console.error('[dm dock badge clear]', err); }
      };
      w.once('focus', clear);
      w.once('closed', clear);
    } else {
      // Linux: no taskbar overlay support
    }
  });

  ipcMain.on('dm:push-user', (_e, { sessionId, user }) => {
    if (!user) return;
    const nick =
      user.nick || user.nickname || user.name || user.user || user.username;
    if (!nick) return;

    putUser(dmKey(sessionId, nick), { ...user });

    for (const [key, win] of dmWindows.entries()) {
      if (!win || win.isDestroyed()) continue;
      const [sess, peerLower] = key.split(':');
      if (sess === String(sessionId) && peerLower === String(nick).toLowerCase()) {
        try { win.webContents.send('dm:user', { sessionId, user }); }
        catch (e) { console.error('[dm push-user send]', e); }
      }
    }
  });

  ipcMain.on('dm:request-user', (evt, { sessionId, nick }) => {
    if (!nick) return;
    const cached = userCache.get(dmKey(sessionId, nick));
    if (cached) {
      try { evt.sender.send('dm:user', { sessionId, user: cached }); }
      catch (e) { console.error('[dm request-user reply]', e); }
    }
  });
}

/* =============================================================================
  Installer Window (first-run)
============================================================================= */
function createInstallerWindow() {
  installerWin = new BrowserWindow({
    width: 880,
    height: 670,
    title: 'Omni Chat | First-time Setup',
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
  createInstallerWindow();
  return false;
}

app.whenReady().then(async () => {
  if (isWin) {
    try { app.setAppUserModelId('com.omnichat.app'); }
    catch (e) { console.error('[setAppUserModelId]', e); }
  }

  const filter = { urls: ['file://*/*'] };
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: file:",
      "media-src 'self' data: file:",
      "connect-src 'self' ws: wss:",
      "font-src 'self' data: file:",
      "frame-src 'none'",
      "frame-ancestors 'none'"
    ].join('; ');

    const headers = { ...details.responseHeaders, 'Content-Security-Policy': [csp] };
    callback({ responseHeaders: headers });
  });

  seedUnixPath(process.env);
  setupIPC();
  try { sendToAll('settings:changed', { full: settings.store }); }
  catch (e) { console.warn('[prime settings broadcast]', e); }
  const ok = await ensureBackendReadyAtStartup();
  if (ok) {
    proceededToMain = true;
    createWindow(); buildMenu(); setupTray();
  }
});

app.on('before-quit', async () => {
  await Promise.all(
    [...sessions.keys()].map(id =>
      stopSession(id).catch((e) => { console.error('[before-quit stopSession]', e); })
    )
  );
});
app.on('window-all-closed', () => app.quit());

process.on('uncaughtException', (e) => {
  console.error('[main uncaughtException]', e);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('[main unhandledRejection]', reason, { promise: p });
});
