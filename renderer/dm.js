let state = { sessionId: null, peer: null };
const logEl   = document.getElementById('log');
const profileEl = document.getElementById('profile');
const btnSend = document.getElementById('send');
const input   = document.getElementById('input');

const lines = [];
const textNode = document.createTextNode('');
logEl.appendChild(textNode);

function append(s){
  lines.push(s);
  textNode.nodeValue = lines.join('\n') + '\n';
  requestAnimationFrame(()=>{ logEl.scrollTop = logEl.scrollHeight; });
}

window.dm.onInit(({ sessionId, peer, bootLines }) => {
  state.sessionId = sessionId;
  state.peer = peer || nick || bootLines?.peer || bootLines?.from || bootLines?.nick || bootLines?.username || null;
  document.title = String(state.peer || 'DM');
  input.placeholder = state.peer ? `Message ${state.peer}` : `Message user`;
  // only request if we actually have a nick
  if (state.peer) {
    try { window.dm.requestUser?.(state.sessionId, state.peer); } catch {}
  }
  if (Array.isArray(bootLines)) {
    for (const l of bootLines) append(`${l.from}${l.kind === 'NOTICE' ? ' ▖' : ''}: ${l.text}`);
  }
});

// Render the header grid from a user object (or show "not found")
function renderProfile(u) {
  profileEl.innerHTML = '';
  if (!u || !u.nick) {
    profileEl.classList.add('disabled');
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.peer ? `Waiting for profile data for ${state.peer}…` : 'Waiting for DM…';
    profileEl.appendChild(empty);
    return;
  }
  profileEl.classList.remove('disabled');

  // pick a few common/WHOIS-ish props if present; show gracefully if missing
  const fields = [
    ['Nick', u.nick],
    ['User', u.user || u.username],
    ['Host', u.host],
    ['Realname', u.realname || u.gecos],
    ['Account', u.account],
    ['Away', u.away ? (u.away_reason || 'away') : ''],
    ['Idle', u.idle ? String(u.idle) : ''],
    ['Server', u.server],
    ['Channels', Array.isArray(u.channels) ? u.channels.join(' ') : ''],
    ['Last Seen', u.last_seen],
  ];
  for (const [k, v] of fields) {
    if (v == null || v === '') continue;
    const cell = document.createElement('div');
    cell.className = 'kv';
    const ke = document.createElement('div'); ke.className = 'k'; ke.textContent = k;
    const ve = document.createElement('div'); ve.className = 'v'; ve.textContent = String(v);
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
  }
  const nick = (nickRaw || '').toLowerCase();
  const want = String(state.peer || '').toLowerCase();
  if (nick && want && nick === want) renderProfile(u);
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
