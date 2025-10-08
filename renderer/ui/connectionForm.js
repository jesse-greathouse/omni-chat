import { api } from '../lib/adapter.js';

export function createProfilesPanel({ onConnect }) {
  const wrap = document.createElement('div');
  wrap.className = 'conn-wrap';
  wrap.innerHTML = `
    <div class="conn-card panel">
      <h3>Omni-Chat - Connections</h3>

      <div class="conn-grid">
        <section class="card">
          <h4 class="h4-tight">Global Defaults</h4>
          <div class="form-row">
            <label>Authentication</label>
            <select id="gAuth">
              <option value="none">No authentication</option>
              <option value="nickserv">NickServ</option>
              <option value="sasl">SASL</option>
            </select>
          </div>
          <div class="form-row"><label>Nick</label><input id="gNick" type="text"/></div>
          <div class="form-row auth-extra hidden" id="gAuthUserRow">
            <label>Username</label><input id="gAuthUser" type="text" />
          </div>
          <div class="form-row auth-extra hidden" id="gAuthPassRow">
            <label>Password</label><input id="gAuthPass" type="password" />
          </div>
          <div class="form-row"><label>Realname</label><input id="gReal" type="text"/></div>
          <div class="row-actions">
            <button class="btn" id="saveGlobals">Save Defaults</button>
          </div>
          <div class="muted fs-12 mt-6">
            Server profiles inherit these when their Nick/Realname are empty or null.
          </div>
        </section>

        <section class="server-profiles card">
          <div class="row between">
            <h4 class="h4-tight">Server Profiles</h4>
            <button class="btn" id="addServer">Add Server</button>
          </div>
          <div id="profilesList" class="profiles-list mt-8"></div>
        </section>
      </div>
    </div>
  `;

  const gAuth = wrap.querySelector('#gAuth');
  const gNick = wrap.querySelector('#gNick');
  const gAuthUserRow = wrap.querySelector('#gAuthUserRow');
  const gAuthPassRow = wrap.querySelector('#gAuthPassRow');
  const gAuthUser = wrap.querySelector('#gAuthUser');
  const gAuthPass = wrap.querySelector('#gAuthPass');
  const gReal = wrap.querySelector('#gReal');
  const saveGlobalsBtn = wrap.querySelector('#saveGlobals');
  const addServerBtn = wrap.querySelector('#addServer');
  const listEl = wrap.querySelector('#profilesList');

  function serverRow(host, p) {
    const row = document.createElement('div');
    row.className = 'card g-cols-1-auto mt-6';

    const left = document.createElement('div');
    const right = document.createElement('div');
    right.className = 'row';

    const authLabel = (() => {
      const t = (p.authType || '').toLowerCase();
      if (!t) return 'auth=inherit';
      if (t === 'none') return 'auth=None';
      if (t === 'nickserv') return 'auth=NickServ';
      if (t === 'sasl') return 'auth=SASL';
      return `auth=${t}`;
    })();

    // Build label safely with text nodes
    const top = document.createElement('div');
    top.className = 'fw-600';
    top.textContent = String(host ?? '');

    const sub = document.createElement('div');
    sub.className = 'muted fs-12';
    const parts = [
      (p.tls !== false ? 'TLS' : 'TCP'),
      String(p.port ?? 6697),
      (p.nick ? `nick=${p.nick}` : null),
      (p.realname ? `realname=${p.realname}` : null),
      authLabel,
    ].filter(Boolean);
    sub.textContent = parts.join(' | ');
    left.append(top, sub);

    const connectBtn = button('Connect', () => doConnect(host));
    const editBtn    = button('Edit',    () => openEditor(host));
    const delBtn     = button('Delete',  async () => {
      if (!confirm(`Delete server profile "${host}"?`)) return;
      await api.profiles.del(host);
      await hydrate();
    });
    right.append(connectBtn, editBtn, delBtn);
    row.append(left, right);
    return row;
  }

  function button(text, onClick) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  async function hydrate() {
    const all = await api.settings.getAll();
    const globals = all.globals || { nick: 'guest', realname: 'Guest' };
    gAuth.value = (globals.authType || 'none').toLowerCase();
    gNick.value = globals.nick || '';
    gAuthUser.value = globals.authUsername || '';
    gAuthPass.value = globals.authPassword || '';
    const showUser = gAuth.value === 'sasl';
    const showPass = gAuth.value === 'sasl' || gAuth.value === 'nickserv';
    gAuthUserRow.style.display = showUser ? '' : 'none';
    gAuthPassRow.style.display = showPass ? '' : 'none';
    gReal.value = globals.realname || '';

    // Show Username only for SASL; show Password for SASL or NickServ
    const isSasl = gAuth.value === 'sasl';
    const isNickServ = gAuth.value === 'nickserv';
    gAuthUserRow.classList.toggle('hidden', !isSasl);
    gAuthPassRow.classList.toggle('hidden', !(isSasl || isNickServ));

    listEl.innerHTML = '';
    const profs = await api.profiles.list();
    const hosts = Object.keys(profs).sort((a,b)=>a.localeCompare(b));
    if (hosts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No server profiles yet. Click "Add Server" to create one.';
      listEl.appendChild(empty);
    } else {
      hosts.forEach(h => listEl.appendChild(serverRow(h, profs[h] || {})));
    }
  }

  gAuth.addEventListener('change', () => {
    const isSasl = gAuth.value === 'sasl';
    const isNickServ = gAuth.value === 'nickserv';
    gAuthUserRow.style.display = isSasl ? '' : 'none';
    gAuthPassRow.style.display = (isSasl || isNickServ) ? '' : 'none';
  });

  saveGlobalsBtn.addEventListener('click', async () => {
    const nick = gNick.value.trim() || 'guest';
    const realname = gReal.value.trim() || 'Guest';
    const authType = (gAuth.value || 'none').toLowerCase();
    const authUsername = authType === 'sasl' ? (gAuthUser.value.trim() || null) : null;
    const authPassword = gAuthPass.value || null;
    await api.settings.set('globals', { nick, realname, authType, authUsername, authPassword });
    alert('Saved global defaults.');
  });
  addServerBtn.addEventListener('click', () => openEditor(null)); // new

  async function doConnect(host) {
    // resolve layered profile
    const resolved = await api.profiles.resolve(host);
    const opts = {
      server: resolved.host,
      ircPort: Number(resolved.port || 6697),
      tls: !!resolved.tls,
      nick: resolved.nick,
      realname: resolved.realname,
      authType: (resolved.authType || 'none').toLowerCase(),
      // Username only matters for SASL; keep NickServ simpler
      authUsername: ((resolved.authType || 'none').toLowerCase() === 'sasl'
        ? (resolved.authUsername || null)
        : null),
      authPassword: resolved.authPassword || null
    };
    // session start is handled by caller (renderer/main.js) so we just pass back
    onConnect?.(opts, host);
  }

  // Inline editor dialog
  function openEditor(host) {
    const dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.innerHTML = `
      <div class="modal-card">
        <h4 class="h4-tight">${host ? 'Edit Server' : 'Add Server'}</h4>
        <div class="form-row"><label>Host</label><input id="eHost" type="text" ${host?'disabled':''}/></div>
        <div class="form-row"><label>Port</label><input id="ePort" type="number" value="6697"/></div>
        <div class="form-row"><label>TLS</label><input id="eTLS" type="checkbox" checked/></div>
        <div class="form-row"><label>Nick (override)</label><input id="eNick" type="text" placeholder="leave empty to inherit"/></div>
        <div class="form-row"><label>Realname (override)</label><input id="eReal" type="text" placeholder="leave empty to inherit"/></div>
        <div class="form-row">
          <label>Authentication</label>
          <select id="eAuth">
            <option value="">Inherit (use Global)</option>
            <option value="none">No authentication</option>
            <option value="nickserv">NickServ</option>
            <option value="sasl">SASL</option>
          </select>
        </div>
        <div class="form-row" id="eAuthUserRow" style="display:none;">
          <label>Username</label><input id="eAuthUser" type="text" placeholder="SASL only - leave empty to inherit"/>
        </div>
        <div class="form-row" id="eAuthPassRow" style="display:none;">
          <label>Password</label><input id="eAuthPass" type="password" placeholder="leave empty to inherit"/>
        </div>
        <div class="row-actions">
          <button class="btn" id="eSave">Save</button>
          <button class="btn" id="eCancel">Cancel</button>
        </div>
      </div>
    `;
    const eHost = dialog.querySelector('#eHost');
    const ePort = dialog.querySelector('#ePort');
    const eTLS  = dialog.querySelector('#eTLS');
    const eNick = dialog.querySelector('#eNick');
    const eReal = dialog.querySelector('#eReal');
    const eSave = dialog.querySelector('#eSave');
    const eAuth = dialog.querySelector('#eAuth');
    const eAuthUserRow = dialog.querySelector('#eAuthUserRow');
    const eAuthPassRow = dialog.querySelector('#eAuthPassRow');
    const eAuthUser = dialog.querySelector('#eAuthUser');
    const eAuthPass = dialog.querySelector('#eAuthPass');
    const eCancel = dialog.querySelector('#eCancel');

    const updateAuthVisibility = () => {
      const t = (eAuth.value || '').toLowerCase();
      const isSasl = t === 'sasl';
      const isNickServ = t === 'nickserv';
      eAuthUserRow.style.display = isSasl ? '' : 'none';
      eAuthPassRow.style.display = (isSasl || isNickServ) ? '' : 'none';
    };

    (async () => {
      if (host) {
        const profs = await api.profiles.list();
        const p = profs[host] || {};
        eHost.value = host;
        ePort.value = Number(p.port ?? 6697);
        eTLS.checked = p.tls !== false;
        eNick.value = p.nick ?? '';
        eReal.value = p.realname ?? '';
        eAuth.value = (p.authType || '').toLowerCase();
        eAuthUser.value = p.authUsername ?? '';
        eAuthPass.value = p.authPassword ?? '';
        updateAuthVisibility();
      } else {
        eHost.value = '';
        ePort.value = 6697;
        eTLS.checked = true;
        eNick.value = '';
        eReal.value = '';
        eAuth.value = '';
        eAuthUser.value = '';
        eAuthPass.value = '';
        updateAuthVisibility();
      }
    })();

    eAuth.addEventListener('change', updateAuthVisibility);

    eSave.addEventListener('click', async () => {
      const hostVal = (eHost.value || '').trim();
      if (!hostVal) { alert('Host is required'); return; }
      const payload = {
        port: Number(ePort.value || 6697),
        tls: !!eTLS.checked,
        nick: eNick.value.trim() === '' ? null : eNick.value.trim(),
        realname: eReal.value.trim() === '' ? null : eReal.value.trim(),
        // auth: null/'' => inherit global
        authType: (eAuth.value || '') === '' ? null : (eAuth.value || '').toLowerCase(),
        // Username only meaningful for SASL; null in other modes or when left empty
        authUsername: ((eAuth.value || '').toLowerCase() === 'sasl')
          ? (eAuthUser.value.trim() || null)
          : null,
        // Password applies to SASL and NickServ; empty => inherit (null)
        authPassword: ((eAuth.value || '').toLowerCase() === 'sasl' || (eAuth.value || '').toLowerCase() === 'nickserv')
          ? (eAuthPass.value || null)
          : null
      };
      await api.profiles.upsert(hostVal, payload);
      dialog.remove();
      await hydrate();
    });
    eCancel.addEventListener('click', () => dialog.remove());
    document.body.appendChild(dialog);
  }

  hydrate();
  return wrap;
}
