let state = { sessionId: null, peer: null };
const logEl   = document.getElementById('log');
const profileEl = document.getElementById('profile');
const btnSend = document.getElementById('send');
const input   = document.getElementById('input');

const lines = [];
const textNode = document.createTextNode('');
logEl.appendChild(textNode);

function requestWhois() {
  if (!state.sessionId || !state.peer) return;
  // using "<nick> <nick>" often yields richer info (account, etc.)
  try { window.sessions.send(state.sessionId, `/whois ${state.peer} ${state.peer}`); } catch {}
}

function append(s){
  lines.push(s);
  textNode.nodeValue = lines.join('\n') + '\n';
  requestAnimationFrame(()=>{ logEl.scrollTop = logEl.scrollHeight; });
}

/* ---------------------------
   Normalize backend user JSON
   ---------------------------
   Back end sends:
     root:   nick, real_name/realname, ident, host, account, away, modes, channel_modes, whois
     whois:  user, host, realname, server, server_info, account, channels, idle_secs, signon_ts, actual_host, secure
*/
function normalizeUser(u) {
  if (!u || typeof u !== 'object') return null;
  const W = u.whois || {};
  const pick = (...xs) => {
    for (const v of xs) if (v !== undefined && v !== null && v !== '') return v;
    return null;
  };
  const arr = (a) => Array.isArray(a) ? a : [];

  // prefer more accurate host from WHOIS if available
  const host = pick(u.host, W.actual_host, W.host);

  return {
    nick:        u.nick ?? null,
    user:        pick(u.user, u.username, u.ident, W.user),   // "ident" at root, "user" in whois
    host,
    realname:    pick(u.realname, u.real_name, W.realname, u.gecos),
    account:     pick(u.account, W.account),
    away:        u.away ?? null,
    away_reason: pick(u.away_reason, W.away_reason),
    server:      pick(W.server, u.server),
    server_info: pick(W.server_info, u.server_info),
    channels:    arr(pick(W.channels, u.channels)),
    idle_secs:   pick(W.idle_secs, u.idle),
    signon_ts:   pick(W.signon_ts, u.signon_ts),
    secure:      pick(W.secure, u.secure),
    modes:       arr(u.modes),
    channel_modes: u.channel_modes || null,
  };
}

window.dm.onInit(({ sessionId, peer, bootLines }) => {
  state.sessionId = sessionId;
  // remove undefined `nick` fallback
  state.peer = peer || bootLines?.peer || bootLines?.from || bootLines?.nick || bootLines?.username || null;
  document.title = String(state.peer || 'DM');
  input.placeholder = state.peer ? `Message ${state.peer}` : `Message user`;
  // only request if we actually have a nick
  if (state.peer) {
    try { window.dm.requestUser?.(state.sessionId, state.peer); } catch {}
    requestWhois();
  }
  if (Array.isArray(bootLines)) {
    for (const l of bootLines) append(`${l.from}${l.kind === 'NOTICE' ? ' ▖' : ''}: ${l.text}`);
  }
});

// Render the header grid from a user object (or show "not found")
function renderProfile(u) {
  profileEl.innerHTML = '';
  const v = normalizeUser(u);
  if (!v || !v.nick) {
    profileEl.classList.add('disabled');
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.peer ? `Waiting for profile data for ${state.peer}…` : 'Waiting for DM…';
    profileEl.appendChild(empty);
    return;
  }
  profileEl.classList.remove('disabled');

  // Build rows using normalized fields
  const fields = [
    ['Nick',        v.nick],
    ['User',        v.user],                      // WHOIS "user"/root "ident"
    ['Host',        v.host],
    ['Realname',    v.realname],
    ['Account',     v.account],
    ['Server',      v.server],
    ['Server info', v.server_info],
    ['Secure',      (v.secure == null ? '' : (v.secure ? 'yes' : 'no'))],
    ['Away',        (v.away == null ? '' : (v.away ? (v.away_reason || 'away') : 'no'))],
    ['Idle',        (v.idle_secs == null ? '' : String(v.idle_secs) + 's')],
    ['Signon',      (v.signon_ts == null ? '' : String(v.signon_ts))],
    ['Channels',    v.channels.length ? v.channels.join(' ') : ''],
    ['Modes',       v.modes.length ? v.modes.join(' ') : ''],
  ];

  for (const [k, val] of fields) {
    if (val == null || val === '') continue;
    const cell = document.createElement('div');
    cell.className = 'kv';
    const ke = document.createElement('div'); ke.className = 'k'; ke.textContent = k;
    const ve = document.createElement('div'); ve.className = 'v'; ve.textContent = String(val);
    cell.append(ke, ve);
    profileEl.appendChild(cell);
  }

  // If nothing rendered, still show a disabled message so the panel isn't empty
  if (!profileEl.children.length) {
    profileEl.classList.add('disabled');
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `No profile data yet for ${state.peer}`;
    profileEl.appendChild(empty);
  }
}

// live updates: main will push user objects for our peer
window.dm.onUser?.((payload) => {
  if (!payload) return;
  if (payload.sessionId !== state.sessionId) return;
  const u = payload.user || {};
  const nickRaw = u.nick || u.nickname || u.name || u.user || u.username;
  // If we still don't know who the peer is, adopt it from the first good payload.
  if (!state.peer && nickRaw) {
    state.peer = nickRaw;
    document.title = String(state.peer);
    input.placeholder = `Message ${state.peer}`;
    requestWhois();
  }
  const nick = (nickRaw || '').toLowerCase();
  const want = String(state.peer || '').toLowerCase();
  if (nick && want && nick === want) {
    // Ask for WHOIS if this snapshot lacks it; backend will throttle/cache safely
    if (!u.whois) requestWhois();
    renderProfile(u);
  }
});

function sendNow(){
  const t = input.value.trim();
  if (!t || !state.sessionId || !state.peer) return;
  window.sessions.send(state.sessionId, `/msg ${state.peer} ${t}`);
  append(`> ${t}`);
  input.value = '';
}

btnSend.addEventListener('click', sendNow);
input.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') sendNow(); });

// receive routed DM lines (sent directly from main)
window.dm.onLine((p) => {
  if (!p) return;
  if (p.sessionId !== state.sessionId) return;

  // If we still don't know the peer, adopt it from the very first line.
  if (!state.peer) {
    const candidate = p.peer || p.from || p.nick || p.username || null;
    if (candidate) {
      state.peer = candidate;
      document.title = String(state.peer);
      input.placeholder = `Message ${state.peer}`;
      // now that we have a peer, ask for a snapshot so the header can populate
      try { window.dm.requestUser?.(state.sessionId, state.peer); } catch {}
      requestWhois();
      // re-render the placeholder with the actual nick
      renderProfile(null);
    }
  }

  // If we *do* have a peer, only show lines for that peer.
  if (state.peer && (p.peer || p.from)) {
    const got = String(p.peer || p.from).toLowerCase();
    const want = String(state.peer).toLowerCase();
    if (got !== want) return;
  }
  append(`${p.from}${p.kind === 'NOTICE' ? ' ▖' : ''}: ${p.text}`);
});

renderProfile(null);
