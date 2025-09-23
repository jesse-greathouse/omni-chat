let state = { sessionId: null, peer: null };
const logEl   = document.getElementById('log');
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
  state.peer = peer;
  document.title = String(peer);
  input.placeholder = `Message ${peer}`;
  if (Array.isArray(bootLines)) {
    for (const l of bootLines) append(`${l.from}${l.kind === 'NOTICE' ? ' ▖' : ''}: ${l.text}`);
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
  if ((p.peer || '').toLowerCase() !== (state.peer || '').toLowerCase()) return;
  append(`${p.from}${p.kind === 'NOTICE' ? ' ▖' : ''}: ${p.text}`);
});
