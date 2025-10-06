import { api, events, EVT } from './lib/adapter.js';
import { normalizeUser } from './protocol/index.js';

let state       = { sessionId: null, peer: null };
let isFocused   = document.hasFocus();

const logEl     = document.getElementById('log');
const profileEl = document.getElementById('profile');
const btnSend   = document.getElementById('send');
const input     = document.getElementById('input');
const textNode  = document.createTextNode('');
const lines     = [];

logEl.appendChild(textNode);

const onFocus = () => { isFocused = true; };
const onBlur  = () => { isFocused = false; };
window.addEventListener('focus', onFocus);
window.addEventListener('blur',  onBlur);

try {
  // Filled by preload when opening the DM window (if available)
  state.sessionId = api?.dm?.current?.sessionId ?? state.sessionId;
  state.peer      = api?.dm?.current?.peer      ?? state.peer;
  if (state.peer) {
    document.title = String(state.peer);
    input.placeholder = `Message ${state.peer}`;
    // proactively fetch profile snapshot when we *know* the peer
    try { api.dm.requestUser?.(state.sessionId, state.peer); } catch {}
    requestWhois();
  }
} catch {}

// notification sound
let ding = null;
try {
  ding = new Audio('../build/wav/notification.wav');
  ding.preload = 'auto';
  ding.addEventListener('error', e => console.error('ding load error', e));
} catch {}

// Play when main/canon signals a DM notify
const offNotify = events.on(EVT.DM_NOTIFY, (p) => {
  if (!p) return;
  if (state.sessionId && p.sessionId && p.sessionId !== state.sessionId) return;
  if (state.peer && p.peer &&
      String(p.peer).toLowerCase() !== String(state.peer).toLowerCase()) return;
  if (!ding) return;
  try { ding.currentTime = 0; } catch {}
  ding.play?.().catch(()=>{});
});

function requestWhois() {
  if (!state.sessionId || !state.peer) return;
  // using "<nick> <nick>" often yields richer info (account, etc.)
  try { api.sessions.send(state.sessionId, `/whois ${state.peer} ${state.peer}`); } catch {}
}

function append(s){
  lines.push(s);
  textNode.nodeValue = lines.join('\n') + '\n';
  requestAnimationFrame(()=>{ logEl.scrollTop = logEl.scrollHeight; });
}

// Render the header grid from a user object (or show "not found")
function renderProfile(u) {
  // Clear safely without HTML parsing
  if (profileEl.replaceChildren) profileEl.replaceChildren();
  else profileEl.textContent = '';

  const v = normalizeUser(u);

  if (!v || !v.nick) {
    profileEl.classList.add('disabled');
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.peer
      ? `Waiting for profile data for ${state.peer}…`
      : 'Waiting for DM…';
    profileEl.appendChild(empty);
    return;
  }

  profileEl.classList.remove('disabled');

  const extras = [];

  // Only include raw real_name if normalized realname is missing/different
  if ((u?.real_name ?? '') && String(u.real_name) !== String(v.realname ?? '')) {
    extras.push(['Real name', u.real_name]);
  }

  // Only include raw ident if it's not what "User" already shows
  if ((u?.ident ?? '') && String(u.ident) !== String(v.user ?? '')) {
    extras.push(['Ident', u.ident]);
  }

  // helper to format channel_modes { "#chan": ["+o nick", "+v nick2"] }
  const formatChannelModes = (cm) => {
    if (!cm || typeof cm !== 'object') return '';
    const parts = [];
    for (const [chan, arr] of Object.entries(cm)) {
      const val = Array.isArray(arr) ? arr.join(' ') : String(arr);
      parts.push(`${chan}: ${val}`);
    }
    return parts.join(' | ');
  };

  // Build rows using normalized fields + raw extras if present
  const fields = [
    ['Nick',        v.nick],
    ['User',        v.user],
    ['Host',        v.host],
    ['Realname',    v.realname],
    ['Account',     v.account],
    ['Server',      v.server],
    ['Server info', v.server_info],
    ['Secure',      (v.secure == null ? '' : (v.secure ? 'yes' : 'no'))],
    ['Away',        (v.away == null ? '' : (v.away ? (v.away_reason || 'away') : 'no'))],
    ['Idle',        (v.idle_secs == null ? '' : String(v.idle_secs) + 's')],
    ['Signon',      (v.signon_ts == null ? '' : String(v.signon_ts))],
    ['Channels',    (Array.isArray(v.channels) && v.channels.length) ? v.channels.join(' ') : ''],
    ['Modes',       (Array.isArray(v.modes)    && v.modes.length)    ? v.modes.join(' ')    : ''],
    // Only include channel_modes once
    ['Channel modes', formatChannelModes(u?.channel_modes ?? v?.channel_modes)],
    // Append deduped extras
    ...extras,
  ];

  for (const [k, val] of fields) {
    if (val == null || val === '') continue;
    const cell = document.createElement('div');
    cell.className = 'kv';

    const ke = document.createElement('div');
    ke.className = 'k';
    ke.textContent = k;

    const ve = document.createElement('div');
    ve.className = 'v';
    ve.textContent = String(val);

    cell.append(ke, ve);
    profileEl.appendChild(cell);
  }

  // If nothing rendered, keep the panel from looking empty
  if (!profileEl.children.length) {
    profileEl.classList.add('disabled');
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `No profile data yet for ${state.peer}`;
    profileEl.appendChild(empty);
  }
}

// live updates: main will push user objects for our peer
const offUser = events.on(EVT.DM_USER, ({ sessionId, user } = {}) => {
  if (!user) return;

  // Learn sessionId once
  if (!state.sessionId && sessionId) state.sessionId = sessionId;

  // pick a nick from the blob
  const nickRaw =
    user.nick ?? user.nickname ?? user.name ?? user.user ?? user.username ?? '';

  // adopt first non-self nick as the DM peer
  const selfNick = api?.dm?.current?.selfNick ?? '';
  if (!state.peer && nickRaw && nickRaw !== selfNick && !user.self && !user.is_self) {
    state.peer = nickRaw;
    document.title = String(state.peer);
    input.placeholder = `Message ${state.peer}`;
    api.dm.requestUser?.(state.sessionId, state.peer);
    requestWhois();
  }

  // if we still don't have a peer, nothing to do yet
  if (!state.peer) return;

  // update header only for our current peer (case-insensitive)
  const samePeer =
    nickRaw &&
    nickRaw.localeCompare(String(state.peer), undefined, { sensitivity: 'accent' }) === 0;

  if (!samePeer) return;

  if (!user.whois) requestWhois();
  renderProfile(user);
});

function sendNow() {
  const t = input.value.trim();
  if (!t || !state.sessionId || !state.peer) return;
  try { api.sessions.send(state.sessionId, `/msg ${state.peer} ${t}`); } catch {};
  append(`> ${t}`);
  input.value = '';
}

btnSend.addEventListener('click', sendNow);
input.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') sendNow(); });

// receive routed DM lines (sent directly from main)
const offLine = events.on(EVT.DM_LINE, (p) => {
  if (!p) return;
  // Learn sessionId on first line, then filter thereafter
  if (!state.sessionId && p.sessionId) state.sessionId = p.sessionId;
  if (state.sessionId && p.sessionId !== state.sessionId) return;

  // If we still don't know the peer, adopt it from the very first line.
  if (!state.peer) {
    const candidate = p.peer || p.from || p.nick || p.username || null;
    if (candidate) {
      state.peer = candidate;
      document.title = String(state.peer);
      input.placeholder = `Message ${state.peer}`;
      // now that we have a peer, ask for a snapshot so the header can populate
      try { api.dm.requestUser?.(state.sessionId, state.peer); } catch {}
      requestWhois();
    }
  }

  // If we *do* have a peer, only show lines for that peer.
  if (state.peer && (p.peer || p.from)) {
    const got = String(p.peer || p.from).toLowerCase();
    const want = String(state.peer).toLowerCase();
    if (got !== want) return;
  }
  append(`${p.from}${p.kind === 'NOTICE' ? ' (NOTICE)' : ''}: ${p.text}`);

  // If this is a *new* PRIVMSG for this DM and the window isn't visible/focused,
  // trigger a DM notification (tray/badge/sound via main).
  // "Minimized" maps to document.hidden || !isFocused in the renderer.
  const isPrivmsg = (p.kind || '').toUpperCase() === 'PRIVMSG' || !p.kind; // be tolerant
  const looksMinimized = document.hidden || !isFocused;
  if (isPrivmsg && looksMinimized && state.sessionId && state.peer) {
    try { api.dm.notify(state.sessionId, state.peer); } catch {}
  }
});

// Ensure teardown when the DM window unloads
window.addEventListener('beforeunload', () => {
  try { window.removeEventListener('focus', onFocus); } catch {}
  try { window.removeEventListener('blur', onBlur); } catch {}
  try { offNotify?.(); } catch {}
  try { offUser?.(); } catch {}
  try { offLine?.(); } catch {}
});

renderProfile(null);
